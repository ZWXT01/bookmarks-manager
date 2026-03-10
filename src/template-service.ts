import type { Db } from './db';
import { getOrCreateCategoryByPath, getCategoryTree, getCategoryFullPath } from './category-service';
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

  sets.push('updated_at = ?'); vals.push(nowIso()); vals.push(id);
  db.prepare(`UPDATE category_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getTemplate(db, id);
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
    if (active?.id === templateId) return;

    const target = getTemplate(db, templateId);
    if (!target) throw new TemplateError(404, 'template not found');

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
  if (tpl.type !== 'preset') throw new TemplateError(403, 'only preset templates can be reset');

  const tree: CategoryNode[] = JSON.parse(tpl.tree);

  db.transaction(() => {
    const active = getActiveTemplate(db);
    if (active && active.id !== id) saveSnapshot(db, active.id);

    db.prepare('DELETE FROM categories').run();
    db.prepare('UPDATE bookmarks SET category_id = NULL').run();

    for (const node of tree) {
      getOrCreateCategoryByPath(db, node.name);
      for (const child of node.children ?? []) {
        getOrCreateCategoryByPath(db, `${node.name}/${child.name}`);
      }
    }

    db.prepare('DELETE FROM template_snapshots WHERE template_id = ?').run(id);

    if (!active || active.id !== id) {
      db.prepare('UPDATE category_templates SET is_active = 0 WHERE is_active = 1').run();
      db.prepare('UPDATE category_templates SET is_active = 1 WHERE id = ?').run(id);
    }
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
