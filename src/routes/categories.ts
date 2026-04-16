/**
 * Category API Routes
 * 
 * Handles all /api/categories/* endpoints
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
  getCategoryTree,
  getFlatCategories,
  getOrCreateCategoryByPathWithSync,
  createTopCategoryWithSync,
  createSubCategoryWithSync,
  renameCategoryWithSync,
  moveCategoryWithSync,
  deleteCategoryWithSync,
  deleteCategoriesWithSync,
  getCategoryById,
  getCategoryFullPath,
} from '../category-service';
import { syncCategoriesToActiveTemplate } from '../template-service';
import { toInt, validateStringLength } from './types';

export interface CategoryRoutesOptions {
  db: Database;
}

export const categoryRoutes: FastifyPluginCallback<CategoryRoutesOptions> = (app, opts, done) => {
  const { db } = opts;

  // GET /api/categories - 获取分类列表
  app.get('/api/categories', async (req: FastifyRequest, reply: FastifyReply) => {
    const query: any = req.query || {};
    const wantTree = query.tree === 'true' || query.tree === '1';

    try {
      if (wantTree) {
        const tree = getCategoryTree(db);
        const totalCount = (db.prepare('SELECT COUNT(1) AS cnt FROM bookmarks').get() as { cnt: number }).cnt;
        const uncategorizedCount = (db.prepare('SELECT COUNT(1) AS cnt FROM bookmarks WHERE category_id IS NULL').get() as { cnt: number }).cnt;
        return reply.send({ tree, totalCount, uncategorizedCount });
      } else {
        const categories = getFlatCategories(db);
        return reply.send({ categories });
      }
    } catch (e: any) {
      req.log.error({ err: e }, 'get categories failed');
      return reply.code(500).send({ error: '获取分类失败' });
    }
  });

  // POST /api/categories - 创建分类
  app.post('/api/categories', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const parentId = toInt(body.parent_id);
    const icon = typeof body.icon === 'string' ? body.icon.trim() || null : null;
    const color = typeof body.color === 'string' ? body.color.trim() || null : null;

    if (!name) {
      return reply.code(400).send({ error: '分类名称不能为空' });
    }

    try {
      validateStringLength(name, 200, '分类名称');

      let categoryId: number;
      if (name.includes('/')) {
        categoryId = getOrCreateCategoryByPathWithSync(db, name, syncCategoriesToActiveTemplate);
      } else if (parentId !== null) {
        categoryId = createSubCategoryWithSync(db, name, parentId, { icon, color }, syncCategoriesToActiveTemplate);
      } else {
        categoryId = createTopCategoryWithSync(db, name, { icon, color }, syncCategoriesToActiveTemplate);
      }

      const cat = getCategoryById(db, categoryId);
      const fullPath = getCategoryFullPath(db, categoryId);
      return reply.send({
        success: true,
        category: {
          ...cat,
          fullPath,
        },
      });
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : '创建分类失败';
      if (message.includes('UNIQUE')) {
        return reply.code(409).send({ error: '分类已存在' });
      }
      req.log.error({ err: e }, 'api create category failed');
      return reply.code(400).send({ error: message });
    }
  });

  // PATCH /api/categories/:id/style - 更新分类样式
  app.patch('/api/categories/:id/style', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const categoryId = toInt(req.params.id);
    const body: any = req.body || {};

    if (typeof categoryId !== 'number') {
      return reply.code(404).send({ error: '分类不存在' });
    }

    const icon = typeof body.icon === 'string' ? body.icon.trim() || null : undefined;
    const color = typeof body.color === 'string' ? body.color.trim() || null : undefined;

    if (icon === undefined && color === undefined) {
      return reply.code(400).send({ error: '请提供 icon 或 color' });
    }

    try {
      const updates: string[] = [];
      const params: any[] = [];

      if (icon !== undefined) {
        updates.push('icon = ?');
        params.push(icon);
      }
      if (color !== undefined) {
        updates.push('color = ?');
        params.push(color);
      }
      params.push(categoryId);

      const res = db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      if (res.changes === 0) {
        return reply.code(404).send({ error: '分类不存在' });
      }

      const updated = db.prepare('SELECT id, name, icon, color FROM categories WHERE id = ?').get(categoryId);
      return reply.send({ success: true, category: updated });
    } catch (e: any) {
      req.log.error({ err: e }, 'update category style failed');
      return reply.code(500).send({ error: '更新失败' });
    }
  });

  // PATCH /api/categories/:id - 重命名分类
  app.patch('/api/categories/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const categoryId = toInt(req.params.id);
    const body: any = req.body || {};
    const newName = typeof body.name === 'string' ? body.name.trim() : '';

    if (typeof categoryId !== 'number') {
      return reply.code(404).send({ error: '分类不存在' });
    }

    if (!newName) {
      return reply.code(400).send({ error: '分类名称不能为空' });
    }

    try {
      renameCategoryWithSync(db, categoryId, newName, syncCategoriesToActiveTemplate);
      const cat = getCategoryById(db, categoryId);
      const fullPath = getCategoryFullPath(db, categoryId);
      return reply.send({
        success: true,
        category: {
          ...cat,
          fullPath,
        },
      });
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : '重命名失败';
      req.log.error({ err: e }, 'rename category failed');
      return reply.code(400).send({ error: message });
    }
  });

  // PATCH /api/categories/:id/move - 移动分类
  app.patch('/api/categories/:id/move', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const categoryId = toInt(req.params.id);
    const body: any = req.body || {};

    if (typeof categoryId !== 'number') {
      return reply.code(404).send({ error: '分类不存在' });
    }

    // Validate parent_id
    let newParentId: number | null;
    if (body.parent_id === null || body.parent_id === '') {
      newParentId = null;
    } else {
      const parsedParentId = toInt(body.parent_id);
      if (parsedParentId === null) {
        return reply.code(400).send({ error: '无效的父分类ID' });
      }
      newParentId = parsedParentId;
    }

    try {
      moveCategoryWithSync(db, categoryId, newParentId, syncCategoriesToActiveTemplate);
      const cat = getCategoryById(db, categoryId);
      const fullPath = getCategoryFullPath(db, categoryId);
      return reply.send({
        success: true,
        category: {
          ...cat,
          fullPath,
        },
      });
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : '移动失败';
      req.log.error({ err: e }, 'move category failed');
      return reply.code(400).send({ error: message });
    }
  });

  // DELETE /api/categories/:id - 删除分类
  app.delete('/api/categories/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const categoryId = toInt(req.params.id);

    if (typeof categoryId !== 'number') {
      return reply.code(404).send({ error: '分类不存在' });
    }

    try {
      const result = deleteCategoryWithSync(db, categoryId, syncCategoriesToActiveTemplate);
      req.log.info({ categoryId, movedBookmarks: result.movedBookmarks }, 'category deleted');
      return reply.send({
        success: true,
        movedBookmarks: result.movedBookmarks,
      });
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : '删除失败';
      req.log.error({ err: e }, 'delete category failed');
      return reply.code(400).send({ error: message });
    }
  });

  // POST /categories/batch-delete - 批量删除分类
  app.post('/categories/batch-delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const raw = body['category_ids[]'] ?? body.category_ids;
    const ids: number[] = Array.isArray(raw)
      ? raw.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
      : typeof raw === 'string'
        ? [toInt(raw)].filter((n): n is number => n !== null)
        : [];

    if (ids.length === 0) {
      return reply.code(400).send({ error: '请选择要删除的分类' });
    }

    if (ids.length > 100) {
      return reply.code(400).send({ error: '一次最多删除100个分类' });
    }

    try {
      const result = deleteCategoriesWithSync(db, ids, syncCategoriesToActiveTemplate);
      req.log.info({ count: ids.length, movedBookmarks: result.movedBookmarks, ids }, 'batch delete categories');
      return reply.send({ success: true, deleted: ids.length, movedBookmarks: result.movedBookmarks });
    } catch (e: any) {
      req.log.error({ err: e }, 'batch delete categories failed');
      return reply.code(500).send({ error: '批量删除失败' });
    }
  });

  // POST /api/categories/reorder - 更新分类排序
  app.post('/api/categories/reorder', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const categories = body.categories;

    if (!Array.isArray(categories)) {
      return reply.code(400).send({ error: '无效的请求数据' });
    }

    if (categories.length === 0) {
      return reply.code(400).send({ error: '分类列表不能为空' });
    }

    if (categories.length > 1000) {
      return reply.code(400).send({ error: '一次最多排序1000个分类' });
    }

    try {
      // Validate each element is an object with required properties
      for (const item of categories) {
        if (!item || typeof item !== 'object') {
          return reply.code(400).send({ error: '分类数据格式错误' });
        }
        if (!('id' in item) || !('sort_order' in item)) {
          return reply.code(400).send({ error: '分类数据缺少必需字段' });
        }
      }

      // Extract and validate IDs and sort_order values
      const ids = categories.map((item: any) => toInt(item.id)).filter((id): id is number => id !== null);
      if (ids.length !== categories.length) {
        return reply.code(400).send({ error: '包含无效的分类ID' });
      }

      const sortOrders = categories.map((item: any) => toInt(item.sort_order)).filter((order): order is number => order !== null);
      if (sortOrders.length !== categories.length) {
        return reply.code(400).send({ error: '包含无效的排序值' });
      }

      // Validate sort_order values are non-negative
      if (sortOrders.some(order => order < 0)) {
        return reply.code(400).send({ error: '排序值不能为负数' });
      }

      // Check for duplicate IDs first
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== ids.length) {
        return reply.code(400).send({ error: '分类ID不能重复' });
      }

      // Check for duplicate sort_order values
      const uniqueSortOrders = new Set(sortOrders);
      if (uniqueSortOrders.size !== sortOrders.length) {
        return reply.code(400).send({ error: '排序值不能重复' });
      }

      // Validate sort_order values form a continuous sequence starting from 0
      const sortedOrders = [...sortOrders].sort((a, b) => a - b);
      for (let i = 0; i < sortedOrders.length; i++) {
        if (sortedOrders[i] !== i) {
          return reply.code(400).send({ error: '排序值必须是从0开始的连续整数' });
        }
      }

      // Validate all IDs exist and are top-level categories
      const placeholders = ids.map(() => '?').join(',');
      const existingCategories = db.prepare(
        `SELECT id FROM categories WHERE id IN (${placeholders}) AND parent_id IS NULL`
      ).all(...ids) as Array<{ id: number }>;

      if (existingCategories.length !== ids.length) {
        return reply.code(400).send({ error: '部分分类不存在或不是一级分类' });
      }

      // Validate that the request includes all top-level categories
      const allTopLevelCount = (db.prepare('SELECT COUNT(*) as cnt FROM categories WHERE parent_id IS NULL').get() as { cnt: number }).cnt;
      if (ids.length !== allTopLevelCount) {
        return reply.code(400).send({ error: '必须包含所有一级分类' });
      }

      const stmt = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
      const transaction = db.transaction((items: Array<{ id: number; sort_order: number }>) => {
        let totalChanges = 0;
        for (const item of items) {
          const id = toInt(item.id);
          const sortOrder = toInt(item.sort_order);
          if (id === null || sortOrder === null) {
            throw new Error('Invalid id or sort_order');
          }
          const result = stmt.run(sortOrder, id);
          totalChanges += result.changes;
        }
        if (totalChanges !== items.length) {
          throw new Error('Some categories were not updated');
        }
        // 同步到活动模板
        syncCategoriesToActiveTemplate(db);
      });

      transaction(categories);
      req.log.info({ count: categories.length }, 'categories reordered');
      return reply.send({ success: true });
    } catch (e: any) {
      req.log.error({ err: e }, 'reorder categories failed');
      const message = e.message || '更新排序失败';
      return reply.code(500).send({ error: message });
    }
  });

  done();
};
