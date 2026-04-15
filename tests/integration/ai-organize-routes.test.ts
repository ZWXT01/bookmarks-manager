import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPlan, getPlan, transitionStatus, updatePlan } from '../../src/ai-organize-plan';
import { getCategoryByPath } from '../../src/category-service';
import { getJob, jobQueue } from '../../src/jobs';
import { createTemplate, updateTemplate } from '../../src/template-service';
import { createTestApp, type TestAppContext } from '../helpers/app';
import {
    activateAiTestTemplate,
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

function listTemplateSnapshots(ctx: TestAppContext, templateId: number) {
    return ctx.db.prepare(
        'SELECT bookmark_id, category_path FROM template_snapshots WHERE template_id = ? ORDER BY bookmark_id',
    ).all(templateId) as Array<{ bookmark_id: number; category_path: string }>;
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
        activateAiTestTemplate(appCtx.db);

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

    it('uses the latest active template for default organize while preserving explicit template overrides', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({
                assignments: [
                    { index: 1, category: '技术开发/前端' },
                    { index: 2, category: '学习资源/教程' },
                ],
            }),
            jsonCompletion({
                assignments: [
                    { index: 1, category: '归档/稍后阅读' },
                ],
            }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        const activeTemplate = activateAiTestTemplate(appCtx.db, '活动模板');

        const oldFrontend = getCategoryByPath(appCtx.db, '技术开发/前端');
        const oldDocs = getCategoryByPath(appCtx.db, '学习资源/文档');
        expect(oldFrontend).toBeTruthy();
        expect(oldDocs).toBeTruthy();

        const bookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'Legacy Frontend Bookmark', url: 'https://legacy-frontend.example.test', categoryId: oldFrontend!.id },
            { title: 'Legacy Docs Bookmark', url: 'https://legacy-docs.example.test', categoryId: oldDocs!.id },
        ]);

        const updatedTree = [
            { name: '技术开发', children: [{ name: 'Web前端' }, { name: '后端' }] },
            { name: '学习资源', children: [{ name: '教程' }] },
        ];
        updateTemplate(appCtx.db, activeTemplate.id, { tree: updatedTree });

        const explicitTree = [
            { name: '归档', children: [{ name: '稍后阅读' }] },
            { name: '参考', children: [{ name: 'API' }] },
        ];
        const explicitTemplate = createTemplate(appCtx.db, '显式模板', explicitTree);

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
        expect(defaultPlan?.template_id).toBe(activeTemplate.id);
        expect(defaultPlan?.target_tree ? JSON.parse(defaultPlan.target_tree) : null).toEqual(updatedTree);
        expect(defaultPlan?.assignments ? JSON.parse(defaultPlan.assignments) : null).toEqual([
            { bookmark_id: bookmarkIds[0], category_path: '', status: 'needs_review' },
            { bookmark_id: bookmarkIds[1], category_path: '学习资源/教程', status: 'assigned' },
        ]);

        const discardDefaultResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${defaultPlan!.id}/cancel`,
            headers: authHeaders,
        });
        expect(discardDefaultResponse.statusCode).toBe(200);
        expect(getPlan(appCtx.db, defaultPlan!.id)?.status).toBe('canceled');

        const explicitResponse = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/organize',
            headers: authHeaders,
            payload: {
                scope: `ids:${bookmarkIds[0]}`,
                batch_size: 10,
                template_id: explicitTemplate.id,
            },
        });
        expect(explicitResponse.statusCode).toBe(200);
        await jobQueue.onIdle();

        const explicitPrompt = harness.calls[1].messages[0].content as string;
        expect(explicitPrompt).toContain('\n归档/稍后阅读\n');
        expect(explicitPrompt).toContain('\n参考/API\n');
        expect(explicitPrompt.includes('\n技术开发/Web前端\n')).toBe(false);
        expect(explicitPrompt.includes('\n学习资源/教程\n')).toBe(false);

        const explicitPlan = getPlan(appCtx.db, (explicitResponse.json() as { planId: string }).planId);
        expect(explicitPlan).not.toBeNull();
        expect(explicitPlan?.template_id).toBe(explicitTemplate.id);
        expect(explicitPlan?.target_tree ? JSON.parse(explicitPlan.target_tree) : null).toEqual(explicitTree);
        expect(explicitPlan?.assignments ? JSON.parse(explicitPlan.assignments) : null).toEqual([
            { bookmark_id: bookmarkIds[0], category_path: '归档/稍后阅读', status: 'assigned' },
        ]);
    });

    it('covers live-template apply, confirm-empty, and rollback restoration', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const template = activateAiTestTemplate(ctx.db);
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
            template_id: template.id,
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
            template_name: template.name,
            applied_count: 1,
            empty_categories: [{ id: sourceCategory!.id, name: sourceCategory!.name }],
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('preview');
        expect(getBookmarkCategoryId(ctx, movingBookmarkId)).toBe(targetCategory!.id);

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

    it('covers apply conflict detection and resolve override flow', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const template = activateAiTestTemplate(ctx.db);
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
            template_id: template.id,
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

    it('covers cross-template apply and rollback through template snapshots', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        activateAiTestTemplate(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        expect(sourceCategory).toBeTruthy();

        const crossTemplate = createTemplate(ctx.db, '跨模板测试', [
            { name: '工作', children: [{ name: '项目' }] },
            { name: '学习', children: [{ name: '资料' }] },
            { name: '生活', children: [{ name: '旅行' }] },
        ]);

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Cross Template Bookmark', url: 'https://cross.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            template_id: crossTemplate.id,
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: bookmarkId, category_path: '工作/项目', status: 'assigned' },
            ],
        });

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toEqual({
            success: true,
            needs_confirm: false,
            template_name: crossTemplate.name,
            conflicts: [],
            empty_categories: [],
            applied_count: 1,
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('applied');
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(sourceCategory!.id);
        expect(listTemplateSnapshots(ctx, crossTemplate.id)).toEqual([
            { bookmark_id: bookmarkId, category_path: '工作/项目' },
        ]);

        const rollbackResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/rollback`,
            headers: authHeaders,
        });

        expect(rollbackResponse.statusCode).toBe(200);
        expect(rollbackResponse.json()).toEqual({
            success: true,
            restored_categories: 0,
            restored_bookmarks: 1,
        });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('rolled_back');
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(sourceCategory!.id);
        expect(listTemplateSnapshots(ctx, crossTemplate.id)).toEqual([]);
    });

    it('rejects stale apply when a preview bookmark was deleted before apply', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const template = activateAiTestTemplate(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');

        expect(sourceCategory).toBeTruthy();

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Deleted Later', url: 'https://deleted-after-preview.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            template_id: template.id,
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
        expect(applyResponse.json()).toEqual({ error: 'plan is stale: bookmarks changed' });
        expect(getPlan(ctx.db, plan.id)?.status).toBe('preview');
    });

    it('surfaces a conflict when bookmark category drifted without changing updated_at', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const template = activateAiTestTemplate(ctx.db);
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
            template_id: template.id,
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

    it('rejects stale apply when target categories changed instead of recreating them', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const template = activateAiTestTemplate(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const targetCategory = getCategoryByPath(ctx.db, '技术开发/前端');

        expect(sourceCategory).toBeTruthy();
        expect(targetCategory).toBeTruthy();

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Target Drift Bookmark', url: 'https://target-drift.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            template_id: template.id,
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: bookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
        });

        ctx.db.prepare('UPDATE categories SET name = ? WHERE id = ?').run('技术开发/前端新版', targetCategory!.id);

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        const recreatedCount = ctx.db.prepare(
            `SELECT COUNT(*) AS count FROM categories WHERE parent_id = ? AND (name = ? OR name = ?)`
        ).get(targetCategory!.parent_id, '技术开发/前端', '前端') as { count: number };

        expect(applyResponse.statusCode).toBe(409);
        expect(applyResponse.json()).toEqual({ error: 'plan is stale: target categories changed' });
        expect(recreatedCount.count).toBe(0);
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(sourceCategory!.id);
    });

    it('allows overlapping preview plans to apply through explicit conflict resolution', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const template = activateAiTestTemplate(ctx.db);
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
            template_id: template.id,
            created_at: '2026-03-29T08:00:00.000Z',
            assignments: [
                { bookmark_id: bookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
        });

        const newerPlan = seedPlan(ctx.db, {
            status: 'preview',
            template_id: template.id,
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
            { id: targetCategory!.id, name: targetCategory!.name },
        ]);
        expect(getPlan(ctx.db, newerPlan.id)?.status).toBe('applied');
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(newerTargetCategory!.id);
        expect(getBookmarkCategoryId(ctx, keeperBookmarkId)).toBe(sourceCategory!.id);
    });

    it('allows a same-template preview plan to apply directly when newer plans do not overlap', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const template = activateAiTestTemplate(ctx.db);
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
            template_id: template.id,
            created_at: '2026-03-29T09:00:00.000Z',
            assignments: [
                { bookmark_id: olderBookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
        });

        seedPlan(ctx.db, {
            status: 'preview',
            template_id: template.id,
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

    it('rejects cross-template apply when the target template changed after preview generation', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        activateAiTestTemplate(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        expect(sourceCategory).toBeTruthy();

        const crossTemplate = createTemplate(ctx.db, '跨模板漂移测试', [
            { name: '工作', children: [{ name: '项目' }] },
            { name: '学习', children: [{ name: '资料' }] },
            { name: '生活', children: [{ name: '旅行' }] },
        ]);

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Template Drift Bookmark', url: 'https://template-drift.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            template_id: crossTemplate.id,
            created_at: new Date(Date.now() - 60_000).toISOString(),
            assignments: [
                { bookmark_id: bookmarkId, category_path: '工作/项目', status: 'assigned' },
            ],
        });

        const updatedTree = [
            { name: '工作', children: [{ name: '项目管理' }] },
            { name: '学习', children: [{ name: '资料' }] },
            { name: '生活', children: [{ name: '旅行' }] },
        ];
        ctx.db.prepare('UPDATE category_templates SET tree = ?, updated_at = ? WHERE id = ?').run(
            JSON.stringify(updatedTree),
            '2026-03-29T10:00:00.000Z',
            crossTemplate.id,
        );

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${plan.id}/apply`,
            headers: authHeaders,
        });

        expect(applyResponse.statusCode).toBe(409);
        expect(applyResponse.json()).toEqual({ error: 'plan is stale: target template changed' });
        expect(listTemplateSnapshots(ctx, crossTemplate.id)).toEqual([]);
        expect(getBookmarkCategoryId(ctx, bookmarkId)).toBe(sourceCategory!.id);
    });

    it('rejects resolve when a conflicted bookmark was deleted after the first apply attempt', async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        const authHeaders = session.headers;
        const template = activateAiTestTemplate(ctx.db);
        const sourceCategory = getCategoryByPath(ctx.db, '学习资源/文档');

        expect(sourceCategory).toBeTruthy();

        const [bookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Deleted During Resolve', url: 'https://resolve-delete.example.test', categoryId: sourceCategory!.id },
        ]);

        const plan = seedPlan(ctx.db, {
            status: 'preview',
            template_id: template.id,
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
        expect(resolveResponse.json()).toEqual({ error: 'plan is stale: bookmarks changed' });
    });

    it('covers retry with the configured batch size default', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({ assignments: buildAssignments(25, '技术开发/前端') }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 30 });
        const template = activateAiTestTemplate(appCtx.db);

        seedBookmarks(appCtx.db, Array.from({ length: 25 }, (_, index) => ({
            title: `Retry Bookmark ${index + 1}`,
            url: `https://retry-${index + 1}.example.test`,
        })));

        const failedPlan = seedPlan(appCtx.db, {
            status: 'failed',
            template_id: template.id,
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
        const template = activateAiTestTemplate(ctx.db);
        const failedPlan = seedPlan(ctx.db, {
            status: 'failed',
            template_id: template.id,
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
        const template = activateAiTestTemplate(appCtx.db);
        seedBookmarks(appCtx.db, [
            { title: 'Retry Error 1', url: 'https://retry-error-1.example.test' },
            { title: 'Retry Error 2', url: 'https://retry-error-2.example.test' },
        ]);

        const errorPlan = createPlan(appCtx.db, 'all', template.id);
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
        activateAiTestTemplate(appCtx.db);
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
        const template = activateAiTestTemplate(appCtx.db);

        const originalBookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'Frozen Scope Retry 1', url: 'https://frozen-retry-1.example.test' },
            { title: 'Frozen Scope Retry 2', url: 'https://frozen-retry-2.example.test' },
        ]);

        const failedPlan = createPlan(appCtx.db, 'all', template.id);
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
        const template = activateAiTestTemplate(appCtx.db);
        const bookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'Retry Clear 1', url: 'https://retry-clear-1.example.test' },
            { title: 'Retry Clear 2', url: 'https://retry-clear-2.example.test' },
        ]);

        const failedPlan = createPlan(appCtx.db, 'all', template.id);
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
        const template = activateAiTestTemplate(appCtx.db);
        const bookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'Retry Missing 1', url: 'https://retry-missing-1.example.test' },
            { title: 'Retry Missing 2', url: 'https://retry-missing-2.example.test' },
        ]);

        const failedPlan = createPlan(appCtx.db, `ids:${bookmarkIds.join(',')}`, template.id);
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

    it('rejects starting a second organize plan while another plan is assigning and returns activePlanId', async () => {
        const deferred = createDeferred<ReturnType<typeof jsonCompletion>>();
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([() => deferred.promise]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        activateAiTestTemplate(appCtx.db);
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
        expect(secondResponse.json()).toEqual({
            error: 'active plan already exists',
            activePlanId: planId,
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
        expect(response.json()).toEqual({
            error: 'pending plan already exists',
            pendingPlanId: previewPlan.id,
            pendingJobId: previewJob.id,
        });
    });

    it('rejects retry when another organize plan is already assigning and returns activePlanId', async () => {
        const deferred = createDeferred<ReturnType<typeof jsonCompletion>>();
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([() => deferred.promise]);
        seedAISettings(appCtx.db, { batchSize: 10 });
        const template = activateAiTestTemplate(appCtx.db);
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
            template_id: template.id,
            scope: 'all',
        });

        const retryResponse = await appCtx.app.inject({
            method: 'POST',
            url: `/api/ai/organize/${failedPlan.id}/retry`,
            headers: authHeaders,
        });

        expect(retryResponse.statusCode).toBe(409);
        expect(retryResponse.json()).toEqual({
            error: 'active plan already exists',
            activePlanId,
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
        expect(response.json()).toEqual({
            error: 'pending plan already exists',
            pendingPlanId: previewPlan.id,
            pendingJobId: previewJob.id,
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
        activateAiTestTemplate(appCtx.db);
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
            active_template_id: null,
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
                active_template_id: null,
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
