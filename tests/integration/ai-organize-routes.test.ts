import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPlan, getPlan, transitionStatus, updatePlan } from '../../src/ai-organize-plan';
import { getCategoryByPath, getCategoryFullPath, getOrCreateCategoryByPath, renameCategory } from '../../src/category-service';
import { getJob, jobQueue } from '../../src/jobs';
import { createTestApp, type TestAppContext } from '../helpers/app';
import {
    seedAiTestCategories,
    createQueuedAIHarness,
    jsonCompletion,
    seedAISettings,
    type MockAIStep,
} from '../helpers/ai';
import { seedBookmarks, seedJob, seedPlan } from '../helpers/factories';

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function waitForCondition(check: () => boolean, timeoutMs = 2_000): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (check()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(check()).toBe(true);
}

function buildAssignments(count: number, category: string, invalidIndex?: number) {
    return Array.from({ length: count }, (_, index) => ({
        index: index + 1,
        category: invalidIndex === index ? '不存在/分类' : category,
    }));
}

function getBookmarkCategoryId(ctx: TestAppContext, bookmarkId: number): number | null {
    const row = ctx.db.prepare('SELECT category_id FROM bookmarks WHERE id = ?').get(bookmarkId) as { category_id: number | null } | undefined;
    return row?.category_id ?? null;
}

describe('integration: ai organize route contracts', () => {
    let ctx: TestAppContext | null = null;

    afterEach(async () => {
        vi.useRealTimers();
        if (!ctx) return;
        await ctx.cleanup();
        ctx = null;
    });

    async function createHarnessApp(steps: MockAIStep[] = []) {
        const harness = createQueuedAIHarness(steps);
        ctx = await createTestApp({ aiClientFactory: harness.aiClientFactory });
        const session = await ctx.login();
        return {
            ctx,
            harness,
            authHeaders: session.headers,
        };
    }

    it('covers organize start, active and pending plans, plan detail, assignments paging, and configured batch size', async () => {
        const deferred = createDeferred<ReturnType<typeof jsonCompletion>>();
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([() => deferred.promise]);
        seedAISettings(appCtx.db, { batchSize: 30 });
        seedAiTestCategories(appCtx.db);

        const bookmarkIds = seedBookmarks(appCtx.db, Array.from({ length: 25 }, (_, index) => ({
            title: `Bookmark ${index + 1}`,
            url: `https://organize-${index + 1}.example.test`,
        })));

        const startResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: { scope: 'all' },
        });

        expect(startResponse.statusCode).toBe(200);
        expect(startResponse.json()).toMatchObject({ success: true });

        const { planId, jobId } = startResponse.json() as { planId: string; jobId: string };
        await waitForCondition(() => harness.calls.length === 1);

        const activeResponse = await appCtx.app.inject({
            method: 'GET',
            url: '/api/ai/organize/active',
            headers: authHeaders,
        });
        expect(activeResponse.statusCode).toBe(200);
        expect(activeResponse.json()).toMatchObject({
            id: planId,
            job_id: jobId,
            status: 'assigning',
        });

        const pendingWhileAssigning = await appCtx.app.inject({
            method: 'GET',
            url: '/api/ai/organize/pending',
            headers: authHeaders,
        });
        expect(pendingWhileAssigning.statusCode).toBe(200);
        expect(pendingWhileAssigning.json()).toEqual({ plans: [] });

        deferred.resolve(jsonCompletion({
            assignments: buildAssignments(bookmarkIds.length, '技术开发/前端', bookmarkIds.length - 1),
        }));
        await waitForCondition(() => getPlan(appCtx.db, planId)?.status === 'preview');
        await waitForCondition(() => getJob(appCtx.db, jobId)?.status === 'done');

        const noActivePlan = await appCtx.app.inject({
            method: 'GET',
            url: '/api/ai/organize/active',
            headers: authHeaders,
        });
        expect(noActivePlan.statusCode).toBe(200);
        expect(noActivePlan.json()).toEqual({ active: null });

        const pendingResponse = await appCtx.app.inject({
            method: 'GET',
            url: '/api/ai/organize/pending',
            headers: authHeaders,
        });
        expect(pendingResponse.statusCode).toBe(200);
        expect(pendingResponse.json().plans).toHaveLength(1);
        expect(pendingResponse.json().plans[0]).toMatchObject({
            id: planId,
            status: 'preview',
            needs_review_count: 1,
        });

        const detailResponse = await appCtx.app.inject({
            method: 'GET',
            url: `/api/ai/organize/${planId}`,
            headers: authHeaders,
        });
        expect(detailResponse.statusCode).toBe(200);
        expect(detailResponse.json()).toMatchObject({
            id: planId,
            status: 'preview',
            batches_done: 1,
            batches_total: 1,
            needs_review_count: 1,
            diff: {
                summary: {
                    move_count: 24,
                    empty_count: 0,
                    needs_review: 1,
                },
            },
        });

        const assignmentsResponse = await appCtx.app.inject({
            method: 'GET',
            url: `/api/ai/organize/${planId}/assignments?page=5&page_size=5`,
            headers: authHeaders,
        });
        expect(assignmentsResponse.statusCode).toBe(200);
        expect(assignmentsResponse.json()).toMatchObject({
            total: 25,
            page: 5,
            totalPages: 5,
            pageSize: 5,
        });
        expect(assignmentsResponse.json().assignments.at(-1)).toMatchObject({
            bookmark_id: bookmarkIds[24],
            status: 'needs_review',
            title: 'Bookmark 25',
            url: 'https://organize-25.example.test',
            current_category: null,
            can_apply: false,
            default_action: 'discard',
        });

        const plan = getPlan(appCtx.db, planId);
        const job = getJob(appCtx.db, jobId);
        expect(plan?.status).toBe('preview');
        expect(job).toMatchObject({
            status: 'done',
            total: 25,
            processed: 25,
            inserted: 24,
            skipped: 1,
        });
        expect(harness.calls).toHaveLength(1);
    });

    it('uses the latest live category list for repeated organize runs after discarding previous preview', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({
                assignments: [
                    { index: 1, category: '技术开发/前端' },
                    { index: 2, category: '学习资源/教程' },
                ],
            }),
            jsonCompletion({
                assignments: [
                    { index: 1, category: '技术开发/Web前端' },
                ],
            }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);

        const oldFrontend = getCategoryByPath(appCtx.db, '技术开发/前端');
        const oldDocs = getCategoryByPath(appCtx.db, '学习资源/文档');
        expect(oldFrontend).toBeTruthy();
        expect(oldDocs).toBeTruthy();

        const bookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'Legacy Frontend Bookmark', url: 'https://legacy-frontend.example.test', categoryId: oldFrontend!.id },
            { title: 'Legacy Docs Bookmark', url: 'https://legacy-docs.example.test', categoryId: oldDocs!.id },
        ]);

        renameCategory(appCtx.db, oldFrontend!.id, 'Web前端');
        renameCategory(appCtx.db, oldDocs!.id, '教程');
        const updatedTree = [
            { name: '技术开发', children: [{ name: 'Web前端' }, { name: '后端' }] },
            { name: '学习资源', children: [{ name: '教程' }] },
        ];

        const defaultResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: {
                scope: `ids:${bookmarkIds.join(',')}`,
                batch_size: 10,
            },
        });
        expect(defaultResponse.statusCode).toBe(200);
        await jobQueue.onIdle();

        const defaultPrompt = harness.calls[0].messages[0].content as string;
        expect(defaultPrompt).toContain('\n技术开发/Web前端\n');
        expect(defaultPrompt).toContain('\n学习资源/教程\n');
        expect(defaultPrompt.includes('\n技术开发/前端\n')).toBe(false);
        expect(defaultPrompt.includes('\n学习资源/文档\n')).toBe(false);

        const defaultPlan = getPlan(appCtx.db, (defaultResponse.json() as { planId: string }).planId);
        expect(defaultPlan).not.toBeNull();
        expect(defaultPlan?.target_tree ? JSON.parse(defaultPlan.target_tree) : null).toEqual(updatedTree);
        expect(defaultPlan?.assignments ? JSON.parse(defaultPlan.assignments) : null).toEqual([
            { bookmark_id: bookmarkIds[0], category_path: '技术开发/Web前端', status: 'assigned' },
            { bookmark_id: bookmarkIds[1], category_path: '学习资源/教程', status: 'assigned' },
        ]);

        const discardDefaultResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${defaultPlan!.id}/cancel`,
            headers: authHeaders,
        });
        expect(discardDefaultResponse.statusCode).toBe(200);
        expect(getPlan(appCtx.db, defaultPlan!.id)?.status).toBe('canceled');

        const ignoredOverrideResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: {
                scope: `ids:${bookmarkIds[0]}`,
                batch_size: 10,
            },
        });
        expect(ignoredOverrideResponse.statusCode).toBe(200);
        await jobQueue.onIdle();

        const prompt = harness.calls[1].messages[0].content as string;
        expect(prompt).toContain('\n技术开发/Web前端\n');
        expect(prompt).toContain('\n学习资源/教程\n');
        expect(prompt.includes('\n归档/稍后阅读\n')).toBe(false);

        const ignoredPlan = getPlan(appCtx.db, (ignoredOverrideResponse.json() as { planId: string }).planId);
        expect(ignoredPlan).not.toBeNull();
        expect(ignoredPlan?.target_tree ? JSON.parse(ignoredPlan.target_tree) : null).toEqual(updatedTree);
        expect(ignoredPlan?.assignments ? JSON.parse(ignoredPlan.assignments) : null).toEqual([
            { bookmark_id: bookmarkIds[0], category_path: '技术开发/Web前端', status: 'assigned' },
        ]);
    });

    it('adds decision guidance and bookmark context to improve organize assignment accuracy', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({
                assignments: [
                    { index: 1, category: '开发者/前端' },
                ],
            }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 10 });

        getOrCreateCategoryByPath(appCtx.db, '常用入口/快捷导航');
        const currentCategory = getCategoryByPath(appCtx.db, '常用入口/快捷导航');
        getOrCreateCategoryByPath(appCtx.db, '开发者/前端资源');
        getOrCreateCategoryByPath(appCtx.db, '开发者/官方文档');
        getOrCreateCategoryByPath(appCtx.db, 'NSFW/成人站点');

        const [bookmarkId] = seedBookmarks(appCtx.db, [
            {
                title: 'React useState API Reference',
                url: 'https://react.dev/reference/react/useState',
                categoryId: currentCategory!.id,
            },
        ]);
        appCtx.db.prepare('UPDATE bookmarks SET description = ? WHERE id = ?').run('React Hooks reference and frontend documentation.', bookmarkId);

        const response = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: {
                scope: `ids:${bookmarkId}`,
                batch_size: 10,
            },
        });

        expect(response.statusCode).toBe(200);
        await jobQueue.onIdle();

        const systemPrompt = harness.calls[0].messages[0].content as string;
        const userPrompt = harness.calls[0].messages[1].content as string;
        expect(systemPrompt).toContain('分类判定原则');
        expect(systemPrompt).toContain('优先联网访问目标网页');
        expect(systemPrompt).toContain('Web 搜索');
        expect(systemPrompt).toContain('常用入口');
        expect(systemPrompt).toContain('NSFW：');
        expect(systemPrompt).toContain('明确成人内容');
        expect(systemPrompt).toContain('\n开发者/前端资源\n');
        expect(userPrompt).toContain('优先联网访问 URL');
        expect(userPrompt).toContain('Web 搜索');
        expect(userPrompt).toContain('当前分类: 常用入口/快捷导航');
        expect(userPrompt).toContain('域名: react.dev');
        expect(userPrompt).toContain('路径关键词: reference react useState');
        expect(userPrompt).toContain('描述: React Hooks reference and frontend documentation.');

        const plan = getPlan(appCtx.db, (response.json() as { planId: string }).planId);
        expect(plan?.assignments ? JSON.parse(plan.assignments) : null).toEqual([
            { bookmark_id: bookmarkId, category_path: '开发者/官方文档', status: 'assigned' },
        ]);
    });

    it('covers live category apply, confirm-empty, and rollback restoration', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const targetCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        const occupiedCategory = getCategoryByPath(ctx.db, '技术开发/后端');

        expect(sourceCategory).toBeTruthy();
        expect(targetCategory).toBeTruthy();
        expect(occupiedCategory).toBeTruthy();

        const [movingBookmarkId, stableBookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Docs Bookmark', url: 'https://docs.example.test', categoryId: sourceCategory!.id },
            { title: 'Backend Bookmark', url: 'https://backend.example.test', categoryId: occupiedCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: movingBookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
        });

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: true,
            applied_count: 0,
            empty_categories: [{ id: sourceCategory!.id, name: getCategoryFullPath(ctx.db, sourceCategory!.id) ?? '' }],
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('preview');
        expect(getBookmarkCategoryId(ctx, movingBookmarkId)).toBe(sourceCategory!.id);

        const confirmResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply/confirm-empty`,
            headers: authHeaders,
            payload: { decisions: [{ id: sourceCategory!.id, action: 'delete' }] },
        });

        expect(confirmResponse.statusCode).toBe(200);
        expect(confirmResponse.json()).toEqual({ success: true, deleted: 1, kept: 0 });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('applied');
        expect(getCategoryByPath(ctx.db, '学习资源/文档')).toBeNull();

        const rollbackResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/rollback`,
            headers: authHeaders,
        });

        expect(rollbackResponse.statusCode).toBe(200);
        expect(rollbackResponse.json()).toEqual({
            success: true,
            restored_categories: 5,
            restored_bookmarks: 2,
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('rolled_back');
        expect(getCategoryByPath(ctx.db, '学习资源/文档')).toBeTruthy();
        expect(getBookmarkCategoryId(ctx, movingBookmarkId)).toBe(sourceCategory!.id);
        expect(getBookmarkCategoryId(ctx, stableBookmarkId)).toBe(occupiedCategory!.id);
    });

    it('does not keep partial bookmark moves when a needs-confirm plan is discarded', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const targetCategory = getCategoryByPath(ctx.db, '技术开发/前端');

        expect(sourceCategory).toBeTruthy();
        expect(targetCategory).toBeTruthy();

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Discard After Confirm Needed', url: 'https://discard-after-confirm-needed.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: bookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
        });

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: true,
            applied_count: 0,
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('preview');
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(sourceCategory!.id);

        const cancelResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/cancel`,
            headers: authHeaders,
        });

        expect(cancelResponse.statusCode).toBe(200);
        expect(getPlan(ctx.db, plan.id)?.status).toBe('canceled');
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(sourceCategory!.id);
        expect(getCategoryByPath(ctx.db, '学习资源/文档')).toBeTruthy();
    });

    it('applies only selected bookmark suggestions and leaves unmatched suggestions discarded by default', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const targetCategory = getCategoryByPath(ctx.db, '技术开发/前端');

        expect(sourceCategory).toBeTruthy();
        expect(targetCategory).toBeTruthy();

        const [selectedBookmarkId, discardedBookmarkId, unmatchedBookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Selected Bookmark', url: 'https://selected.example.test', categoryId: sourceCategory!.id },
            { title: 'Discarded Bookmark', url: 'https://discarded.example.test', categoryId: sourceCategory!.id },
            { title: 'Unmatched Bookmark', url: 'https://unmatched.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: selectedBookmarkId, category_path: '技术开发/前端', status: 'assigned' },
                { bookmark_id: discardedBookmarkId, category_path: '技术开发/前端', status: 'assigned' },
                { bookmark_id: unmatchedBookmarkId, category_path: '', status: 'needs_review' },
            ],
        });

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
            payload: {
                decisions: [
                    { bookmark_id: discardedBookmarkId, action: 'discard' },
                ],
            },
        });

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toEqual({
            success: true,
            needs_confirm: false,
            conflicts: [],
            empty_categories: [],
            applied_count: 1,
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('applied');
        expect(getBookmarkCategoryId(ctx, selectedBookmarkId)).toBe(targetCategory!.id);
        expect(getBookmarkCategoryId(ctx, discardedBookmarkId)).toBe(sourceCategory!.id);
        expect(getBookmarkCategoryId(ctx, unmatchedBookmarkId)).toBe(sourceCategory!.id);
    });

    it('covers apply conflict detection and resolve override flow', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const targetCategory = getCategoryByPath(ctx.db, '技术开发/后端');

        expect(sourceCategory).toBeTruthy();
        expect(targetCategory).toBeTruthy();

        const [conflictedBookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Conflicted Bookmark', url: 'https://conflict.example.test', categoryId: sourceCategory!.id },
            { title: 'Source Keeper', url: 'https://keep.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: conflictedBookmarkId, category_path: '技术开发/后端', status: 'assigned' },
            ],
        });

        ctx.db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), conflictedBookmarkId);

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: true,
            applied_count: 0,
            empty_categories: [],
        });
        expect(applyResponse.json().conflicts).toHaveLength(1);
        expect(applyResponse.json().conflicts[0]).toMatchObject({
            bookmark_id: conflictedBookmarkId,
            title: 'Conflicted Bookmark',
        });
        expect(getBookmarkCategoryId(ctx, conflictedBookmarkId)).toBe(sourceCategory!.id);

        const resolveResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply/resolve`,
            headers: authHeaders,
            payload: {
                conflicts: [{ bookmark_id: conflictedBookmarkId, action: 'override' }],
                empty_categories: [],
            },
        });

        expect(resolveResponse.statusCode).toBe(200);
        expect(resolveResponse.json()).toEqual({
            success: true,
            conflicts: [],
            empty_categories: [],
            applied_count: 1,
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('applied');
        expect(getBookmarkCategoryId(ctx, conflictedBookmarkId)).toBe(targetCategory!.id);
    });

    it('rejects stale apply when a preview bookmark was deleted before apply', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');

        expect(sourceCategory).toBeTruthy();

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Deleted Later', url: 'https://deleted-after-preview.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: bookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
        });

        ctx.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        expect(applyResponse.statusCode).toBe(409);
        expect(applyResponse.json()).toMatchObject({ error: 'plan is stale: bookmarks changed', discard_recommended: true, recommended_action: 'discard' });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('preview');
    });

    it('surfaces a conflict when bookmark category drifted without changing updated_at', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        const driftedCategory = getCategoryByPath(ctx.db, '技术开发/后端');
        const targetCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const stableUpdatedAt = '2026-03-29T09:00:00.000Z';

        expect(sourceCategory).toBeTruthy();
        expect(driftedCategory).toBeTruthy();
        expect(targetCategory).toBeTruthy();

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'State Drift Bookmark', url: 'https://state-drift.example.test', categoryId: sourceCategory!.id },
        ]);
        ctx.db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').run(stableUpdatedAt, bookmarkId);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: bookmarkId, category_path: '学习资源/文档', status: 'assigned' },
            ],
        });

        ctx.db.prepare('UPDATE bookmarks SET category_id = ?, updated_at = ? WHERE id = ?').run(
            driftedCategory!.id,
            stableUpdatedAt,
            bookmarkId,
        );

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: true,
            applied_count: 0,
            empty_categories: [],
        });
        expect(applyResponse.json().conflicts).toHaveLength(1);
        expect(applyResponse.json().conflicts[0]).toMatchObject({
            bookmark_id: bookmarkId,
            reason: 'bookmark_changed',
        });
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(driftedCategory!.id);
    });

    it('marks stale target suggestions invalid and still applies other selected suggestions', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const staleTargetCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        const validTargetCategory = getCategoryByPath(ctx.db, '技术开发/后端');

        expect(sourceCategory).toBeTruthy();
        expect(staleTargetCategory).toBeTruthy();
        expect(validTargetCategory).toBeTruthy();

        const [staleBookmarkId, validBookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Target Drift Bookmark', url: 'https://target-drift.example.test', categoryId: sourceCategory!.id },
            { title: 'Still Valid Bookmark', url: 'https://still-valid.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: staleBookmarkId, category_path: '技术开发/前端', status: 'assigned' },
                { bookmark_id: validBookmarkId, category_path: '技术开发/后端', status: 'assigned' },
            ],
        });

        ctx.db.prepare('UPDATE categories SET name = ? WHERE id = ?').run('Web前端', staleTargetCategory!.id);

        const assignmentsResponse = await ctx.app.inject({
            method: 'GET',
            url: `/api/ai/organize/${plan.id}/assignments?page=1&page_size=20`,
            headers: authHeaders,
        });
        expect(assignmentsResponse.statusCode).toBe(200);
        expect(assignmentsResponse.json().assignments).toEqual(expect.arrayContaining([
            expect.objectContaining({
                bookmark_id: staleBookmarkId,
                can_apply: false,
                default_action: 'discard',
                invalid_reason: 'target_category_missing',
                invalid_message: '分类已失效，无法应用',
            }),
            expect.objectContaining({
                bookmark_id: validBookmarkId,
                can_apply: true,
                default_action: 'apply',
                invalid_reason: null,
            }),
        ]));

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        const recreatedCount = ctx.db.prepare(
            `SELECT COUNT(*) AS count FROM categories WHERE parent_id = ? AND (name = ? OR name = ?)`
        ).get(staleTargetCategory!.parent_id, '技术开发/前端', '前端') as { count: number };

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: false,
            conflicts: [],
            empty_categories: [],
            applied_count: 1,
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('applied');
        expect(recreatedCount.count).toBe(0);
        expect(getBookmarkCategoryId(ctx, staleBookmarkId)).toBe(sourceCategory!.id);
        expect(getBookmarkCategoryId(ctx, validBookmarkId)).toBe(validTargetCategory!.id);
    });

    it('allows overlapping preview plans to apply through explicit conflict resolution', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const targetCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        const newerTargetCategory = getCategoryByPath(ctx.db, '技术开发/后端');

        expect(sourceCategory).toBeTruthy();
        expect(targetCategory).toBeTruthy();
        expect(newerTargetCategory).toBeTruthy();

        const [bookmarkId, keeperBookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Overlapping Bookmark', url: 'https://overlap.example.test', categoryId: sourceCategory!.id },
            { title: 'Source Keeper', url: 'https://overlap-keeper.example.test', categoryId: sourceCategory!.id },
        ]);

        const olderPlan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: '2026-03-29T08:00:00.000Z',
            assignments: [
                { bookmark_id: bookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
        });

        const newerPlan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: '2026-03-29T08:05:00.000Z',
            assignments: [
                { bookmark_id: bookmarkId, category_path: '技术开发/后端', status: 'assigned' },
            ],
        });

        const olderApplyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${olderPlan.id}/apply`,
            headers: authHeaders,
        });

        expect(olderApplyResponse.statusCode).toBe(200);
        expect(olderApplyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: true,
            applied_count: 0,
            empty_categories: [],
        });
        expect(olderApplyResponse.json().conflicts).toHaveLength(1);
        expect(olderApplyResponse.json().conflicts[0]).toMatchObject({
            bookmark_id: bookmarkId,
            reason: 'overlapping_plan',
            newer_plan_id: newerPlan.id,
            newer_plan_status: 'preview',
        });
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(sourceCategory!.id);
        expect(getBookmarkCategoryId(ctx, keeperBookmarkId)).toBe(sourceCategory!.id);

        const olderResolveResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${olderPlan.id}/apply/resolve`,
            headers: authHeaders,
            payload: {
                conflicts: [{ bookmark_id: bookmarkId, action: 'override' }],
                empty_categories: [],
            },
        });

        expect(olderResolveResponse.statusCode).toBe(200);
        expect(olderResolveResponse.json()).toEqual({
            success: true,
            conflicts: [],
            empty_categories: [],
            applied_count: 1,
        });
        expect(getPlan(ctx.db, olderPlan.id)?.status).toBe('applied');
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(targetCategory!.id);

        const newerApplyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${newerPlan.id}/apply`,
            headers: authHeaders,
        });

        expect(newerApplyResponse.statusCode).toBe(200);
        expect(newerApplyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: true,
            applied_count: 0,
            empty_categories: [],
        });
        expect(newerApplyResponse.json().conflicts).toHaveLength(1);
        expect(newerApplyResponse.json().conflicts[0]).toMatchObject({
            bookmark_id: bookmarkId,
            reason: 'bookmark_changed',
            current_category: '技术开发/前端',
        });

        const newerResolveResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${newerPlan.id}/apply/resolve`,
            headers: authHeaders,
            payload: {
                conflicts: [{ bookmark_id: bookmarkId, action: 'override' }],
                empty_categories: [],
            },
        });

        expect(newerResolveResponse.statusCode).toBe(200);
        expect(newerResolveResponse.json()).toMatchObject({
            success: true,
            conflicts: [],
            applied_count: 1,
        });
        expect(newerResolveResponse.json().empty_categories).toEqual([
            { id: targetCategory!.id, name: getCategoryFullPath(ctx.db, targetCategory!.id) ?? '' },
        ]);
        expect(getPlan(ctx.db, newerPlan.id)?.status).toBe('applied');
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(newerTargetCategory!.id);
        expect(getBookmarkCategoryId(ctx, keeperBookmarkId)).toBe(sourceCategory!.id);
    });

    it('allows a live-category preview plan to apply directly when newer plans do not overlap', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const firstTarget = getCategoryByPath(ctx.db, '技术开发/前端');
        const secondTarget = getCategoryByPath(ctx.db, '技术开发/后端');

        expect(sourceCategory).toBeTruthy();
        expect(firstTarget).toBeTruthy();
        expect(secondTarget).toBeTruthy();

        const [olderBookmarkId, newerBookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Older Non-overlap Bookmark', url: 'https://non-overlap-older.example.test', categoryId: sourceCategory!.id },
            { title: 'Newer Non-overlap Bookmark', url: 'https://non-overlap-newer.example.test', categoryId: sourceCategory!.id },
        ]);

        const olderPlan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: '2026-03-29T09:00:00.000Z',
            assignments: [
                { bookmark_id: olderBookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
        });

        seedPlan(ctx.db, {
            status: 'preview',
            created_at: '2026-03-29T09:05:00.000Z',
            assignments: [
                { bookmark_id: newerBookmarkId, category_path: '技术开发/后端', status: 'assigned' },
            ],
        });

        const olderApplyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${olderPlan.id}/apply`,
            headers: authHeaders,
        });

        expect(olderApplyResponse.statusCode).toBe(200);
        expect(olderApplyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: false,
            applied_count: 1,
            conflicts: [],
            empty_categories: [],
        });
        expect(getPlan(ctx.db, olderPlan.id)?.status).toBe('applied');
        expect(getBookmarkCategoryId(ctx, olderBookmarkId)).toBe(firstTarget!.id);
        expect(getBookmarkCategoryId(ctx, newerBookmarkId)).toBe(sourceCategory!.id);
    });

    it('rejects resolve when a conflicted bookmark was deleted after the first apply attempt', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');

        expect(sourceCategory).toBeTruthy();

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Deleted During Resolve', url: 'https://resolve-delete.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: bookmarkId, category_path: '技术开发/后端', status: 'assigned' },
            ],
        });

        ctx.db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), bookmarkId);

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toMatchObject({
            success: true,
            needs_confirm: true,
            applied_count: 0,
        });
        expect(applyResponse.json().conflicts).toHaveLength(1);

        ctx.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);

        const resolveResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply/resolve`,
            headers: authHeaders,
            payload: {
                conflicts: [{ bookmark_id: bookmarkId, action: 'override' }],
                empty_categories: [],
            },
        });

        expect(resolveResponse.statusCode).toBe(409);
        expect(resolveResponse.json()).toMatchObject({ error: 'plan is stale: bookmarks changed', discard_recommended: true, recommended_action: 'discard' });
    });

    it('covers retry with the configured batch size default', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({ assignments: buildAssignments(25, '技术开发/前端') }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 30 });
        seedAiTestCategories(appCtx.db);

        seedBookmarks(appCtx.db, Array.from({ length: 25 }, (_, index) => ({
            title: `Retry Bookmark ${index + 1}`,
            url: `https://retry-${index + 1}.example.test`,
        })));

        const failedPlan = seedPlan(appCtx.db, {
            status: 'failed',
            scope: 'all',
        });

        const retryResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${failedPlan.id}/retry`,
            headers: authHeaders,
        });

        expect(retryResponse.statusCode).toBe(200);
        expect(retryResponse.json()).toEqual({ success: true, status: 'assigning' });

        await jobQueue.onIdle();

        const retriedPlan = getPlan(appCtx.db, failedPlan.id);
        expect(retriedPlan).toMatchObject({
            status: 'preview',
            batches_done: 1,
            batches_total: 1,
            needs_review_count: 0,
        });
        expect(retriedPlan?.job_id).toBeTruthy();
        expect(getJob(appCtx.db, retriedPlan!.job_id!)).toMatchObject({
            status: 'done',
            total: 25,
            processed: 25,
            inserted: 25,
            skipped: 0,
        });
        expect(harness.calls).toHaveLength(1);
    });

    it('requires AI config before moving a failed plan back into assigning on retry', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        seedAiTestCategories(ctx.db);
        const failedPlan = seedPlan(ctx.db, {
            status: 'failed',
            scope: 'all',
        });

        const retryResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${failedPlan.id}/retry`,
            headers: authHeaders,
        });

        expect(retryResponse.statusCode).toBe(400);
        expect(retryResponse.json()).toEqual({ error: '请先在设置页配置 AI' });
        expect(getPlan(ctx.db, failedPlan.id)?.status).toBe('failed');
        expect(getPlan(ctx.db, failedPlan.id)?.job_id).toBeNull();
    });

    it('returns 404 for retrying a missing plan before checking AI config', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();

        const retryResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/organize/missing-plan/retry',
            headers: session.headers,
        });

        expect(retryResponse.statusCode).toBe(404);
        expect(retryResponse.json()).toEqual({ error: 'plan not found' });
    });

    it('retries error plans once the worker issue is cleared', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({ assignments: buildAssignments(2, '技术开发/前端') }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);
        seedBookmarks(appCtx.db, [
            { title: 'Retry Error 1', url: 'https://retry-error-1.example.test' },
            { title: 'Retry Error 2', url: 'https://retry-error-2.example.test' },
        ]);

        const errorPlan = createPlan(appCtx.db, 'all');
        transitionStatus(appCtx.db, errorPlan.id, 'canceled');
        updatePlan(appCtx.db, errorPlan.id, { status: 'error', phase: null });

        const retryResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${errorPlan.id}/retry`,
            headers: authHeaders,
        });

        expect(retryResponse.statusCode).toBe(200);
        expect(retryResponse.json()).toEqual({ success: true, status: 'assigning' });
        await waitForCondition(() => getPlan(appCtx.db, errorPlan.id)?.status === 'preview');

        const retriedPlan = getPlan(appCtx.db, errorPlan.id);
        expect(retriedPlan).toMatchObject({
            status: 'preview',
            batches_done: 1,
            batches_total: 1,
            needs_review_count: 0,
        });
        expect(retriedPlan?.job_id).toBeTruthy();
        expect(getJob(appCtx.db, retriedPlan!.job_id!)).toMatchObject({
            status: 'done',
            total: 2,
            processed: 2,
            inserted: 2,
            skipped: 0,
        });
        expect(harness.calls).toHaveLength(1);
    });

    it('marks assigning plans as stale when ids scope contains bookmarks that no longer exist', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp();
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);
        const [bookmarkId] = seedBookmarks(appCtx.db, [
            { title: 'Live Scope Bookmark', url: 'https://live-scope.example.test' },
        ]);

        const startResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: { scope: `ids:${bookmarkId},999999`, batch_size: 10 },
        });

        expect(startResponse.statusCode).toBe(200);

        const { planId, jobId } = startResponse.json() as { planId: string; jobId: string };
        await waitForCondition(() => getPlan(appCtx.db, planId)?.status === 'error');
        await waitForCondition(() => getJob(appCtx.db, jobId)?.status === 'failed');

        expect(getPlan(appCtx.db, planId)).toMatchObject({
            status: 'error',
            phase: null,
        });
        expect(getJob(appCtx.db, jobId)).toMatchObject({
            status: 'failed',
            message: 'plan is stale: scope bookmarks changed',
        });
        expect(harness.calls).toHaveLength(0);

        const detailResponse = await appCtx.app.inject({
            method: 'GET',
            url: `/api/ai/organize/${planId}`,
            headers: authHeaders,
        });

        expect(detailResponse.statusCode).toBe(200);
        expect(detailResponse.json()).toMatchObject({
            id: planId,
            status: 'error',
            message: 'plan is stale: scope bookmarks changed',
        });
    });

    it('retries against the frozen original bookmark scope instead of refreshed live all scope', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({ assignments: buildAssignments(2, '技术开发/前端') }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);

        const originalBookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'Frozen Scope Retry 1', url: 'https://frozen-retry-1.example.test' },
            { title: 'Frozen Scope Retry 2', url: 'https://frozen-retry-2.example.test' },
        ]);

        const failedPlan = createPlan(appCtx.db, 'all');
        transitionStatus(appCtx.db, failedPlan.id, 'canceled');
        updatePlan(appCtx.db, failedPlan.id, { status: 'failed', phase: null });

        const [newBookmarkId] = seedBookmarks(appCtx.db, [
            { title: 'Late Added Bookmark', url: 'https://late-added.example.test' },
        ]);

        const retryResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${failedPlan.id}/retry`,
            headers: authHeaders,
        });

        expect(retryResponse.statusCode).toBe(200);
        expect(retryResponse.json()).toEqual({ success: true, status: 'assigning' });
        await waitForCondition(() => getPlan(appCtx.db, failedPlan.id)?.status === 'preview');

        const retriedPlan = getPlan(appCtx.db, failedPlan.id);
        const assignments = retriedPlan?.assignments ? JSON.parse(retriedPlan.assignments) as Array<{ bookmark_id: number }> : [];
        const sourceSnapshot = retriedPlan?.source_snapshot ? JSON.parse(retriedPlan.source_snapshot) as {
            scope_bookmark_ids: number[];
            scope_frozen: boolean;
        } : null;

        expect(assignments.map((item) => item.bookmark_id)).toEqual(originalBookmarkIds);
        expect(assignments.some((item) => item.bookmark_id === newBookmarkId)).toBe(false);
        expect(sourceSnapshot).toMatchObject({
            scope_bookmark_ids: originalBookmarkIds,
            scope_frozen: true,
        });
        expect(getJob(appCtx.db, retriedPlan!.job_id!)).toMatchObject({
            total: 2,
            processed: 2,
            inserted: 2,
            skipped: 0,
            status: 'done',
        });

        const prompt = harness.calls[0].messages[1].content as string;
        expect(prompt).toContain('https://frozen-retry-1.example.test');
        expect(prompt).toContain('https://frozen-retry-2.example.test');
        expect(prompt.includes('https://late-added.example.test')).toBe(false);
    });

    it('clears stale failed assignments before retrying so assigning plans do not expose old preview data', async () => {
        const deferred = createDeferred<ReturnType<typeof jsonCompletion>>();
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([() => deferred.promise]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);
        const bookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'Retry Clear 1', url: 'https://retry-clear-1.example.test' },
            { title: 'Retry Clear 2', url: 'https://retry-clear-2.example.test' },
        ]);

        const failedPlan = createPlan(appCtx.db, 'all');
        transitionStatus(appCtx.db, failedPlan.id, 'canceled');
        updatePlan(appCtx.db, failedPlan.id, {
            status: 'failed',
            phase: null,
            assignments: [
                { bookmark_id: bookmarkIds[0], category_path: '技术开发/前端', status: 'assigned' },
            ],
            failed_batch_ids: [0],
            needs_review_count: 1,
            batches_done: 1,
            batches_total: 1,
        });

        const retryResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${failedPlan.id}/retry`,
            headers: authHeaders,
        });

        expect(retryResponse.statusCode).toBe(200);
        expect(retryResponse.json()).toEqual({ success: true, status: 'assigning' });
        await waitForCondition(() => harness.calls.length === 1);
        try {
            const assigningPlan = getPlan(appCtx.db, failedPlan.id);
            expect(assigningPlan).toMatchObject({
                status: 'assigning',
                assignments: null,
                failed_batch_ids: null,
                needs_review_count: 0,
            });

            const detailResponse = await appCtx.app.inject({
                method: 'GET',
                url: `/api/ai/organize/${failedPlan.id}`,
                headers: authHeaders,
            });

            expect(detailResponse.statusCode).toBe(200);
            expect(detailResponse.json()).toMatchObject({
                id: failedPlan.id,
                status: 'assigning',
                assignments: null,
            });
            expect('diff' in detailResponse.json()).toBe(false);
        } finally {
            deferred.resolve(jsonCompletion({ assignments: buildAssignments(2, '技术开发/前端') }));
            await waitForCondition(() => getPlan(appCtx.db, failedPlan.id)?.status === 'preview');
        }
    });

    it('marks retrying plans as stale when frozen scope bookmarks were deleted before reassignment', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp();
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);
        const bookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'Retry Missing 1', url: 'https://retry-missing-1.example.test' },
            { title: 'Retry Missing 2', url: 'https://retry-missing-2.example.test' },
        ]);

        const failedPlan = createPlan(appCtx.db, `ids:${bookmarkIds.join(',')}`);
        transitionStatus(appCtx.db, failedPlan.id, 'canceled');
        updatePlan(appCtx.db, failedPlan.id, {
            status: 'failed',
            phase: null,
        });
        appCtx.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkIds[1]);

        const retryResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${failedPlan.id}/retry`,
            headers: authHeaders,
        });

        expect(retryResponse.statusCode).toBe(200);
        expect(retryResponse.json()).toEqual({ success: true, status: 'assigning' });
        await waitForCondition(() => getPlan(appCtx.db, failedPlan.id)?.status === 'error');

        const retriedPlan = getPlan(appCtx.db, failedPlan.id);
        expect(retriedPlan).toMatchObject({
            status: 'error',
            phase: null,
        });
        expect(retriedPlan?.job_id).toBeTruthy();
        await waitForCondition(() => getJob(appCtx.db, retriedPlan!.job_id!)?.status === 'failed');
        expect(getJob(appCtx.db, retriedPlan!.job_id!)).toMatchObject({
            status: 'failed',
            message: 'plan is stale: scope bookmarks changed',
        });
        expect(harness.calls).toHaveLength(0);
    });

    it('requires a current category list before starting organize', async () => {
        const { ctx: appCtx, authHeaders } = await createHarnessApp();
        seedAISettings(appCtx.db, { batchSize: 10 });

        const response = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: { scope: 'all', batch_size: 10 },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: '请先创建分类' });
    });

    it('rejects starting a second organize plan while another plan is assigning and returns activePlanId', async () => {
        const deferred = createDeferred<ReturnType<typeof jsonCompletion>>();
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([() => deferred.promise]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);
        seedBookmarks(appCtx.db, [
            { title: 'Assigning Lock Bookmark', url: 'https://assigning-lock.example.test' },
        ]);

        const firstResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: { scope: 'all', batch_size: 10 },
        });

        expect(firstResponse.statusCode).toBe(200);
        const { planId, jobId } = firstResponse.json() as { planId: string; jobId: string };
        await waitForCondition(() => harness.calls.length === 1);

        const secondResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: { scope: 'all', batch_size: 10 },
        });

        expect(secondResponse.statusCode).toBe(409);
        expect(secondResponse.json()).toMatchObject({
            error: 'active plan already exists',
            activePlanId: planId,
            blockingPlanId: planId,
            blockingStatus: 'assigning',
            requiredAction: 'wait_or_cancel',
        });

        deferred.resolve(jsonCompletion({ assignments: buildAssignments(1, '技术开发/前端') }));
        await waitForCondition(() => getPlan(appCtx.db, planId)?.status === 'preview');
        await waitForCondition(() => getJob(appCtx.db, jobId)?.status === 'done');
    });

    it('rejects starting a new organize plan while preview suggestions are still pending and returns pendingPlanId before config checks', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();

        const previewJob = seedJob(ctx.db, {
            type: 'ai_organize',
            status: 'done',
            message: 'preview ready',
        });
        const previewPlan = seedPlan(ctx.db, {
            status: 'preview',
            job_id: previewJob.id,
            scope: 'all',
        });

        const response = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: session.headers,
            payload: { scope: 'all', batch_size: 10 },
        });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
            error: 'pending plan already exists',
            pendingPlanId: previewPlan.id,
            pendingJobId: previewJob.id,
            blockingPlanId: previewPlan.id,
            blockingStatus: 'preview',
            requiredAction: 'apply_or_discard',
        });
    });

    it('rejects starting a new organize plan while a failed plan has not been discarded', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();

        const failedJob = seedJob(ctx.db, {
            type: 'ai_organize',
            status: 'failed',
            message: 'provider timeout',
        });
        const failedPlan = seedPlan(ctx.db, {
            status: 'failed',
            job_id: failedJob.id,
            scope: 'all',
        });

        const response = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: session.headers,
            payload: { scope: 'all', batch_size: 10 },
        });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
            error: 'unresolved plan already exists',
            unresolvedPlanId: failedPlan.id,
            unresolvedJobId: failedJob.id,
            blockingPlanId: failedPlan.id,
            blockingStatus: 'failed',
            requiredAction: 'retry_or_discard',
        });

        const blockingResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/ai/organize/blocking',
            headers: session.headers,
        });
        expect(blockingResponse.statusCode).toBe(200);
        expect(blockingResponse.json()).toMatchObject({
            blockingPlanId: failedPlan.id,
            blockingStatus: 'failed',
            blocking: {
                id: failedPlan.id,
                status: 'failed',
                message: 'provider timeout',
            },
        });
    });

    it('rejects retry when another organize plan is already assigning and returns activePlanId', async () => {
        const deferred = createDeferred<ReturnType<typeof jsonCompletion>>();
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([() => deferred.promise]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);
        seedBookmarks(appCtx.db, [
            { title: 'Retry Lock Bookmark', url: 'https://retry-lock.example.test' },
        ]);

        const activeResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: { scope: 'all', batch_size: 10 },
        });

        expect(activeResponse.statusCode).toBe(200);
        const { planId: activePlanId, jobId: activeJobId } = activeResponse.json() as { planId: string; jobId: string };
        await waitForCondition(() => harness.calls.length === 1);

        const failedPlan = seedPlan(appCtx.db, {
            status: 'failed',
            scope: 'all',
        });

        const retryResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${failedPlan.id}/retry`,
            headers: authHeaders,
        });

        expect(retryResponse.statusCode).toBe(409);
        expect(retryResponse.json()).toMatchObject({
            error: 'active plan already exists',
            activePlanId,
            blockingPlanId: activePlanId,
            blockingStatus: 'assigning',
            requiredAction: 'wait_or_cancel',
        });
        expect(getPlan(appCtx.db, failedPlan.id)?.status).toBe('failed');

        deferred.resolve(jsonCompletion({ assignments: buildAssignments(1, '技术开发/前端') }));
        await waitForCondition(() => getPlan(appCtx.db, activePlanId)?.status === 'preview');
        await waitForCondition(() => getJob(appCtx.db, activeJobId)?.status === 'done');
    });

    it('rejects retry when another preview organize plan is still pending and returns pendingPlanId before config checks', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();

        const previewJob = seedJob(ctx.db, {
            type: 'ai_organize',
            status: 'done',
            message: 'preview ready',
        });
        const previewPlan = seedPlan(ctx.db, {
            status: 'preview',
            job_id: previewJob.id,
            scope: 'all',
        });
        const failedPlan = seedPlan(ctx.db, {
            status: 'failed',
            scope: 'all',
        });

        const response = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${failedPlan.id}/retry`,
            headers: session.headers,
        });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
            error: 'pending plan already exists',
            pendingPlanId: previewPlan.id,
            pendingJobId: previewJob.id,
            blockingPlanId: previewPlan.id,
            blockingStatus: 'preview',
            requiredAction: 'apply_or_discard',
        });
        expect(getPlan(ctx.db, failedPlan.id)?.status).toBe('failed');
    });

    it('covers cancel transitions for assigning plans', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const job = seedJob(ctx.db, {
            id: 'organize-cancel-job',
            type: 'ai_organize',
            status: 'queued',
            message: 'waiting',
        });
        const plan = seedPlan(ctx.db, {
            id: 'organize-cancel-plan',
            job_id: job.id,
            status: 'assigning',
        });

        const cancelResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/cancel`,
            headers: authHeaders,
        });

        expect(cancelResponse.statusCode).toBe(200);
        expect(cancelResponse.json()).toEqual({ success: true, status: 'canceled' });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('canceled');
        expect(getJob(ctx.db, job.id)).toMatchObject({
            status: 'canceled',
            message: 'plan canceled',
        });
    });

    it('allows canceling error plans so users can discard interrupted organize runs', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const job = seedJob(ctx.db, {
            id: 'organize-error-job',
            type: 'ai_organize',
            status: 'failed',
            message: 'plan is stale: scope bookmarks changed',
        });
        const plan = seedPlan(ctx.db, {
            id: 'organize-error-plan',
            job_id: job.id,
            status: 'error',
            phase: null,
        });

        const cancelResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/cancel`,
            headers: authHeaders,
        });

        expect(cancelResponse.statusCode).toBe(200);
        expect(cancelResponse.json()).toEqual({ success: true, status: 'canceled' });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('canceled');
        expect(getPlan(ctx.db, plan.id)?.phase).toBeNull();
        expect(getJob(ctx.db, job.id)).toMatchObject({
            status: 'failed',
            message: 'plan is stale: scope bookmarks changed',
        });
    });

    it('keeps a canceled in-flight plan from writing stale preview data and allows the next plan to proceed', async () => {
        const deferred = createDeferred<ReturnType<typeof jsonCompletion>>();
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            () => deferred.promise,
            jsonCompletion({ assignments: [{ index: 1, category: '技术开发/后端' }] }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        seedAiTestCategories(appCtx.db);
        const [firstBookmarkId, secondBookmarkId] = seedBookmarks(appCtx.db, [
            { title: 'Canceled Bookmark', url: 'https://canceled.example.test' },
            { title: 'Queued Next Bookmark', url: 'https://queued-next.example.test' },
        ]);

        const firstResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: { scope: `ids:${firstBookmarkId}`, batch_size: 10 },
        });

        expect(firstResponse.statusCode).toBe(200);
        const { planId: firstPlanId, jobId: firstJobId } = firstResponse.json() as { planId: string; jobId: string };
        await waitForCondition(() => harness.calls.length === 1);

        const cancelResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${firstPlanId}/cancel`,
            headers: authHeaders,
        });

        expect(cancelResponse.statusCode).toBe(200);
        expect(cancelResponse.json()).toEqual({ success: true, status: 'canceled' });

        const secondResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: { scope: `ids:${secondBookmarkId}`, batch_size: 10 },
        });

        expect(secondResponse.statusCode).toBe(200);
        const { planId: secondPlanId, jobId: secondJobId } = secondResponse.json() as { planId: string; jobId: string };
        expect(harness.calls).toHaveLength(1);

        deferred.resolve(jsonCompletion({ assignments: [{ index: 1, category: '技术开发/前端' }] }));
        await waitForCondition(() => harness.calls.length === 2);
        await waitForCondition(() => getPlan(appCtx.db, secondPlanId)?.status === 'preview');
        await waitForCondition(() => getJob(appCtx.db, secondJobId)?.status === 'done');

        expect(getPlan(appCtx.db, firstPlanId)).toMatchObject({
            status: 'canceled',
            assignments: null,
            batches_done: 0,
            needs_review_count: 0,
        });
        expect(getJob(appCtx.db, firstJobId)).toMatchObject({
            status: 'canceled',
            message: 'plan canceled',
        });

        expect(getPlan(appCtx.db, secondPlanId)).toMatchObject({
            status: 'preview',
            assignments: JSON.stringify([
                { bookmark_id: secondBookmarkId, category_path: '技术开发/后端', status: 'assigned' },
            ]),
            batches_done: 1,
            batches_total: 1,
            needs_review_count: 0,
        });
        expect(getJob(appCtx.db, secondJobId)).toMatchObject({
            status: 'done',
            processed: 1,
            inserted: 1,
            skipped: 0,
        });
    });

    it('returns 404 when canceling a missing plan instead of collapsing into 500', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;

        const cancelResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/organize/missing-plan/cancel',
            headers: authHeaders,
        });

        expect(cancelResponse.statusCode).toBe(404);
        expect(cancelResponse.json()).toEqual({ error: 'plan not found' });
    });

    it('covers rollback guard rails for expired and corrupted snapshots', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const validSnapshot = {
            categories: [],
            bookmark_categories: [],
        };

        const expiredPlan = seedPlan(ctx.db, {
            status: 'applied',
            applied_at: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1_000).toISOString(),
            backup_snapshot: validSnapshot,
        });

        const expiredResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${expiredPlan.id}/rollback`,
            headers: authHeaders,
        });

        expect(expiredResponse.statusCode).toBe(403);
        expect(expiredResponse.json()).toEqual({ error: 'rollback window expired' });

        const corruptedPlan = seedPlan(ctx.db, {
            status: 'applied',
            applied_at: new Date().toISOString(),
            backup_snapshot: {
                categories: 'bad-data',
                bookmark_categories: [],
            },
        });

        const corruptedResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${corruptedPlan.id}/rollback`,
            headers: authHeaders,
        });

        expect(corruptedResponse.statusCode).toBe(403);
        expect(corruptedResponse.json()).toEqual({ error: 'rollback snapshot corrupted' });
    });
});
