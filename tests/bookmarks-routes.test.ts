import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';

import { bookmarkRoutes } from '../src/routes/bookmarks';
import type { Db } from '../src/db';
import { createTestDb, seedBookmarks } from './helpers/db.ts';

describe('bookmarkRoutes', () => {
    let db: Db;
    let cleanup: () => void;
    let app: FastifyInstance;

    beforeEach(async () => {
        const ctx = createTestDb();
        db = ctx.db;
        cleanup = ctx.cleanup;

        app = Fastify();
        await app.register(formbody);
        await app.register(bookmarkRoutes, { db });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        cleanup();
    });

    it('should update bookmark via POST /api/bookmarks/:id/update', async () => {
        const [bookmarkId] = seedBookmarks(db, [{ url: 'https://example.com/old', title: 'old' }]);

        const res = await app.inject({
            method: 'POST',
            url: `/api/bookmarks/${bookmarkId}/update`,
            payload: { url: 'example.com/new', title: 'new title' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });

        const row = db.prepare('SELECT url, canonical_url, title, check_status FROM bookmarks WHERE id = ?').get(bookmarkId) as {
            url: string;
            canonical_url: string;
            title: string;
            check_status: string;
        };
        expect(row.url).toBe('https://example.com/new');
        expect(row.canonical_url).toBe('https://example.com/new');
        expect(row.title).toBe('new title');
        expect(row.check_status).toBe('not_checked');
    });

    it('should accept bookmark_ids[] for POST /bookmarks/batch-delete', async () => {
        const ids = seedBookmarks(db, [
            { url: 'https://a.example.com', title: 'a' },
            { url: 'https://b.example.com', title: 'b' },
            { url: 'https://c.example.com', title: 'c' },
        ]);

        const params = new URLSearchParams();
        params.append('bookmark_ids[]', String(ids[0]));
        params.append('bookmark_ids[]', String(ids[1]));

        const res = await app.inject({
            method: 'POST',
            url: '/bookmarks/batch-delete',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            payload: params.toString(),
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, deleted: 2 });

        const remain = (db.prepare('SELECT COUNT(*) as cnt FROM bookmarks').get() as { cnt: number }).cnt;
        expect(remain).toBe(1);
    });
});
