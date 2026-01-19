/**
 * Category API Routes
 * 
 * Handles all /api/categories/* endpoints
 */
import { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
  getCategoryTree,
  getFlatCategories,
  getOrCreateCategoryByPath,
  createTopCategory,
  createSubCategory,
  renameCategory,
  moveCategory,
  deleteCategory as deleteCategoryService,
  deleteCategories as deleteCategoriesService,
  getCategoryById,
  getCategoryFullPath,
} from '../category-service';
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

    if (!name) {
      return reply.code(400).send({ error: '分类名称不能为空' });
    }

    try {
      validateStringLength(name, 200, '分类名称');

      let categoryId: number;
      if (name.includes('/')) {
        // 路径格式，如 "技术/编程"
        categoryId = getOrCreateCategoryByPath(db, name);
      } else if (parentId !== null) {
        // 创建子分类
        categoryId = createSubCategory(db, name, parentId);
      } else {
        // 创建一级分类
        categoryId = createTopCategory(db, name);
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
      renameCategory(db, categoryId, newName);
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
    const newParentId = body.parent_id === null || body.parent_id === '' ? null : toInt(body.parent_id);

    if (typeof categoryId !== 'number') {
      return reply.code(404).send({ error: '分类不存在' });
    }

    try {
      moveCategory(db, categoryId, newParentId);
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
      const result = deleteCategoryService(db, categoryId);
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
      const result = deleteCategoriesService(db, ids);
      req.log.info({ count: ids.length, movedBookmarks: result.movedBookmarks, ids }, 'batch delete categories');
      return reply.send({ success: true, deleted: ids.length, movedBookmarks: result.movedBookmarks });
    } catch (e: any) {
      req.log.error({ err: e }, 'batch delete categories failed');
      return reply.code(500).send({ error: '批量删除失败' });
    }
  });

  done();
};
