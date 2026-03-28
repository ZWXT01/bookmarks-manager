import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '../../src/db';
import { getJob, jobQueue } from '../../src/jobs';
import { createTestApp, type TestAppContext } from '../helpers/app';
import { seedBookmarks, seedCategoryTree, seedJob } from '../helpers/factories';

interface CheckBookmarkOptions {
    url: string;
    title: string;
    categoryId?: number | null;
    checkStatus?: 'not_checked' | 'ok' | 'fail';
    skipCheck?: number;
}

function createBookmark(db: Db, options: CheckBookmarkOptions): number {
    const [id] = seedBookmarks(db, [{
        url: options.url,
        title: options.title,
        categoryId: options.categoryId ?? null,
    }]);

    db.prepare(`
        UPDATE bookmarks
        SET check_status = ?, skip_check = ?, last_checked_at = NULL, check_http_code = NULL, check_error = NULL
        WHERE id = ?
    `).run(options.checkStatus ?? 'not_checked', options.skipCheck ?? 0, id);

    return id;
}

function seedScopeFixture(db: Db) {
    const categories = seedCategoryTree(db, ['Work', 'Play']);
    const workId = categories[0].id;
    const playId = categories[1].id;

    const workNotCheckedId = createBookmark(db, {
        url: 'https://work-not-checked.example.com',
        title: 'Work Not Checked',
        categoryId: workId,
        checkStatus: 'not_checked',
    });
    const workFailedId = createBookmark(db, {
        url: 'https://work-failed.example.com',
        title: 'Work Failed',
        categoryId: workId,
        checkStatus: 'fail',
    });
    const playNotCheckedId = createBookmark(db, {
        url: 'https://play-not-checked.example.com',
        title: 'Play Not Checked',
        categoryId: playId,
        checkStatus: 'not_checked',
    });
    const uncategorizedFailedId = createBookmark(db, {
        url: 'https://uncategorized-failed.example.com',
        title: 'Uncategorized Failed',
        checkStatus: 'fail',
    });
    const skippedId = createBookmark(db, {
        url: 'https://skip-check.example.com',
        title: 'Skip Check',
        categoryId: playId,
        checkStatus: 'ok',
        skipCheck: 1,
    });

    return {
        workId,
        playId,
        ids: {
            workNotCheckedId,
            workFailedId,
            playNotCheckedId,
            uncategorizedFailedId,
            skippedId,
        },
    };
}

describe('integration: check routes', () => {
    let ctx: TestAppContext;
    let authHeaders: Record<string, string>;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        ctx = await createTestApp({
            checkConcurrency: 2,
            checkTimeoutMs: 100,
            checkRetries: 0,
            checkRetryDelayMs: 0,
        });
        const session = await ctx.login();
        authHeaders = session.headers;

        fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock as any);
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        if (ctx) await ctx.cleanup();
    });

    const scopeCases = [
        {
            name: 'all',
            buildPayload: () => ({ scope: 'all' }),
            expectedTotal: 4,
            expectedSkipped: 0,
            expectedFetchCalls: 4,
        },
        {
            name: 'not_checked',
            buildPayload: () => ({ scope: 'not_checked' }),
            expectedTotal: 2,
            expectedSkipped: 0,
            expectedFetchCalls: 2,
        },
        {
            name: 'failed',
            buildPayload: () => ({ scope: 'failed' }),
            expectedTotal: 2,
            expectedSkipped: 0,
            expectedFetchCalls: 2,
        },
        {
            name: 'category',
            buildPayload: (fixture: ReturnType<typeof seedScopeFixture>) => ({ scope: 'category', category: String(fixture.workId) }),
            expectedTotal: 2,
            expectedSkipped: 0,
            expectedFetchCalls: 2,
        },
        {
            name: 'categories',
            buildPayload: (fixture: ReturnType<typeof seedScopeFixture>) => ({ scope: 'categories', category_ids: [fixture.workId, fixture.playId] }),
            expectedTotal: 3,
            expectedSkipped: 0,
            expectedFetchCalls: 3,
        },
        {
            name: 'selected',
            buildPayload: (fixture: ReturnType<typeof seedScopeFixture>) => ({
                scope: 'selected',
                bookmark_ids: [fixture.ids.workFailedId, fixture.ids.skippedId],
            }),
            expectedTotal: 2,
            expectedSkipped: 1,
            expectedFetchCalls: 1,
        },
    ] as const;

    for (const scopeCase of scopeCases) {
        it(`starts ${scopeCase.name} check jobs and records side effects`, async () => {
            const fixture = seedScopeFixture(ctx.db);

            const response = await ctx.app.inject({
                method: 'POST',
                url: '/api/check/start',
                headers: authHeaders,
                payload: scopeCase.buildPayload(fixture),
            });

            expect(response.statusCode).toBe(200);
            expect(response.json().success).toBe(true);

            await jobQueue.onIdle();

            const job = getJob(ctx.db, response.json().jobId as string);
            expect(job).not.toBeNull();
            expect(job).toMatchObject({
                status: 'done',
                total: scopeCase.expectedTotal,
                processed: scopeCase.expectedTotal,
                inserted: scopeCase.expectedFetchCalls,
                skipped: scopeCase.expectedSkipped,
                failed: 0,
            });
            expect(fetchMock).toHaveBeenCalledTimes(scopeCase.expectedFetchCalls);
        });
    }

    it('rejects empty selected scopes and invalid categories', async () => {
        seedScopeFixture(ctx.db);

        const emptySelected = await ctx.app.inject({
            method: 'POST',
            url: '/api/check/start',
            headers: authHeaders,
            payload: {
                scope: 'selected',
                bookmark_ids: [],
            },
        });
        expect(emptySelected.statusCode).toBe(400);
        expect(emptySelected.json()).toEqual({ error: 'Operation failed' });

        const invalidCategory = await ctx.app.inject({
            method: 'POST',
            url: '/api/check/start',
            headers: authHeaders,
            payload: {
                scope: 'category',
                category: 'not-a-number',
            },
        });
        expect(invalidCategory.statusCode).toBe(400);
        expect(invalidCategory.json()).toEqual({ error: 'Operation failed' });

        const missingCategory = await ctx.app.inject({
            method: 'POST',
            url: '/api/check/start',
            headers: authHeaders,
            payload: {
                scope: 'category',
                category: '999999',
            },
        });
        expect(missingCategory.statusCode).toBe(400);
        expect(missingCategory.json()).toEqual({ error: 'Operation failed' });
    });

    it('cancels check jobs idempotently and leaves terminal jobs unchanged', async () => {
        const runningJob = seedJob(ctx.db, { id: 'check-running', type: 'check', status: 'running' });
        const doneJob = seedJob(ctx.db, { id: 'check-done', type: 'check', status: 'done' });

        const firstCancel = await ctx.app.inject({
            method: 'POST',
            url: '/api/check/cancel',
            headers: authHeaders,
            payload: { jobId: runningJob.id },
        });
        expect(firstCancel.statusCode).toBe(200);
        expect(firstCancel.json()).toEqual({ success: true, status: 'canceled' });
        expect(getJob(ctx.db, runningJob.id)?.status).toBe('canceled');

        const secondCancel = await ctx.app.inject({
            method: 'POST',
            url: '/api/check/cancel',
            headers: authHeaders,
            payload: { jobId: runningJob.id },
        });
        expect(secondCancel.statusCode).toBe(200);
        expect(secondCancel.json()).toEqual({ success: true, status: 'canceled' });

        const terminalCancel = await ctx.app.inject({
            method: 'POST',
            url: '/api/check/cancel',
            headers: authHeaders,
            payload: { jobId: doneJob.id },
        });
        expect(terminalCancel.statusCode).toBe(200);
        expect(terminalCancel.json()).toEqual({ success: true, status: 'done' });
    });
});
