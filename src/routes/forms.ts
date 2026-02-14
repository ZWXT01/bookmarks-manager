/**
 * Forms Routes - 表单操作路由
 * 处理书签和分类的表单提交操作
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { deleteCategory as deleteCategoryService, getOrCreateCategoryByPath, renameCategory } from '../category-service';
import { canonicalizeUrl } from '../url';
import { toInt, validateStringLength, safeRedirectTarget, withFlash } from '../utils/helpers';

export interface FormsRoutesOptions {
    db: Database;
    safeRedirectTarget: (target: string | undefined, fallback: string) => string;
    withFlash: (url: string, key: 'msg' | 'err', value: string) => string;
}

export const formsRoutes: FastifyPluginCallback<FormsRoutesOptions> = (app, opts, done) => {
    const { db, safeRedirectTarget: redirect, withFlash: flash } = opts;

    // POST /categories - 创建分类
    app.post('/categories', async (req: FastifyRequest<{ Body: { name?: string; redirect?: string } }>, reply: FastifyReply) => {
        const body = req.body || {};
        const redirectTo = redirect(body.redirect, '/');
        const name = (body.name || '').trim();

        if (!name) {
            return reply.redirect(flash(redirectTo, 'err', '分类名称不能为空'));
        }

        try {
            validateStringLength(name, 200, '分类名称');
            getOrCreateCategoryByPath(db, name);
            req.log.info({ categoryName: name }, 'category created');
            return reply.redirect(flash(redirectTo, 'msg', '分类已创建'));
        } catch (e: any) {
            const message = typeof e?.message === 'string' ? e.message : '创建分类失败';
            if (message.includes('UNIQUE')) {
                return reply.redirect(flash(redirectTo, 'err', '分类已存在'));
            }
            req.log.error({ err: e }, 'create category failed');
            return reply.redirect(flash(redirectTo, 'err', '创建分类失败'));
        }
    });

    // POST /categories/:id/update - 更新分类
    app.post('/categories/:id/update', async (req: FastifyRequest<{ Params: { id: string }; Body: { name?: string; redirect?: string } }>, reply: FastifyReply) => {
        const categoryId = toInt(req.params.id);
        const body = req.body || {};
        const redirectTo = redirect(body.redirect, '/');

        if (typeof categoryId !== 'number') {
            return reply.redirect(flash(redirectTo, 'err', '分类不存在'));
        }

        const name = (body.name || '').trim();
        if (!name) {
            return reply.redirect(flash(redirectTo, 'err', '分类名称不能为空'));
        }

        try {
            validateStringLength(name, 200, '分类名称');
            renameCategory(db, categoryId, name);
            req.log.info({ categoryId, newName: name }, 'category updated');
            return reply.redirect(flash(redirectTo, 'msg', '分类已更新'));
        } catch (e: any) {
            const message = typeof e?.message === 'string' ? e.message : '更新失败';
            if (message.includes('UNIQUE')) {
                return reply.redirect(flash(redirectTo, 'err', '分类名称已存在'));
            }
            req.log.error({ err: e }, 'update category failed');
            return reply.redirect(flash(redirectTo, 'err', '更新分类失败'));
        }
    });

    // POST /categories/:id/delete - 删除分类
    app.post('/categories/:id/delete', async (req: FastifyRequest<{ Params: { id: string }; Body: { redirect?: string } }>, reply: FastifyReply) => {
        const categoryId = toInt(req.params.id);
        const body = req.body || {};
        const redirectTo = redirect(body.redirect, '/');

        if (typeof categoryId !== 'number') {
            return reply.redirect(flash(redirectTo, 'err', '分类不存在'));
        }

        try {
            const result = deleteCategoryService(db, categoryId);
            req.log.info({ categoryId, movedBookmarks: result.movedBookmarks }, 'category deleted');
            return reply.redirect(flash(redirectTo, 'msg', '分类已删除'));
        } catch (e: any) {
            req.log.error({ err: e }, 'delete category failed');
            return reply.redirect(flash(redirectTo, 'err', '删除分类失败'));
        }
    });

    // POST /bookmarks - 创建书签
    app.post('/bookmarks', async (req: FastifyRequest<{ Body: { url?: string; title?: string; category_id?: string; redirect?: string } }>, reply: FastifyReply) => {
        const body = req.body || {};
        const redirectTo = redirect(body.redirect, '/');
        const urlInput = (body.url || '').trim();
        const titleInput = (body.title || '').trim();
        const categoryId = toInt(body.category_id);

        if (!urlInput) {
            return reply.redirect(flash(redirectTo, 'err', 'URL不能为空'));
        }

        const canon = canonicalizeUrl(urlInput);
        if (!canon.ok) {
            return reply.redirect(flash(redirectTo, 'err', canon.reason));
        }

        const title = titleInput || canon.normalizedUrl;

        try {
            db.prepare('INSERT INTO bookmarks (url, canonical_url, title, category_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
                canon.normalizedUrl,
                canon.canonicalUrl,
                title,
                categoryId,
                new Date().toISOString()
            );
            req.log.info({ url: urlInput, title, categoryId }, 'bookmark created');
            return reply.redirect(flash(redirectTo, 'msg', '书签已添加'));
        } catch (e: any) {
            const message = typeof e?.message === 'string' ? e.message : '添加失败';
            if (message.includes('UNIQUE')) {
                return reply.redirect(flash(redirectTo, 'err', '该URL已存在（按规范化URL去重）'));
            }
            req.log.error({ err: e }, 'create bookmark failed');
            return reply.redirect(flash(redirectTo, 'err', '添加书签失败'));
        }
    });

    // POST /bookmarks/:id/update - 更新书签
    app.post('/bookmarks/:id/update', async (req: FastifyRequest<{ Params: { id: string }; Body: { url?: string; title?: string; category_id?: string; redirect?: string } }>, reply: FastifyReply) => {
        const bookmarkId = toInt(req.params.id);
        const body = req.body || {};
        const redirectTo = redirect(body.redirect, '/');

        if (typeof bookmarkId !== 'number') {
            return reply.redirect(flash(redirectTo, 'err', '书签不存在'));
        }

        const urlInput = (body.url || '').trim();
        const titleInput = (body.title || '').trim();
        const categoryId = toInt(body.category_id);

        if (!urlInput) {
            return reply.redirect(flash(redirectTo, 'err', 'URL不能为空'));
        }

        const canon = canonicalizeUrl(urlInput);
        if (!canon.ok) {
            return reply.redirect(flash(redirectTo, 'err', canon.reason));
        }

        const title = titleInput || canon.normalizedUrl;

        try {
            const res = db
                .prepare('UPDATE bookmarks SET url = ?, canonical_url = ?, title = ?, category_id = ?, last_checked_at = NULL, check_status = \'not_checked\', check_http_code = NULL, check_error = NULL WHERE id = ?')
                .run(canon.normalizedUrl, canon.canonicalUrl, title, categoryId, bookmarkId);

            if (res.changes === 0) {
                return reply.redirect(flash(redirectTo, 'err', '书签不存在'));
            }
            req.log.info({ bookmarkId, url: urlInput, title, categoryId }, 'bookmark updated');
            return reply.redirect(flash(redirectTo, 'msg', '书签已更新'));
        } catch (e: any) {
            const message = typeof e?.message === 'string' ? e.message : '更新失败';
            if (message.includes('UNIQUE')) {
                return reply.redirect(flash(redirectTo, 'err', '该URL已存在（按规范化URL去重）'));
            }
            req.log.error({ err: e }, 'update bookmark failed');
            return reply.redirect(flash(redirectTo, 'err', '更新书签失败'));
        }
    });

    // POST /bookmarks/:id/delete - 删除书签
    app.post('/bookmarks/:id/delete', async (req: FastifyRequest<{ Params: { id: string }; Body: { redirect?: string } }>, reply: FastifyReply) => {
        const bookmarkId = toInt(req.params.id);
        const wantsJson = /application\/json/i.test((req.headers as any)?.accept || '');
        const body = req.body || {};
        const redirectTo = redirect(body.redirect, '/');

        if (typeof bookmarkId !== 'number') {
            if (wantsJson) return reply.code(404).send({ error: 'Operation failed' });
            return reply.redirect(flash(redirectTo, 'err', '书签不存在'));
        }

        try {
            const res = db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);
            if (res.changes === 0) {
                if (wantsJson) return reply.code(404).send({ error: 'Operation failed' });
                return reply.redirect(flash(redirectTo, 'err', '书签不存在'));
            }
            req.log.info({ bookmarkId }, 'bookmark deleted');
            if (wantsJson) return reply.send({ success: true });
            return reply.redirect(flash(redirectTo, 'msg', '书签已删除'));
        } catch (e: any) {
            req.log.error({ err: e }, 'delete bookmark failed');
            if (wantsJson) return reply.code(500).send({ error: 'Operation failed' });
            return reply.redirect(flash(redirectTo, 'err', '删除书签失败'));
        }
    });

    done();
};
