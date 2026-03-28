import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestAppContext } from '../helpers/app';
import { seedBookmarks, seedCategory, seedCategoryTree } from '../helpers/factories';

describe('integration: categories API', () => {
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

    it('returns empty flat and tree category structures for a new database', async () => {
        const flat = await ctx.app.inject({
            method: 'GET',
            url: '/api/categories',
            headers: authHeaders,
        });
        expect(flat.statusCode).toBe(200);
        expect(flat.json()).toEqual({ categories: [] });

        const tree = await ctx.app.inject({
            method: 'GET',
            url: '/api/categories?tree=1',
            headers: authHeaders,
        });
        expect(tree.statusCode).toBe(200);
        expect(tree.json()).toEqual({
            tree: [],
            totalCount: 0,
            uncategorizedCount: 0,
        });
    });

    it('returns flat and tree category data with counts', async () => {
        const categories = seedCategoryTree(ctx.db, [
            { name: 'Tech', children: ['JS'] },
            'Life',
        ]);
        const techId = categories[0].id;
        const jsId = categories[0].children[0].id;

        seedBookmarks(ctx.db, [
            { url: 'https://tech.example.com', title: 'Tech', categoryId: techId },
            { url: 'https://js.example.com', title: 'JS', categoryId: jsId },
            { url: 'https://loose.example.com', title: 'Loose', categoryId: null },
        ]);

        const flat = await ctx.app.inject({
            method: 'GET',
            url: '/api/categories',
            headers: authHeaders,
        });
        expect(flat.statusCode).toBe(200);
        expect(flat.json().categories.map((category: any) => ({
            fullPath: category.fullPath,
            count: category.count,
            level: category.level,
        }))).toEqual([
            { fullPath: 'Tech', count: 1, level: 0 },
            { fullPath: 'Tech/JS', count: 1, level: 1 },
            { fullPath: 'Life', count: 0, level: 0 },
        ]);

        const tree = await ctx.app.inject({
            method: 'GET',
            url: '/api/categories?tree=true',
            headers: authHeaders,
        });
        expect(tree.statusCode).toBe(200);
        expect(tree.json()).toMatchObject({
            totalCount: 3,
            uncategorizedCount: 1,
        });
        expect(tree.json().tree[0]).toMatchObject({
            name: 'Tech',
            count: 1,
            children: [{ fullPath: 'Tech/JS', count: 1 }],
        });
    });

    it('creates top-level, child, and path-based categories and rejects duplicates', async () => {
        const topLevel = await ctx.app.inject({
            method: 'POST',
            url: '/api/categories',
            headers: authHeaders,
            payload: {
                name: 'Tech',
                icon: 'code',
                color: '#111111',
            },
        });
        expect(topLevel.statusCode).toBe(200);
        expect(topLevel.json()).toMatchObject({
            success: true,
            category: {
                name: 'Tech',
                fullPath: 'Tech',
                icon: 'code',
                color: '#111111',
            },
        });

        const topLevelId = topLevel.json().category.id as number;

        const child = await ctx.app.inject({
            method: 'POST',
            url: '/api/categories',
            headers: authHeaders,
            payload: {
                name: 'JavaScript',
                parent_id: topLevelId,
            },
        });
        expect(child.statusCode).toBe(200);
        expect(child.json().category.fullPath).toBe('Tech/JavaScript');

        const pathCreate = await ctx.app.inject({
            method: 'POST',
            url: '/api/categories',
            headers: authHeaders,
            payload: {
                name: 'Life/Travel',
            },
        });
        expect(pathCreate.statusCode).toBe(200);
        expect(pathCreate.json().category.fullPath).toBe('Life/Travel');

        const duplicate = await ctx.app.inject({
            method: 'POST',
            url: '/api/categories',
            headers: authHeaders,
            payload: {
                name: 'Tech',
            },
        });
        expect(duplicate.statusCode).toBe(409);
        expect(duplicate.json()).toEqual({ error: '分类已存在' });
    });

    it('updates category icon and color independently and validates payload presence', async () => {
        const categoryId = seedCategory(ctx.db, 'Styled');

        const iconOnly = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/categories/${categoryId}/style`,
            headers: authHeaders,
            payload: { icon: 'tag' },
        });
        expect(iconOnly.statusCode).toBe(200);
        expect(iconOnly.json().category).toMatchObject({ id: categoryId, icon: 'tag', color: null });

        const colorOnly = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/categories/${categoryId}/style`,
            headers: authHeaders,
            payload: { color: '#ff6600' },
        });
        expect(colorOnly.statusCode).toBe(200);
        expect(colorOnly.json().category).toMatchObject({ id: categoryId, icon: 'tag', color: '#ff6600' });

        const emptyPayload = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/categories/${categoryId}/style`,
            headers: authHeaders,
            payload: {},
        });
        expect(emptyPayload.statusCode).toBe(400);
        expect(emptyPayload.json()).toEqual({ error: '请提供 icon 或 color' });

        const missingCategory = await ctx.app.inject({
            method: 'PATCH',
            url: '/api/categories/999999/style',
            headers: authHeaders,
            payload: { icon: 'ghost' },
        });
        expect(missingCategory.statusCode).toBe(404);
        expect(missingCategory.json()).toEqual({ error: '分类不存在' });
    });

    it('rejects rename conflicts, guards against cyclic moves, and supports moving a child to top level', async () => {
        const tree = seedCategoryTree(ctx.db, [
            { name: 'Tech', children: ['JS'] },
            'Life',
        ]);
        const techId = tree[0].id;
        const jsId = tree[0].children[0].id;
        const lifeId = tree[1].id;

        const renameConflict = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/categories/${lifeId}`,
            headers: authHeaders,
            payload: { name: 'Tech' },
        });
        expect(renameConflict.statusCode).toBe(400);
        expect(renameConflict.json().error).toContain('UNIQUE');

        const cycleMove = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/categories/${techId}/move`,
            headers: authHeaders,
            payload: { parent_id: jsId },
        });
        expect(cycleMove.statusCode).toBe(400);
        expect(cycleMove.json()).toEqual({ error: '目标父分类必须是一级分类（最多支持 2 级）' });

        const moveToTopLevel = await ctx.app.inject({
            method: 'PATCH',
            url: `/api/categories/${jsId}/move`,
            headers: authHeaders,
            payload: { parent_id: null },
        });
        expect(moveToTopLevel.statusCode).toBe(200);
        expect(moveToTopLevel.json().category.fullPath).toBe('JS');

        const moved = ctx.db.prepare('SELECT parent_id, name FROM categories WHERE id = ?').get(jsId) as {
            parent_id: number | null;
            name: string;
        };
        expect(moved).toEqual({ parent_id: null, name: 'JS' });
    });

    it('deletes top-level categories with cascading child removal and bookmark unbinding', async () => {
        const tree = seedCategoryTree(ctx.db, [
            { name: 'Tech', children: ['JS'] },
            'Life',
        ]);
        const techId = tree[0].id;
        const jsId = tree[0].children[0].id;

        seedBookmarks(ctx.db, [
            { url: 'https://parent.example.com', title: 'Parent', categoryId: techId },
            { url: 'https://child.example.com', title: 'Child', categoryId: jsId },
        ]);

        const response = await ctx.app.inject({
            method: 'DELETE',
            url: `/api/categories/${techId}`,
            headers: authHeaders,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true, movedBookmarks: 2 });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM categories WHERE id IN (?, ?)').get(techId, jsId) as { count: number }).count).toBe(0);
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE category_id IS NOT NULL').get() as { count: number }).count).toBe(0);
    });

    it('batch deletes categories and unbinds bookmarks', async () => {
        const firstId = seedCategory(ctx.db, 'First');
        const secondId = seedCategory(ctx.db, 'Second');

        seedBookmarks(ctx.db, [
            { url: 'https://first.example.com', title: 'First', categoryId: firstId },
            { url: 'https://second.example.com', title: 'Second', categoryId: secondId },
        ]);

        const response = await ctx.app.inject({
            method: 'POST',
            url: '/categories/batch-delete',
            headers: authHeaders,
            payload: {
                category_ids: [firstId, secondId],
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true, deleted: 2, movedBookmarks: 2 });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number }).count).toBe(0);
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE category_id IS NOT NULL').get() as { count: number }).count).toBe(0);
    });

    it('reorders top-level categories and validates missing or duplicate ids', async () => {
        const firstId = seedCategory(ctx.db, 'Alpha');
        const secondId = seedCategory(ctx.db, 'Beta');
        const thirdId = seedCategory(ctx.db, 'Gamma');

        const reordered = await ctx.app.inject({
            method: 'POST',
            url: '/api/categories/reorder',
            headers: authHeaders,
            payload: {
                categories: [
                    { id: thirdId, sort_order: 0 },
                    { id: firstId, sort_order: 1 },
                    { id: secondId, sort_order: 2 },
                ],
            },
        });
        expect(reordered.statusCode).toBe(200);
        expect(reordered.json()).toEqual({ success: true });

        const rows = ctx.db.prepare(`
            SELECT id, sort_order
            FROM categories
            WHERE parent_id IS NULL
            ORDER BY sort_order ASC
        `).all() as Array<{ id: number; sort_order: number }>;
        expect(rows).toEqual([
            { id: thirdId, sort_order: 0 },
            { id: firstId, sort_order: 1 },
            { id: secondId, sort_order: 2 },
        ]);

        const missingTopLevel = await ctx.app.inject({
            method: 'POST',
            url: '/api/categories/reorder',
            headers: authHeaders,
            payload: {
                categories: [
                    { id: thirdId, sort_order: 0 },
                    { id: firstId, sort_order: 1 },
                ],
            },
        });
        expect(missingTopLevel.statusCode).toBe(400);
        expect(missingTopLevel.json()).toEqual({ error: '必须包含所有一级分类' });

        const duplicateId = await ctx.app.inject({
            method: 'POST',
            url: '/api/categories/reorder',
            headers: authHeaders,
            payload: {
                categories: [
                    { id: firstId, sort_order: 0 },
                    { id: firstId, sort_order: 1 },
                    { id: secondId, sort_order: 2 },
                ],
            },
        });
        expect(duplicateId.statusCode).toBe(400);
        expect(duplicateId.json()).toEqual({ error: '分类ID不能重复' });
    });
});
