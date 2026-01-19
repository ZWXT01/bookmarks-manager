/**
 * Bookmark API Routes
 * 
 * Handles all /api/bookmarks/* endpoints
 */
import { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { canonicalizeUrl } from '../url';
import { toInt, validateStringLength } from './types';

export interface BookmarkRoutesOptions {
    db: Database;
}

export const bookmarkRoutes: FastifyPluginCallback<BookmarkRoutesOptions> = (app, opts, done) => {
    const { db } = opts;

    // GET /api/bookmarks 路由保留在 index.ts (支持更多筛选参数)

    // POST /api/bookmarks - 创建书签
    app.post('/api/bookmarks', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const urlInput = typeof body.url === 'string' ? body.url.trim() : '';
        const titleInput = typeof body.title === 'string' ? body.title.trim() : '';
        const categoryId = toInt(body.category_id);

        if (!urlInput) return reply.code(400).send({ error: 'URL不能为空' });

        const canon = canonicalizeUrl(urlInput);
        if (!canon.ok) return reply.code(400).send({ error: canon.reason });

        const title = titleInput || canon.normalizedUrl;

        try {
            const res = db
                .prepare('INSERT INTO bookmarks (url, canonical_url, title, category_id, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(canon.normalizedUrl, canon.canonicalUrl, title, categoryId, new Date().toISOString());

            const id = Number(res.lastInsertRowid);
            const row = db
                .prepare('SELECT b.id, b.url, b.title, b.created_at, b.check_status, b.last_checked_at, b.check_http_code, b.check_error, c.name as category_name FROM bookmarks b LEFT JOIN categories c ON b.category_id = c.id WHERE b.id = ?')
                .get(id);

            return reply.send({ bookmark: row });
        } catch (e: any) {
            const message = typeof e?.message === 'string' ? e.message : '添加失败';
            if (message.includes('UNIQUE')) {
                return reply.code(409).send({ error: '书签已存在' });
            }
            req.log.error({ err: e }, 'api create bookmark failed');
            return reply.code(500).send({ error: '添加失败' });
        }
    });

    // POST /api/bookmarks/move - 批量移动书签
    app.post('/api/bookmarks/move', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};

        const raw = body['bookmark_ids[]'] ?? body.bookmark_ids;
        const ids: number[] = Array.isArray(raw)
            ? raw.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
            : typeof raw === 'string'
                ? [toInt(raw)].filter((n): n is number => n !== null)
                : [];

        if (ids.length === 0) {
            return reply.code(400).send({ error: '请选择要移动的书签' });
        }

        const rawTarget = body.target_category ?? body.targetCategory ?? body.category ?? body.category_id;
        const targetStr = typeof rawTarget === 'string' ? rawTarget : typeof rawTarget === 'number' ? String(rawTarget) : '';
        if (!targetStr) {
            return reply.code(400).send({ error: '请选择目标分类' });
        }

        const targetCategoryId = targetStr === 'uncategorized' ? null : toInt(targetStr);
        if (targetStr !== 'uncategorized' && targetCategoryId === null) {
            return reply.code(400).send({ error: '无效的分类' });
        }

        if (typeof targetCategoryId === 'number') {
            const exists = db.prepare('SELECT 1 AS ok FROM categories WHERE id = ?').get(targetCategoryId) as { ok: 1 } | undefined;
            if (!exists) {
                return reply.code(404).send({ error: '分类不存在' });
            }
        }

        try {
            const placeholders = ids.map(() => '?').join(',');
            const res = db
                .prepare('UPDATE bookmarks SET category_id = ? WHERE id IN (' + placeholders + ')')
                .run(targetCategoryId, ...ids);
            req.log.info({ count: res.changes, ids, targetCategoryId }, 'move bookmarks');
            return reply.send({ success: true, updated: res.changes });
        } catch (e: any) {
            req.log.error({ err: e }, 'move bookmarks failed');
            return reply.code(500).send({ error: '移动失败' });
        }
    });

    // PATCH /api/bookmarks/:id/status - 更新书签状态
    app.patch('/api/bookmarks/:id/status', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const bookmarkId = toInt(req.params.id);
        const body: any = req.body || {};
        if (typeof bookmarkId !== 'number') return reply.code(404).send({ error: '书签不存在' });

        const newStatus = body.status;
        if (!newStatus || !['not_checked', 'ok', 'fail'].includes(newStatus)) {
            return reply.code(400).send({ error: '无效的状态值' });
        }

        try {
            const res = db.prepare('UPDATE bookmarks SET check_status = ? WHERE id = ?').run(newStatus, bookmarkId);
            if (res.changes === 0) return reply.code(404).send({ error: '书签不存在' });
            return reply.send({ success: true });
        } catch (e: any) {
            req.log.error({ err: e }, 'update bookmark status failed');
            return reply.code(500).send({ error: '更新失败' });
        }
    });

    // PATCH /api/bookmarks/:id/skip-check - 切换跳过检查
    app.patch('/api/bookmarks/:id/skip-check', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const bookmarkId = toInt(req.params.id);
        const body: any = req.body || {};
        if (typeof bookmarkId !== 'number') return reply.code(404).send({ error: '书签不存在' });

        const skipCheck = body.skip_check === true || body.skip_check === 1 || body.skip_check === '1';

        try {
            const res = db.prepare('UPDATE bookmarks SET skip_check = ? WHERE id = ?').run(skipCheck ? 1 : 0, bookmarkId);
            if (res.changes === 0) return reply.code(404).send({ error: '书签不存在' });
            return reply.send({ success: true, skip_check: skipCheck });
        } catch (e: any) {
            req.log.error({ err: e }, 'update bookmark skip_check failed');
            return reply.code(500).send({ error: '更新失败' });
        }
    });

    // PATCH /api/bookmarks/:id/star - 收藏/取消收藏
    app.patch('/api/bookmarks/:id/star', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const bookmarkId = toInt(req.params.id);
        const body: any = req.body || {};
        if (typeof bookmarkId !== 'number') return reply.code(404).send({ error: '书签不存在' });

        const isStarred = body.is_starred === true || body.is_starred === 1 || body.is_starred === '1';

        try {
            const res = db.prepare('UPDATE bookmarks SET is_starred = ? WHERE id = ?').run(isStarred ? 1 : 0, bookmarkId);
            if (res.changes === 0) return reply.code(404).send({ error: '书签不存在' });
            return reply.send({ success: true, is_starred: isStarred });
        } catch (e: any) {
            req.log.error({ err: e }, 'update bookmark is_starred failed');
            return reply.code(500).send({ error: '更新失败' });
        }
    });

    // PATCH /api/bookmarks/:id/description - 更新描述
    app.patch('/api/bookmarks/:id/description', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const bookmarkId = toInt(req.params.id);
        const body: any = req.body || {};
        if (typeof bookmarkId !== 'number') return reply.code(404).send({ error: '书签不存在' });

        const description = typeof body.description === 'string' ? body.description.trim() : null;

        try {
            if (description) {
                validateStringLength(description, 2000, '书签描述');
            }
            const res = db.prepare('UPDATE bookmarks SET description = ? WHERE id = ?').run(description || null, bookmarkId);
            if (res.changes === 0) return reply.code(404).send({ error: '书签不存在' });
            return reply.send({ success: true, description });
        } catch (e: any) {
            req.log.error({ err: e }, 'update bookmark description failed');
            return reply.code(500).send({ error: e.message || '更新失败' });
        }
    });

    // POST /api/bookmarks/delete-all - 删除所有书签
    app.post('/api/bookmarks/delete-all', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            const res = db.prepare('DELETE FROM bookmarks').run();
            return reply.send({ success: true, deleted: res.changes });
        } catch (e: any) {
            return reply.code(500).send({ error: '删除失败' });
        }
    });

    // DELETE /api/bookmarks/:id - 删除单个书签
    app.delete('/api/bookmarks/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const bookmarkId = toInt(req.params.id);
        if (typeof bookmarkId !== 'number') return reply.code(404).send({ error: '书签不存在' });

        try {
            const res = db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);
            if (res.changes === 0) return reply.code(404).send({ error: '书签不存在' });
            return reply.send({ success: true });
        } catch (e: any) {
            req.log.error({ err: e }, 'delete bookmark failed');
            return reply.code(500).send({ error: '删除失败' });
        }
    });

    // POST /bookmarks/batch-delete - 批量删除书签
    app.post('/bookmarks/batch-delete', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const ids = body.ids;

        if (!Array.isArray(ids) || ids.length === 0) {
            return reply.code(400).send({ error: '缺少 ids 参数' });
        }

        try {
            let deleted = 0;
            for (const id of ids) {
                const numId = Number(id);
                if (!Number.isInteger(numId)) continue;

                const res = db.prepare('DELETE FROM bookmarks WHERE id = ?').run(numId);
                if (res.changes > 0) deleted++;
            }
            return reply.send({ success: true, deleted });
        } catch (e: any) {
            req.log.error({ err: e }, 'batch delete bookmarks failed');
            return reply.code(500).send({ error: '批量删除失败' });
        }
    });

    done();
};
