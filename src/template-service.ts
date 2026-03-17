import type { Db } from './db';
import { getOrCreateCategoryByPath, getCategoryTree, getCategoryFullPath, getCategoryByPath, deleteCategory } from './category-service';
import { jobQueue, updateJob } from './jobs';

export interface TemplateRow {
  id: number;
  name: string;
  type: 'preset' | 'custom';
  tree: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryNode { name: string; children: { name: string }[] }

export class TemplateError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'TemplateError';
    this.statusCode = statusCode;
  }
}

type TemplateListRow = Omit<TemplateRow, 'tree'> & { top_level_count: number };

const nowIso = () => new Date().toISOString();

function normalizeTree(tree: CategoryNode[]): CategoryNode[] {
  return tree.map(n => ({
    name: n.name.trim(),
    children: (n.children ?? []).map(c => ({ name: c.name.trim() })),
  }));
}

/**
 * 同步活动模板的 tree 到 categories 表
 * 策略：
 * - 新增：自动创建分类
 * - 删除：只删除空分类（无书签）
 * - 重命名：不自动处理（保留旧分类，创建新分类）
 */
function syncActiveTemplateToCategories(db: Db, oldTree: CategoryNode[], newTree: CategoryNode[]): void {
  // 构建新旧路径集合
  const oldPaths = new Set<string>();
  const newPaths = new Set<string>();

  for (const node of oldTree) {
    oldPaths.add(node.name);
    for (const child of node.children ?? []) {
      oldPaths.add(`${node.name}/${child.name}`);
    }
  }

  for (const node of newTree) {
    newPaths.add(node.name);
    for (const child of node.children ?? []) {
      newPaths.add(`${node.name}/${child.name}`);
    }
  }

  // 1. 处理新增：创建不存在的分类
  for (const path of newPaths) {
    if (!oldPaths.has(path)) {
      getOrCreateCategoryByPath(db, path);
    }
  }

  // 2. 处理删除：只删除空分类（无书签）
  for (const path of oldPaths) {
    if (!newPaths.has(path)) {
      const cat = getCategoryByPath(db, path);
      if (cat) {
        // 检查分类及其所有子分类是否都为空
        const hasAnyBookmarks = db.prepare(`
          SELECT COUNT(*) as count FROM bookmarks
          WHERE category_id = ? OR category_id IN (
            SELECT id FROM categories WHERE parent_id = ?
          )
        `).get(cat.id, cat.id) as { count: number };

        if (hasAnyBookmarks.count === 0) {
          // 空分类且无子分类书签，安全删除
          try {
            deleteCategory(db, cat.id);
          } catch (e: any) {
            // 只忽略"分类不存在"的预期异常，其他异常应该抛出让事务回滚
            if (e?.message === '分类不存在') {
              // 预期的异常（可能父分类已删除），静默处理
              continue;
            }
            // 非预期异常，记录并抛出以触发事务回滚
            console.error(`Failed to delete empty category ${cat.id} (${path}):`, e);
            throw e;
          }
        }
        // 如果有书签，保留分类不删除
      }
    }
  }
}

/**
 * 反向同步：将 categories 表同步到活动自定义模板
 * 策略：读取当前分类树，更新活动模板的 tree 字段
 *
 * 应在以下分类操作后调用：
 * - 创建分类
 * - 删除分类
 * - 重命名分类
 * - 移动分类
 * - 重新排序分类
 */
export function syncCategoriesToActiveTemplate(db: Db): void {
  const activeTemplate = getActiveTemplate(db);
  if (!activeTemplate) return;
  if (activeTemplate.type === 'preset') return; // 预置模板不可修改

  // 获取分类结构（不计算书签数量，提升性能）
  const categories = db.prepare(`
    SELECT id, name, parent_id, sort_order
    FROM categories
    ORDER BY parent_id NULLS FIRST, sort_order, name
  `).all() as Array<{ id: number; name: string; parent_id: number | null; sort_order: number }>;

  // 构建树结构
  const topLevel: Array<{ name: string; children: Array<{ name: string }> }> = [];
  const categoryMap = new Map<number, { name: string; children: Array<{ name: string }> }>();

  for (const cat of categories) {
    if (cat.parent_id === null) {
      const node = { name: cat.name, children: [] as Array<{ name: string }> };
      topLevel.push(node);
      categoryMap.set(cat.id, node);
    }
  }

  for (const cat of categories) {
    if (cat.parent_id !== null) {
      const parent = categoryMap.get(cat.parent_id);
      if (parent) {
        const childName = cat.name.includes('/') ? cat.name.split('/').pop()! : cat.name;
        parent.children.push({ name: childName });
      } else {
        // 孤立的二级分类（parent_id 对应的一级不存在），提升为一级分类
        const orphanName = cat.name.includes('/') ? cat.name.split('/').pop()! : cat.name;
        topLevel.push({ name: orphanName, children: [] });
      }
    }
  }

  // 更新活动模板
  const now = nowIso();
  db.prepare(
    'UPDATE category_templates SET tree = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(normalizeTree(topLevel)), now, activeTemplate.id);
}

// ==================== CRUD ====================

export function listTemplates(db: Db): TemplateListRow[] {
  const rows = db.prepare(`
    SELECT id, name, type, tree, is_active, created_at, updated_at FROM category_templates
    ORDER BY is_active DESC, CASE type WHEN 'preset' THEN 0 ELSE 1 END, id
  `).all() as TemplateRow[];
  return rows.map(({ tree, ...rest }) => ({
    ...rest,
    top_level_count: (JSON.parse(tree) as CategoryNode[]).length,
  }));
}

export function getTemplate(db: Db, id: number): TemplateRow | null {
  return (db.prepare('SELECT * FROM category_templates WHERE id = ?').get(id) as TemplateRow | undefined) ?? null;
}

export function getActiveTemplate(db: Db): TemplateRow | null {
  return (db.prepare('SELECT * FROM category_templates WHERE is_active = 1 LIMIT 1').get() as TemplateRow | undefined) ?? null;
}

export function createTemplate(db: Db, name: string, tree: CategoryNode[]): TemplateRow {
  const trimmed = name.trim();
  if (!trimmed) throw new TemplateError(400, 'name cannot be empty');
  const v = validateTree(tree, 'custom');
  if (!v.valid) throw new TemplateError(400, v.errors.join('; '));

  const now = nowIso();
  const res = db.prepare(
    `INSERT INTO category_templates (name, type, tree, is_active, created_at, updated_at) VALUES (?, 'custom', ?, 0, ?, ?)`
  ).run(trimmed, JSON.stringify(normalizeTree(tree)), now, now);
  return getTemplate(db, Number(res.lastInsertRowid))!;
}

export function updateTemplate(db: Db, id: number, patch: { name?: string; tree?: CategoryNode[] }): TemplateRow | null {
  const tpl = getTemplate(db, id);
  if (!tpl) return null;
  if (tpl.type === 'preset') throw new TemplateError(403, 'preset templates cannot be updated');

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new TemplateError(400, 'name cannot be empty');
    sets.push('name = ?'); vals.push(trimmed);
  }
  if (patch.tree !== undefined) {
    const v = validateTree(patch.tree, 'custom');
    if (!v.valid) throw new TemplateError(400, v.errors.join('; '));
    sets.push('tree = ?'); vals.push(JSON.stringify(normalizeTree(patch.tree)));
  }
  if (!sets.length) return tpl;

  // 使用事务确保模板更新和分类同步的原子性
  return db.transaction(() => {
    // 如果是活动模板且更新了 tree，先获取旧 tree 用于 diff
    const oldTree = (tpl.is_active === 1 && patch.tree !== undefined)
      ? JSON.parse(tpl.tree) as CategoryNode[]
      : [];

    sets.push('updated_at = ?'); vals.push(nowIso()); vals.push(id);
    db.prepare(`UPDATE category_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    // 如果是活动模板且更新了 tree，完整同步到 categories 表
    if (tpl.is_active === 1 && patch.tree !== undefined) {
      const newTree = normalizeTree(patch.tree);
      syncActiveTemplateToCategories(db, oldTree, newTree);
    }

    return getTemplate(db, id);
  })();
}

export function deleteTemplate(db: Db, id: number): boolean {
  const tpl = getTemplate(db, id);
  if (!tpl) return false;
  if (tpl.type === 'preset') throw new TemplateError(403, 'preset templates cannot be deleted');
  if (tpl.is_active === 1) throw new TemplateError(400, 'active template cannot be deleted');

  // Cancel active plans and their jobs before deletion
  const activePlans = db.prepare(
    `SELECT id, job_id FROM ai_organize_plans WHERE template_id = ? AND status = 'assigning'`
  ).all(id) as Array<{ id: string; job_id: string }>;
  for (const p of activePlans) {
    jobQueue.cancelJob(p.job_id);
    updateJob(db, p.job_id, { status: 'canceled', message: 'template deleted' });
    db.prepare(`UPDATE ai_organize_plans SET status = 'canceled' WHERE id = ?`).run(p.id);
  }

  // Cascade delete related data
  const planIds = db.prepare(
    `SELECT id, job_id FROM ai_organize_plans WHERE template_id = ?`
  ).all(id) as Array<{ id: string; job_id: string }>;

  if (planIds.length) {
    const jobIds = planIds.map(p => p.job_id).filter(Boolean);
    const pIds = planIds.map(p => p.id);

    if (jobIds.length) {
      const jobPh = jobIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM job_failures WHERE job_id IN (${jobPh})`).run(...jobIds);
      db.prepare(`DELETE FROM jobs WHERE id IN (${jobPh})`).run(...jobIds);
    }
    const planPh = pIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM plan_state_logs WHERE plan_id IN (${planPh})`).run(...pIds);
    db.prepare(`DELETE FROM ai_organize_plans WHERE template_id = ?`).run(id);
  }

  db.prepare('DELETE FROM template_snapshots WHERE template_id = ?').run(id);
  return db.prepare('DELETE FROM category_templates WHERE id = ?').run(id).changes > 0;
}

// ==================== Validation ====================

export function validateTree(tree: CategoryNode[], type: 'preset' | 'custom'): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(tree)) return { valid: false, errors: ['tree must be an array'] };
  if (type === 'preset' && tree.length > 20) errors.push('top-level count must be <= 20');

  const seenTop = new Set<string>();
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (!node || typeof node !== 'object') { errors.push(`tree[${i}] invalid`); continue; }

    const name = (typeof node.name === 'string' ? node.name : '').trim();
    if (!name) errors.push(`tree[${i}].name is required`);
    else {
      if (name.includes('/')) errors.push(`tree[${i}].name cannot contain '/'`);
      if (seenTop.has(name)) errors.push(`duplicate top-level: ${name}`);
      else seenTop.add(name);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    if (type === 'preset' && children.length > 10) errors.push(`children count for '${name || i}' must be <= 10`);

    const seenChild = new Set<string>();
    for (let j = 0; j < children.length; j++) {
      const child = children[j] as Record<string, unknown>;
      if (!child || typeof child !== 'object') { errors.push(`tree[${i}].children[${j}] invalid`); continue; }
      const cn = (typeof child.name === 'string' ? child.name : '').trim();
      if (!cn) errors.push(`tree[${i}].children[${j}].name is required`);
      else {
        if (cn.includes('/')) errors.push(`tree[${i}].children[${j}].name cannot contain '/'`);
        if (seenChild.has(cn)) errors.push(`duplicate child under '${name}': ${cn}`);
        else seenChild.add(cn);
      }
      if (Array.isArray((child as any).children) && (child as any).children.length > 0) {
        errors.push(`depth > 2 at tree[${i}].children[${j}]`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ==================== Apply / Snapshot ====================

export function applyTemplate(db: Db, templateId: number): void {
  db.transaction(() => {
    const active = getActiveTemplate(db);
    const target = getTemplate(db, templateId);
    if (!target) throw new TemplateError(404, 'template not found');
    if (target.type === 'preset') throw new TemplateError(403, 'Preset templates are read-only references. Please create a custom template based on it first.');
    if (active?.id === templateId) return;

    if (active) saveSnapshot(db, active.id);

    const tree: CategoryNode[] = JSON.parse(target.tree);

    db.prepare('DELETE FROM categories').run();
    db.prepare('UPDATE bookmarks SET category_id = NULL').run();

    for (const node of tree) {
      getOrCreateCategoryByPath(db, node.name);
      for (const child of node.children ?? []) {
        getOrCreateCategoryByPath(db, `${node.name}/${child.name}`);
      }
    }

    restoreSnapshot(db, templateId);

    db.prepare('UPDATE category_templates SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE category_templates SET is_active = 1 WHERE id = ?').run(templateId);
  })();
}

export function saveSnapshot(db: Db, templateId: number): void {
  db.prepare('DELETE FROM template_snapshots WHERE template_id = ?').run(templateId);

  const rows = db.prepare('SELECT id, category_id FROM bookmarks WHERE category_id IS NOT NULL').all() as { id: number; category_id: number }[];
  const ins = db.prepare('INSERT INTO template_snapshots (template_id, bookmark_id, category_path) VALUES (?, ?, ?)');

  for (const r of rows) {
    const path = (getCategoryFullPath(db, r.category_id) ?? '').trim();
    if (path) ins.run(templateId, r.id, path);
  }
}

export function resetTemplate(db: Db, id: number): void {
  const tpl = getTemplate(db, id);
  if (!tpl) throw new TemplateError(404, 'template not found');

  // Only custom templates can be reset (preset templates are read-only)
  if (tpl.type === 'preset') {
    throw new TemplateError(403, 'Preset templates are read-only and cannot be reset. Please create a custom template based on it instead.');
  }

  // Only the active template can be reset (to avoid corrupting live data)
  const active = getActiveTemplate(db);
  if (!active || active.id !== id) {
    throw new TemplateError(403, 'Only the currently active template can be reset');
  }

  const tree: CategoryNode[] = JSON.parse(tpl.tree);

  db.transaction(() => {
    // Save snapshot before reset
    saveSnapshot(db, id);

    db.prepare('DELETE FROM categories').run();
    db.prepare('UPDATE bookmarks SET category_id = NULL').run();

    for (const node of tree) {
      getOrCreateCategoryByPath(db, node.name);
      for (const child of node.children ?? []) {
        getOrCreateCategoryByPath(db, `${node.name}/${child.name}`);
      }
    }

    db.prepare('DELETE FROM template_snapshots WHERE template_id = ?').run(id);
    db.prepare('UPDATE category_templates SET is_active = 1 WHERE id = ?').run(id);
  })();
}

export function restoreSnapshot(db: Db, templateId: number): void {
  const snaps = db.prepare('SELECT bookmark_id, category_path FROM template_snapshots WHERE template_id = ?')
    .all(templateId) as { bookmark_id: number; category_path: string }[];
  if (!snaps.length) return;

  const tree = getCategoryTree(db);
  const pathToId = new Map<string, number>();
  for (const node of tree) {
    if (node.fullPath.trim()) pathToId.set(node.fullPath.trim(), node.id);
    for (const child of node.children) {
      if (child.fullPath.trim()) pathToId.set(child.fullPath.trim(), child.id);
    }
  }

  const upd = db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?');
  for (const s of snaps) {
    const path = s.category_path.trim();
    let catId = pathToId.get(path);
    if (catId === undefined && path) {
      catId = getOrCreateCategoryByPath(db, path);
      pathToId.set(path, catId);
    }
    if (catId !== undefined) upd.run(catId, s.bookmark_id);
  }
}
