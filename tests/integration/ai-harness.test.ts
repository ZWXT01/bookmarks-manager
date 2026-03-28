import { afterEach, describe, expect, it } from 'vitest';

import { assignBookmarks } from '../../src/ai-organize';
import { createPlan, getPlan, updatePlan } from '../../src/ai-organize-plan';
import { createJob, getJob, jobQueue } from '../../src/jobs';
import { createTestApp, type TestAppContext } from '../helpers/app';
import {
    activateAiTestTemplate,
    createQueuedAIHarness,
    jsonCompletion,
    seedAISettings,
    textCompletion,
    type MockAIStep,
} from '../helpers/ai';
import { seedBookmarks } from '../helpers/factories';

function parseAssignments(planId: string, assignments: string | null) {
    if (!assignments) {
        throw new Error(`plan ${planId} has no assignments`);
    }
    return JSON.parse(assignments) as Array<{
        bookmark_id: number;
        category_path: string;
        status: 'assigned' | 'needs_review';
    }>;
}

describe('integration: AI deterministic harness', () => {
    let ctx: TestAppContext | null = null;

    afterEach(async () => {
        if (!ctx) return;
        await ctx.cleanup();
        ctx = null;
    });

    async function createHarnessApp(steps: MockAIStep[]) {
        const harness = createQueuedAIHarness(steps);
        ctx = await createTestApp({ aiClientFactory: harness.aiClientFactory });
        const session = await ctx.login();
        return {
            ctx,
            harness,
            authHeaders: session.headers,
        };
    }

    it('classifies a single bookmark with an injected fixture instead of a real provider', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            textCompletion('技术开发/前端/React'),
        ]);
        const config = seedAISettings(appCtx.db);
        activateAiTestTemplate(appCtx.db);

        const response = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify',
            headers: authHeaders,
            payload: {
                title: 'React 文档',
                url: 'https://react.dev',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ category: '技术开发/前端' });
        expect(harness.calls).toHaveLength(1);
        expect(harness.calls[0]).toMatchObject({
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            timeout: 60000,
        });
        expect(harness.calls[0].messages[1].content).toContain('标题: React 文档');
        expect(harness.remainingSteps()).toBe(0);
    });

    it('runs classify-batch fully offline and persists a preview plan', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({
                assignments: [
                    { index: 1, category: '技术开发/前端' },
                    { index: 2, category: '学习资源' },
                ],
            }),
        ]);
        activateAiTestTemplate(appCtx.db);
        seedAISettings(appCtx.db);

        const bookmarkIds = seedBookmarks(appCtx.db, [
            { title: 'React', url: 'https://react.dev' },
            { title: 'TypeScript', url: 'https://www.typescriptlang.org' },
        ]);

        const response = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify-batch',
            headers: authHeaders,
            payload: {
                bookmark_ids: bookmarkIds,
                batch_size: 10,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ success: true });

        await jobQueue.onIdle();

        const { planId, jobId } = response.json() as { planId: string; jobId: string };
        const plan = getPlan(appCtx.db, planId);
        const job = getJob(appCtx.db, jobId);

        expect(plan).not.toBeNull();
        expect(job).not.toBeNull();
        expect(plan?.status).toBe('preview');
        expect(plan?.needs_review_count).toBe(0);
        expect(parseAssignments(plan!.id, plan!.assignments)).toEqual([
            { bookmark_id: bookmarkIds[0], category_path: '技术开发/前端', status: 'assigned' },
            { bookmark_id: bookmarkIds[1], category_path: '学习资源', status: 'assigned' },
        ]);
        expect(job).toMatchObject({
            status: 'done',
            total: 2,
            processed: 2,
            inserted: 2,
            skipped: 0,
        });
        expect(harness.calls).toHaveLength(1);
        expect(harness.remainingSteps()).toBe(0);
    });

    it('replays organize batch failures deterministically and marks every bookmark for review', async () => {
        ctx = await createTestApp();
        const templateId = activateAiTestTemplate(ctx.db).id;
        const config = seedAISettings(ctx.db);
        const bookmarkIds = seedBookmarks(ctx.db, [
            { title: 'React', url: 'https://react.dev' },
            { title: 'Node.js', url: 'https://nodejs.org' },
        ]);
        const plan = createPlan(ctx.db, 'all', templateId);
        const job = createJob(ctx.db, 'ai_organize', 'fixture organize failure', bookmarkIds.length);
        updatePlan(ctx.db, plan.id, { job_id: job.id });
        const harness = createQueuedAIHarness([new Error('fixture timeout')]);

        await assignBookmarks(
            ctx.db,
            plan.id,
            config,
            { timeout: 123, maxRetries: 0, failThreshold: 1 },
            10,
            harness.aiClientFactory,
        );

        const updatedPlan = getPlan(ctx.db, plan.id);
        expect(updatedPlan).not.toBeNull();
        expect(updatedPlan?.status).toBe('failed');
        expect(updatedPlan?.needs_review_count).toBe(bookmarkIds.length);
        expect(updatedPlan?.failed_batch_ids).toBe('[0]');
        expect(parseAssignments(updatedPlan!.id, updatedPlan!.assignments)).toEqual([
            { bookmark_id: bookmarkIds[0], category_path: '', status: 'needs_review' },
            { bookmark_id: bookmarkIds[1], category_path: '', status: 'needs_review' },
        ]);
        expect(getJob(ctx.db, job.id)).toMatchObject({
            status: 'failed',
            total: 2,
            processed: 2,
            inserted: 0,
            skipped: 2,
            message: 'plan failed',
        });
        expect(harness.calls).toHaveLength(1);
        expect(harness.calls[0].timeout).toBe(123);
        expect(harness.remainingSteps()).toBe(0);
    });
});
