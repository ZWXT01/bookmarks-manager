import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../../src/db';
import { createTestApp, type TestAppContext } from '../helpers/app';
import { seedBookmarks, seedCategoryTree } from '../helpers/factories';

interface BookmarkSeedOptions {
    url: string;
    title: string;
    categoryId?: number | null;
    createdAt?: string;
    checkStatus?: 'not_checked' | 'ok' | 'fail';
    lastCheckedAt?: string | null;
    checkHttpCode?: number | null;
    checkError?: string | null;
    skipCheck?: number;
    description?: string | null;
    isStarred?: number;
}

function createBookmark(db: Db, options: BookmarkSeedOptions): number {
    const [id] = seedBookmarks(db, [{
        url: options.url,
        title: options.title,
        categoryId: options.categoryId ?? null,
    }]);
    const createdAt = options.createdAt ?? '2026-03-01T00:00:00.000Z';

    db.prepare(`
        UPDATE bookmarks
        SET created_at = ?, updated_at = ?, check_status = ?, last_checked_at = ?, check_http_code = ?,
            check_error = ?, skip_check = ?, description = ?, is_starred = ?
        WHERE id = ?
    `).run(
        createdAt,
        createdAt,
        options.checkStatus ?? 'not_checked',
        options.lastCheckedAt ?? null,
        options.checkHttpCode ?? null,
        options.checkError ?? null,
        options.skipCheck ?? 0,
        options.description ?? null,
        options.isStarred ?? 0,
        id,
    );

    return id;
}

function sortNumbers(values: number[]): number[] {
    return [...values].sort((a, b) => a - b);
}

describe('integration: bookmarks API', () => {
    let ctx: TestAppContext;
    let authHeaders: Record<string, string>;

    beforeEach(async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        authHeaders = session.headers;
    });

    afterEach(async () => {
        if (ctx) await ctx.cleanup();
    });

    it('lists bookmarks with pagination and falls back to id sorting for invalid sort keys', async () => {
        const ids: number[] = [];

        for (let index = 1; index <= 12; index += 1) {
            ids.push(createBookmark(ctx.db, {
                url: `https://page-${index}.example.com`,
                title: `Bookmark ${String(index).padStart(2, '0')}`,
                createdAt: `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`,
            }));
        }

        const paginated = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks?page=2&pageSize=10&sort=created_at&order=asc',
            headers: authHeaders,
        });

        expect(paginated.statusCode).toBe(200);
        expect(paginated.json()).toMatchObject({
            total: 12,
            page: 2,
            pageSize: 10,
            totalPages: 2,
        });
        expect(paginated.json().bookmarks.map((bookmark: any) => bookmark.title)).toEqual(['Bookmark 11', 'Bookmark 12']);

        const fallbackSort = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks?sort=unsupported&order=asc',
            headers: authHeaders,
        });

        expect(fallbackSort.statusCode).toBe(200);
        expect(fallbackSort.json().bookmarks[0].id).toBe(Math.min(...ids));
        expect(fallbackSort.json().bookmarks[fallbackSort.json().bookmarks.length - 1].id).toBe(Math.max(...ids));
    });

    it('filters bookmarks by category, uncategorized, search keywords, status, date range, and domain', async () => {
        const categories = seedCategoryTree(ctx.db, ['Tech', 'Life']);
        const techId = categories[0].id;
        const lifeId = categories[1].id;

        const techMatchId = createBookmark(ctx.db, {
            url: 'https://docs.example.com/beta-guide',
            title: 'Alpha Handbook',
            categoryId: techId,
            createdAt: '2026-03-05T08:00:00.000Z',
            checkStatus: 'ok',
        });
        const techFailId = createBookmark(ctx.db, {
            url: 'https://dev.example.com/alpha-only',
            title: 'Failure Bookmark',
            categoryId: techId,
            createdAt: '2026-01-15T08:00:00.000Z',
            checkStatus: 'fail',
        });
        const lifeId1 = createBookmark(ctx.db, {
            url: 'https://life.test/beta-only',
            title: 'Leisure',
            categoryId: lifeId,
            createdAt: '2026-02-10T08:00:00.000Z',
            checkStatus: 'not_checked',
        });
        const uncategorizedId = createBookmark(ctx.db, {
            url: 'https://plain.test/no-category',
            title: 'Loose Bookmark',
            createdAt: '2026-03-20T08:00:00.000Z',
            checkStatus: 'not_checked',
        });

        const categoryResponse = await ctx.app.inject({
            method: 'GET',
            url: `/api/bookmarks?category=${techId}`,
            headers: authHeaders,
        });
        expect(categoryResponse.statusCode).toBe(200);
        expect(categoryResponse.json().total).toBe(2);
        expect(categoryResponse.json().bookmarks.every((bookmark: any) => bookmark.category_id === techId)).toBe(true);

        const uncategorizedResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks?category=uncategorized',
            headers: authHeaders,
        });
        expect(uncategorizedResponse.statusCode).toBe(200);
        expect(uncategorizedResponse.json().total).toBe(1);
        expect(uncategorizedResponse.json().bookmarks[0].id).toBe(uncategorizedId);

        const searchResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks?q=alpha%20beta',
            headers: authHeaders,
        });
        expect(searchResponse.statusCode).toBe(200);
        expect(searchResponse.json().total).toBe(1);
        expect(searchResponse.json().bookmarks[0].id).toBe(techMatchId);

        const statusResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks?status=fail',
            headers: authHeaders,
        });
        expect(statusResponse.statusCode).toBe(200);
        expect(statusResponse.json().total).toBe(1);
        expect(statusResponse.json().bookmarks[0].id).toBe(techFailId);

        const dateRangeResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks?date_from=2026-03-01&date_to=2026-03-31',
            headers: authHeaders,
        });
        expect(dateRangeResponse.statusCode).toBe(200);
        expect(sortNumbers(dateRangeResponse.json().bookmarks.map((bookmark: any) => bookmark.id))).toEqual(sortNumbers([techMatchId, uncategorizedId]));

        const domainResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks?domain=example.com',
            headers: authHeaders,
        });
        expect(domainResponse.statusCode).toBe(200);
        expect(sortNumbers(domainResponse.json().bookmarks.map((bookmark: any) => bookmark.id))).toEqual(sortNumbers([techMatchId, techFailId]));

        expect(lifeId1).toBeGreaterThan(0);
    });

    it('creates bookmarks with default titles and rejects canonical duplicates', async () => {
        const created = await ctx.app.inject({
            method: 'POST',
            url: '/api/bookmarks',
            headers: authHeaders,
            payload: {
                url: 'example.com/path',
                title: '   ',
            },
        });

        expect(created.statusCode).toBe(200);
        expect(created.json().bookmark.title).toBe('https://example.com/path');

        const duplicate = await ctx.app.inject({
            method: 'POST',
            url: '/api/bookmarks',
            headers: authHeaders,
            payload: {
                url: 'https://example.com/path/',
                title: 'Duplicate',
            },
        });

        expect(duplicate.statusCode).toBe(409);
        expect(duplicate.json()).toEqual({ error: '书签已存在' });
    });

    it('rejects empty and invalid bookmark URLs', async () => {
        const empty = await ctx.app.inject({
            method: 'POST',
            url: '/api/bookmarks',
            headers: authHeaders,
            payload: { url: '   ' },
        });

        expect(empty.statusCode).toBe(400);
        expect(empty.json()).toEqual({ error: 'URL不能为空' });

        const invalid = await ctx.app.inject({
            method: 'POST',
            url: '/api/bookmarks',
            headers: authHeaders,
            payload: { url: 'bad url' },
        });

        expect(invalid.statusCode).toBe(400);
        expect(invalid.json()).toEqual({ error: 'URL格式无效' });
    });

    it('updates bookmarks, resets check state, rejects URL conflicts, and returns 404 for missing records', async () => {
        const [bookmarkId, existingId] = seedBookmarks(ctx.db, [
            { url: 'https://old.example.com/item', title: 'Old Item' },
            { url: 'https://taken.example.com/path', title: 'Taken' },
        ]);
        ctx.db.prepare(`
            UPDATE bookmarks
            SET check_status = 'fail', last_checked_at = ?, check_http_code = ?, check_error = ?
            WHERE id = ?
        `).run('2026-02-01T00:00:00.000Z', 500, 'boom', bookmarkId);

        const updated = await ctx.app.inject({
            method: 'POST',
            url: `/api/bookmarks/${bookmarkId}/update`,
            headers: authHeaders,
            payload: {
                url: 'fresh.example.com/new-item',
                title: 'Fresh Title',
                category_id: '',
            },
        });

        expect(updated.statusCode).toBe(200);
        expect(updated.json()).toEqual({ success: true });

        const row = ctx.db.prepare(`
            SELECT url, title, category_id, check_status, last_checked_at, check_http_code, check_error
            FROM bookmarks
            WHERE id = ?
        `).get(bookmarkId) as {
            url: string;
            title: string;
            category_id: number | null;
            check_status: string;
            last_checked_at: string | null;
            check_http_code: number | null;
            check_error: string | null;
        };

        expect(row).toEqual({
            url: 'https://fresh.example.com/new-item',
            title: 'Fresh Title',
            category_id: null,
            check_status: 'not_checked',
            last_checked_at: null,
            check_http_code: null,
            check_error: null,
        });

        const conflict = await ctx.app.inject({
            method: 'POST',
            url: `/api/bookmarks/${bookmarkId}/update`,
            headers: authHeaders,
            payload: {
                url: 'https://taken.example.com/path/',
                title: 'Still Conflicting',
            },
        });

        expect(conflict.statusCode).toBe(409);
        expect(conflict.json()).toEqual({ error: '该URL已存在（按规范化URL去重）' });
        expect(existingId).toBeGreaterThan(0);

        const missing = await ctx.app.inject({
            method: 'POST',
            url: '/api/bookmarks/999999/update',
            headers: authHeaders,
            payload: {
                url: 'https://missing.example.com',
                title: 'Missing',
            },
        });

        expect(missing.statusCode).toBe(404);
        expect(missing.json()).toEqual({ error: '书签不存在' });
    });

    it('patches bookmark status, skip-check, star, and description fields', async () => {
        const [bookmarkId] = seedBookmarks(ctx.db, [{ url: 'https://patch.example.com', title: 'Patch Target' }]);

        const statusResponse = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/bookmarks/${bookmarkId}/status`,
            headers: authHeaders,
            payload: { status: 'ok' },
        });
        expect(statusResponse.statusCode).toBe(200);
        expect(statusResponse.json()).toEqual({ success: true });

        const skipResponse = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/bookmarks/${bookmarkId}/skip-check`,
            headers: authHeaders,
            payload: { skip_check: true },
        });
        expect(skipResponse.statusCode).toBe(200);
        expect(skipResponse.json()).toEqual({ success: true, skip_check: true });

        const starResponse = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/bookmarks/${bookmarkId}/star`,
            headers: authHeaders,
            payload: { is_starred: true },
        });
        expect(starResponse.statusCode).toBe(200);
        expect(starResponse.json()).toEqual({ success: true, is_starred: true });

        const descriptionResponse = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/bookmarks/${bookmarkId}/description`,
            headers: authHeaders,
            payload: { description: 'Saved description' },
        });
        expect(descriptionResponse.statusCode).toBe(200);
        expect(descriptionResponse.json()).toEqual({ success: true, description: 'Saved description' });

        const row = ctx.db.prepare(`
            SELECT check_status, skip_check, is_starred, description
            FROM bookmarks
            WHERE id = ?
        `).get(bookmarkId) as {
            check_status: string;
            skip_check: number;
            is_starred: number;
            description: string | null;
        };

        expect(row).toEqual({
            check_status: 'ok',
            skip_check: 1,
            is_starred: 1,
            description: 'Saved description',
        });
    });

    it('rejects invalid patch payloads and missing bookmarks', async () => {
        const [bookmarkId] = seedBookmarks(ctx.db, [{ url: 'https://invalid-patch.example.com', title: 'Patch Target' }]);

        const invalidStatus = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/bookmarks/${bookmarkId}/status`,
            headers: authHeaders,
            payload: { status: 'broken' },
        });
        expect(invalidStatus.statusCode).toBe(400);
        expect(invalidStatus.json()).toEqual({ error: '无效的状态值' });

        const longDescription = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/bookmarks/${bookmarkId}/description`,
            headers: authHeaders,
            payload: { description: 'x'.repeat(2001) },
        });
        expect(longDescription.statusCode).toBe(500);
        expect(longDescription.json().error).toContain('书签描述长度不能超过 2000 字符');

        const missingBookmark = await ctx.app.inject({
            method: 'PATCH',
            url: '/api/bookmarks/999999/star',
            headers: authHeaders,
            payload: { is_starred: true },
        });
        expect(missingBookmark.statusCode).toBe(404);
        expect(missingBookmark.json()).toEqual({ error: '书签不存在' });
    });

    it('moves single and multiple bookmarks and supports uncategorized targets', async () => {
        const categories = seedCategoryTree(ctx.db, ['Source', 'Target']);
        const sourceId = categories[0].id;
        const targetId = categories[1].id;
        const ids = seedBookmarks(ctx.db, [
            { url: 'https://move-1.example.com', title: 'Move 1', categoryId: sourceId },
            { url: 'https://move-2.example.com', title: 'Move 2', categoryId: sourceId },
            { url: 'https://move-3.example.com', title: 'Move 3', categoryId: sourceId },
        ]);

        const singleMove = await ctx.app.inject({
            method: 'POST',
            url: '/api/bookmarks/move',
            headers: authHeaders,
            payload: {
                bookmark_ids: [ids[0]],
                target_category: String(targetId),
            },
        });
        expect(singleMove.statusCode).toBe(200);
        expect(singleMove.json()).toEqual({ success: true, updated: 1 });

        const singleRow = ctx.db.prepare('SELECT category_id FROM bookmarks WHERE id = ?').get(ids[0]) as { category_id: number | null };
        expect(singleRow.category_id).toBe(targetId);

        const multiMove = await ctx.app.inject({
            method: 'POST',
            url: '/api/bookmarks/move',
            headers: authHeaders,
            payload: {
                bookmark_ids: [ids[0], ids[1]],
                target_category: 'uncategorized',
            },
        });
        expect(multiMove.statusCode).toBe(200);
        expect(multiMove.json()).toEqual({ success: true, updated: 2 });

        const movedRows = ctx.db.prepare('SELECT id, category_id FROM bookmarks WHERE id IN (?, ?) ORDER BY id').all(ids[0], ids[1]) as Array<{ id: number; category_id: number | null }>;
        expect(movedRows.every((row) => row.category_id === null)).toBe(true);

        const missingTarget = await ctx.app.inject({
            method: 'POST',
            url: '/api/bookmarks/move',
            headers: authHeaders,
            payload: {
                bookmark_ids: [ids[2]],
                target_category: '999999',
            },
        });
        expect(missingTarget.statusCode).toBe(404);
        expect(missingTarget.json()).toEqual({ error: '分类不存在' });
    });

    it('deletes bookmarks through single-delete and batch-delete JSON/form entry points', async () => {
        const ids = seedBookmarks(ctx.db, [
            { url: 'https://delete-1.example.com', title: 'Delete 1' },
            { url: 'https://delete-2.example.com', title: 'Delete 2' },
            { url: 'https://delete-3.example.com', title: 'Delete 3' },
            { url: 'https://delete-4.example.com', title: 'Delete 4' },
        ]);

        const singleDelete = await ctx.app.inject({
            method: 'DELETE',
            url: `/api/bookmarks/${ids[0]}`,
            headers: authHeaders,
        });
        expect(singleDelete.statusCode).toBe(200);
        expect(singleDelete.json()).toEqual({ success: true });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count).toBe(3);

        const batchJsonDelete = await ctx.app.inject({
            method: 'POST',
            url: '/bookmarks/batch-delete',
            headers: authHeaders,
            payload: { ids: [ids[1], ids[2]] },
        });
        expect(batchJsonDelete.statusCode).toBe(200);
        expect(batchJsonDelete.json()).toEqual({ success: true, deleted: 2 });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count).toBe(1);

        const form = new URLSearchParams();
        form.append('bookmark_ids[]', String(ids[3]));
        const batchFormDelete = await ctx.app.inject({
            method: 'POST',
            url: '/bookmarks/batch-delete',
            headers: {
                ...authHeaders,
                'content-type': 'application/x-www-form-urlencoded',
            },
            payload: form.toString(),
        });
        expect(batchFormDelete.statusCode).toBe(200);
        expect(batchFormDelete.json()).toEqual({ success: true, deleted: 1 });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count).toBe(0);

        const missingDelete = await ctx.app.inject({
            method: 'DELETE',
            url: '/api/bookmarks/999999',
            headers: authHeaders,
        });
        expect(missingDelete.statusCode).toBe(404);
        expect(missingDelete.json()).toEqual({ error: '书签不存在' });
    });
});
