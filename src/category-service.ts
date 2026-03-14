/**
 * 分类服务模块 - 提供树状分类管理功能
 * 
 * 约束：强制 2 级层级（一级分类 / 二级分类）
 */

import type { Db } from './db';

// ==================== 类型定义 ====================

/** 分类基础信息 */
export interface CategoryRow {
    id: number;
    name: string;
    parent_id: number | null;
    icon: string | null;
    color: string | null;
    sort_order: number;
    created_at: string;
}

/** 带书签计数的分类 */
export interface CategoryWithCount extends CategoryRow {
    count: number;
}

/** 树状分类节点（包含子分类） */
export interface CategoryTreeNode extends CategoryWithCount {
    children: CategoryTreeNode[];
    /** 完整路径（一级：name，二级：parent_name/name） */
    fullPath: string;
    /** UI 显示名称（二级分类时只显示子名称，如 "编程" 而非 "技术/编程"） */
    displayName?: string;
}

/** 扁平分类（带完整路径，兼容旧格式） */
export interface FlatCategory {
    id: number;
    name: string;
    fullPath: string;
    parent_id: number | null;
    icon: string | null;
    color: string | null;
    count: number;
    level: number; // 0 = 一级, 1 = 二级
}

// ==================== 查询函数 ====================

/**
 * 获取所有分类（带书签计数）
 */
export function getAllCategories(db: Db): CategoryWithCount[] {
    return db.prepare(`
    SELECT c.id, c.name, c.parent_id, c.icon, c.color, c.sort_order, c.created_at,
           COUNT(b.id) as count
    FROM categories c
    LEFT JOIN bookmarks b ON b.category_id = c.id
    GROUP BY c.id
    ORDER BY c.parent_id NULLS FIRST, c.sort_order, c.name
  `).all() as CategoryWithCount[];
}

/**
 * 获取树状分类结构
 * 
 * @returns 一级分类数组，每个一级分类包含其子分类
 */
export function getCategoryTree(db: Db): CategoryTreeNode[] {
    const categories = getAllCategories(db);

    // 分离一级和二级分类
    const topLevel: CategoryTreeNode[] = [];
    const secondLevel: CategoryWithCount[] = [];

    const categoryMap = new Map<number, CategoryTreeNode>();

    for (const cat of categories) {
        if (cat.parent_id === null) {
            const node: CategoryTreeNode = {
                ...cat,
                children: [],
                fullPath: cat.name,
            };
            topLevel.push(node);
            categoryMap.set(cat.id, node);
        } else {
            secondLevel.push(cat);
        }
    }

    // 将二级分类挂载到对应的一级分类下
    for (const cat of secondLevel) {
        const parent = categoryMap.get(cat.parent_id!);
        if (parent) {
            // 子分类的 name 已经是完整路径（如 "技术/编程"），直接使用
            // 同时提供简短名称用于 UI 显示
            const displayName = cat.name.includes('/') ? cat.name.split('/').pop()! : cat.name;
            const fullPath = cat.name.includes('/') ? cat.name : `${parent.name}/${cat.name}`;
            parent.children.push({
                ...cat,
                children: [], // 强制 2 级，不会有更深的子分类
                fullPath,
                displayName,         // 用于 UI 显示的简短名称
            });
        } else {
            // 孤立的二级分类（parent_id 对应的一级不存在），作为一级处理
            topLevel.push({
                ...cat,
                children: [],
                fullPath: cat.name,
            });
        }
    }

    // 对子分类排序
    for (const node of topLevel) {
        node.children.sort((a, b) => {
            if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
            return a.name.localeCompare(b.name, 'zh-CN');
        });
    }

    // 对一级分类排序
    topLevel.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name, 'zh-CN');
    });

    return topLevel;
}

/**
 * 获取扁平分类列表（带完整路径，兼容旧 API）
 */
export function getFlatCategories(db: Db): FlatCategory[] {
    const tree = getCategoryTree(db);
    const result: FlatCategory[] = [];

    for (const node of tree) {
        result.push({
            id: node.id,
            name: node.name,
            fullPath: node.fullPath,
            parent_id: node.parent_id,
            icon: node.icon,
            color: node.color,
            count: node.count,
            level: 0,
        });

        for (const child of node.children) {
            result.push({
                id: child.id,
                name: child.name,
                fullPath: child.fullPath,
                parent_id: child.parent_id,
                icon: child.icon,
                color: child.color,
                count: child.count,
                level: 1,
            });
        }
    }

    return result;
}

/**
 * 根据 ID 获取分类
 */
export function getCategoryById(db: Db, id: number): CategoryRow | null {
    const row = db.prepare(`
    SELECT id, name, parent_id, icon, color, sort_order, created_at
    FROM categories WHERE id = ?
  `).get(id) as CategoryRow | undefined;
    return row ?? null;
}

/**
 * 根据名称获取分类
 */
export function getCategoryByName(db: Db, name: string): CategoryRow | null {
    const row = db.prepare(`
    SELECT id, name, parent_id, icon, color, sort_order, created_at
    FROM categories WHERE name = ?
  `).get(name) as CategoryRow | undefined;
    return row ?? null;
}

/**
 * 获取一级分类列表
 */
export function getTopLevelCategories(db: Db): CategoryWithCount[] {
    return db.prepare(`
    SELECT c.id, c.name, c.parent_id, c.icon, c.color, c.sort_order, c.created_at,
           COUNT(b.id) as count
    FROM categories c
    LEFT JOIN bookmarks b ON b.category_id = c.id
    WHERE c.parent_id IS NULL
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `).all() as CategoryWithCount[];
}

/**
 * 获取指定一级分类的子分类
 */
export function getSubCategories(db: Db, parentId: number): CategoryWithCount[] {
    return db.prepare(`
    SELECT c.id, c.name, c.parent_id, c.icon, c.color, c.sort_order, c.created_at,
           COUNT(b.id) as count
    FROM categories c
    LEFT JOIN bookmarks b ON b.category_id = c.id
    WHERE c.parent_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `).all(parentId) as CategoryWithCount[];
}

/**
 * 获取分类的完整路径
 */
export function getCategoryFullPath(db: Db, categoryId: number): string | null {
    const cat = getCategoryById(db, categoryId);
    if (!cat) return null;

    if (cat.parent_id === null) {
        return cat.name;
    }

    const parent = getCategoryById(db, cat.parent_id);
    if (!parent) {
        return cat.name;
    }

    if (cat.name.startsWith(parent.name + '/')) {
        return cat.name;
    }

    const simple = cat.name.includes('/') ? cat.name.split('/').pop()! : cat.name;
    return `${parent.name}/${simple}`;
}

// ==================== 创建/修改函数 ====================

/**
 * 创建一级分类
 */
export function createTopCategory(db: Db, name: string, options?: {
    icon?: string;
    color?: string;
}): number {
    const now = new Date().toISOString();
    // Get the maximum sort_order for top-level categories
    const maxSortOrder = db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) as max_order
        FROM categories
        WHERE parent_id IS NULL
    `).get() as { max_order: number };
    const nextSortOrder = maxSortOrder.max_order + 1;

    const result = db.prepare(`
    INSERT INTO categories (name, parent_id, icon, color, sort_order, created_at)
    VALUES (?, NULL, ?, ?, ?, ?)
  `).run(name.trim(), options?.icon ?? null, options?.color ?? null, nextSortOrder, now);
    return Number(result.lastInsertRowid);
}

/**
 * 创建二级分类
 */
export function createSubCategory(db: Db, name: string, parentId: number, options?: {
    icon?: string;
    color?: string;
}): number {
    // 验证父分类是一级分类
    const parent = getCategoryById(db, parentId);
    if (!parent) {
        throw new Error('父分类不存在');
    }
    if (parent.parent_id !== null) {
        throw new Error('不能在二级分类下创建子分类（最多支持 2 级）');
    }

    const raw = name.trim();
    if (!raw) {
        throw new Error('分类名称不能为空');
    }
    const simpleName = raw.includes('/') ? raw.split('/').pop()!.trim() : raw;
    if (!simpleName) {
        throw new Error('分类名称不能为空');
    }
    const fullName = `${parent.name}/${simpleName}`;

    // 兼容旧数据：子分类可能存为 simpleName 或 fullName
    const existing = db.prepare(`
    SELECT id FROM categories
    WHERE parent_id = ? AND (name = ? OR name = ?)
    LIMIT 1
  `).get(parentId, fullName, simpleName) as { id: number } | undefined;
    if (existing) {
        // 规范化旧格式（simpleName -> fullName）
        db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(fullName, existing.id);
        return existing.id;
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
    INSERT INTO categories (name, parent_id, icon, color, sort_order, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(fullName, parentId, options?.icon ?? null, options?.color ?? null, now);
    return Number(result.lastInsertRowid);
}

/**
 * 根据路径创建或获取分类（兼容旧格式如 "技术/编程"）
 * 
 * @param path 分类路径，如 "技术" 或 "技术/编程"
 * @returns 最终分类的 ID
 */
export function getOrCreateCategoryByPath(db: Db, path: string): number {
    const parts = path.split('/').map(s => s.trim()).filter(Boolean);

    if (parts.length === 0) {
        throw new Error('分类路径不能为空');
    }

    if (parts.length > 2) {
        // 超过 2 级，只取前 2 级
        parts.length = 2;
    }

    const topName = parts[0];

    // 查找或创建一级分类
    let topCat = getCategoryByName(db, topName);
    if (!topCat) {
        const topId = createTopCategory(db, topName);
        topCat = getCategoryById(db, topId);
    }

    if (!topCat) {
        throw new Error('创建一级分类失败');
    }

    // 如果只有一级，直接返回
    if (parts.length === 1) {
        return topCat.id;
    }

    // 查找或创建二级分类
    const subName = parts[1];
    const fullSubName = `${topName}/${subName}`;

    // 优先按父分类定位，兼容旧数据（simpleName/fullSubName 两种存储）
    const existingSub = db.prepare(`
      SELECT id, name, parent_id FROM categories
      WHERE parent_id = ? AND (name = ? OR name = ?)
      LIMIT 1
    `).get(topCat.id, fullSubName, subName) as CategoryRow | undefined;
    if (existingSub) {
        if (existingSub.name !== fullSubName) {
            db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(fullSubName, existingSub.id);
        }
        return existingSub.id;
    }

    // 兜底：按全路径查找并修正 parent_id
    const subCat = getCategoryByName(db, fullSubName);
    if (subCat) {
        if (subCat.parent_id !== topCat.id) {
            db.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(topCat.id, subCat.id);
        }
        return subCat.id;
    }

    return createSubCategory(db, subName, topCat.id);
}

/**
 * 重命名分类
 */
export function renameCategory(db: Db, categoryId: number, newName: string): void {
    const cat = getCategoryById(db, categoryId);
    if (!cat) {
        throw new Error('分类不存在');
    }

    const trimmedName = newName.trim();

    if (cat.parent_id === null) {
        // 一级分类：直接更新名称，并更新所有子分类的名称前缀
        const oldName = cat.name;
        db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(trimmedName, categoryId);

        // 更新子分类的名称前缀（旧格式兼容）
        db.prepare(`
      UPDATE categories 
      SET name = ? || substr(name, ?)
      WHERE parent_id = ? AND name LIKE ?
    `).run(trimmedName, oldName.length + 1, categoryId, oldName + '/%');
    } else {
        // 二级分类：更新名称（需要包含父分类前缀）
        const parent = getCategoryById(db, cat.parent_id);
        if (parent) {
            db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(
                `${parent.name}/${trimmedName}`,
                categoryId
            );
        } else {
            db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(trimmedName, categoryId);
        }
    }
}

/**
 * 重新分配所有一级分类的 sort_order 为连续序列（0, 1, 2, ...）
 * 保持当前的相对顺序（按 sort_order, name 排序）
 */
function reorderTopLevelCategories(db: Db): void {
    const topLevelCategories = db.prepare(`
        SELECT id FROM categories
        WHERE parent_id IS NULL
        ORDER BY sort_order ASC, name ASC
    `).all() as Array<{ id: number }>;

    const stmt = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
    topLevelCategories.forEach((cat, index) => {
        stmt.run(index, cat.id);
    });
}

/**
 * 移动分类（更改父分类）
 *
 * @param categoryId 要移动的分类 ID
 * @param newParentId 新的父分类 ID，null 表示移动到一级
 */
export function moveCategory(db: Db, categoryId: number, newParentId: number | null): void {
    const cat = getCategoryById(db, categoryId);
    if (!cat) {
        throw new Error('分类不存在');
    }

    if (newParentId !== null) {
        const newParent = getCategoryById(db, newParentId);
        if (!newParent) {
            throw new Error('目标父分类不存在');
        }
        if (newParent.parent_id !== null) {
            throw new Error('目标父分类必须是一级分类（最多支持 2 级）');
        }
        if (newParentId === categoryId) {
            throw new Error('不能将分类移动到自身');
        }
    }

    // 如果分类有子分类，不能移动到二级（因为会变成三级）
    if (newParentId !== null) {
        const hasChildren = db.prepare('SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1').get(categoryId);
        if (hasChildren) {
            throw new Error('有子分类的分类不能移动到其他一级分类下');
        }
    }

    // 更新 parent_id 和 sort_order（使用事务确保原子性）
    const tx = db.transaction(() => {
        if (newParentId === null) {
            // 移动到一级：分配新的 sort_order
            const maxSortOrder = db.prepare(`
                SELECT COALESCE(MAX(sort_order), -1) as max_order
                FROM categories
                WHERE parent_id IS NULL
            `).get() as { max_order: number };
            const nextSortOrder = maxSortOrder.max_order + 1;

            // 更新名称：去掉路径前缀
            const nameParts = cat.name.split('/');
            const simpleName = nameParts[nameParts.length - 1];

            db.prepare('UPDATE categories SET parent_id = ?, sort_order = ?, name = ? WHERE id = ?')
                .run(null, nextSortOrder, simpleName, categoryId);
        } else {
            // 更新名称：添加父分类前缀
            const newParent = getCategoryById(db, newParentId)!;
            const nameParts = cat.name.split('/');
            const simpleName = nameParts[nameParts.length - 1];
            const newName = `${newParent.name}/${simpleName}`;

            db.prepare('UPDATE categories SET parent_id = ?, name = ? WHERE id = ?')
                .run(newParentId, newName, categoryId);

            // 如果原来是一级分类，降级为二级分类后需要压缩剩余一级分类的 sort_order
            if (cat.parent_id === null) {
                reorderTopLevelCategories(db);
            }
        }
    });

    tx();
}

/**
 * 删除分类（书签移到未分类）
 */
export function deleteCategory(db: Db, categoryId: number): { movedBookmarks: number } {
    const cat = getCategoryById(db, categoryId);
    if (!cat) {
        throw new Error('分类不存在');
    }

    let totalMoved = 0;

    // 使用事务确保原子性
    const tx = db.transaction(() => {
        // 将该分类下的书签移到未分类
        const moveResult = db.prepare('UPDATE bookmarks SET category_id = NULL WHERE category_id = ?').run(categoryId);
        totalMoved += moveResult.changes;

        // 如果是一级分类，先处理其子分类
        if (cat.parent_id === null) {
            // 将子分类下的书签也移到未分类
            const subMoveResult = db.prepare(`
          UPDATE bookmarks SET category_id = NULL
          WHERE category_id IN (SELECT id FROM categories WHERE parent_id = ?)
        `).run(categoryId);
            totalMoved += subMoveResult.changes;

            // 删除子分类
            db.prepare('DELETE FROM categories WHERE parent_id = ?').run(categoryId);
        }

        // 删除该分类
        db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);

        // 如果是一级分类，重新分配剩余一级分类的 sort_order
        if (cat.parent_id === null) {
            reorderTopLevelCategories(db);
        }
    });

    tx();

    return { movedBookmarks: totalMoved };
}

/**
 * 批量删除分类
 */
export function deleteCategories(db: Db, categoryIds: number[]): { movedBookmarks: number } {
    let totalMoved = 0;

    const tx = db.transaction(() => {
        for (const id of categoryIds) {
            try {
                const result = deleteCategory(db, id);
                totalMoved += result.movedBookmarks;
            } catch (e: any) {
                // 只忽略"分类不存在"错误，其他错误应该抛出
                if (e?.message !== '分类不存在') {
                    throw e;
                }
            }
        }
        // 重新分配一级分类的 sort_order（在事务结束前统一处理）
        reorderTopLevelCategories(db);
    });

    tx();

    return { movedBookmarks: totalMoved };
}
