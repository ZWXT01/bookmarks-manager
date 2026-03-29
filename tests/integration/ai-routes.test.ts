import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPlan } from '../../src/ai-organize-plan';
import { getJob, jobQueue } from '../../src/jobs';
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

describe('integration: ai route contracts', () => {
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

    function buildAssignments(count: number, category: string) {
        return Array.from({ length: count }, (_, index) => ({
            index: index + 1,
            category,
        }));
    }

    it('covers /api/ai/test validation, success, and provider failures', async () => {
        const { ctx: appCtx, authHeaders } = await createHarnessApp();

        const missingConfig = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/test',
            headers: authHeaders,
            payload: { base_url: '', api_key: '', model: '' },
        });
        expect(missingConfig.statusCode).toBe(400);
        expect(missingConfig.json()).toEqual({ error: '请填写完整的 AI 配置' });

        const successHarness = createQueuedAIHarness([textCompletion('OK')]);
        await appCtx.cleanup();
        ctx = await createTestApp({ aiClientFactory: successHarness.aiClientFactory });
        const successSession = await ctx.login();

        const successResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/test',
            headers: successSession.headers,
            payload: {
                base_url: 'https://mock-ai.example.test/v1',
                api_key: 'test-key',
                model: 'mock-model',
            },
        });
        expect(successResponse.statusCode).toBe(200);
        expect(successResponse.json()).toEqual({ success: true, message: 'AI 配置测试成功' });

        const failureHarness = createQueuedAIHarness([new Error('fixture test failure')]);
        await ctx.cleanup();
        ctx = await createTestApp({ aiClientFactory: failureHarness.aiClientFactory });
        const failureSession = await ctx.login();

        const failureResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/test',
            headers: failureSession.headers,
            payload: {
                base_url: 'https://mock-ai.example.test/v1',
                api_key: 'test-key',
                model: 'mock-model',
            },
        });
        expect(failureResponse.statusCode).toBe(500);
        expect(failureResponse.json()).toEqual({ error: 'fixture test failure' });
    });

    it('covers /api/ai/classify validation, taxonomy guardrails, empty results, and provider failures', async () => {
        const { ctx: appCtx, authHeaders } = await createHarnessApp();

        const missingConfig = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify',
            headers: authHeaders,
            payload: { title: 'React', url: 'https://react.dev' },
        });
        expect(missingConfig.statusCode).toBe(400);
        expect(missingConfig.json()).toEqual({ error: '请先在设置页配置 AI' });

        seedAISettings(appCtx.db);
        activateAiTestTemplate(appCtx.db);

        const missingInput = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify',
            headers: authHeaders,
            payload: { title: '', url: '' },
        });
        expect(missingInput.statusCode).toBe(400);
        expect(missingInput.json()).toEqual({ error: '请提供标题或URL' });

        const successHarness = createQueuedAIHarness([textCompletion('技术开发/后端/Node.js')]);
        await appCtx.cleanup();
        ctx = await createTestApp({ aiClientFactory: successHarness.aiClientFactory });
        const successSession = await ctx.login();
        seedAISettings(ctx.db);
        activateAiTestTemplate(ctx.db);

        const formPayload = new URLSearchParams({ url: 'https://nodejs.org', title: '' }).toString();
        const successResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/classify',
            headers: {
                ...successSession.headers,
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            payload: formPayload,
        });
        expect(successResponse.statusCode).toBe(200);
        expect(successResponse.json()).toEqual({ category: '技术开发/后端' });
        expect(successHarness.calls[0].messages[1].content).toContain('候选分类（必须原样选择其一');
        expect(successHarness.calls[0].messages[1].content).toContain('技术开发/前端');
        expect(successHarness.calls[0].messages[1].content).toContain('学习资源/文档');

        const normalizedHarness = createQueuedAIHarness([textCompletion('学习资源/React')]);
        await ctx.cleanup();
        ctx = await createTestApp({ aiClientFactory: normalizedHarness.aiClientFactory });
        const normalizedSession = await ctx.login();
        seedAISettings(ctx.db);
        activateAiTestTemplate(ctx.db);

        const normalizedResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/classify',
            headers: normalizedSession.headers,
            payload: {
                title: 'React 官方文档',
                url: 'https://react.dev',
            },
        });
        expect(normalizedResponse.statusCode).toBe(200);
        expect(normalizedResponse.json()).toEqual({ category: '学习资源/文档' });

        const unmappedHarness = createQueuedAIHarness([textCompletion('完全不存在/随便')]);
        await ctx.cleanup();
        ctx = await createTestApp({ aiClientFactory: unmappedHarness.aiClientFactory });
        const unmappedSession = await ctx.login();
        seedAISettings(ctx.db);
        activateAiTestTemplate(ctx.db);

        const unmappedResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/classify',
            headers: unmappedSession.headers,
            payload: {
                title: 'Unknown',
                url: 'https://unknown.example.test',
            },
        });
        expect(unmappedResponse.statusCode).toBe(502);
        expect(unmappedResponse.json()).toEqual({ error: 'AI 返回的分类不在当前分类树中' });

        const emptyHarness = createQueuedAIHarness([textCompletion('   ')]);
        await ctx.cleanup();
        ctx = await createTestApp({ aiClientFactory: emptyHarness.aiClientFactory });
        const emptySession = await ctx.login();
        seedAISettings(ctx.db);
        activateAiTestTemplate(ctx.db);

        const emptyResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/classify',
            headers: emptySession.headers,
            payload: { title: 'Empty Result', url: 'https://empty.example.test' },
        });
        expect(emptyResponse.statusCode).toBe(502);
        expect(emptyResponse.json()).toEqual({ error: 'AI 未返回分类结果' });

        const failureHarness = createQueuedAIHarness([new Error('fixture classify failure')]);
        await ctx.cleanup();
        ctx = await createTestApp({ aiClientFactory: failureHarness.aiClientFactory });
        const failureSession = await ctx.login();
        seedAISettings(ctx.db);
        activateAiTestTemplate(ctx.db);

        const failureResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/ai/classify',
            headers: failureSession.headers,
            payload: { title: 'Broken', url: 'https://broken.example.test' },
        });
        expect(failureResponse.statusCode).toBe(500);
        expect(failureResponse.json()).toEqual({ error: 'fixture classify failure' });
    });

    it('covers classify-batch validation, config checks, and template requirements', async () => {
        const { ctx: appCtx, authHeaders } = await createHarnessApp();

        const invalidIds = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify-batch',
            headers: authHeaders,
            payload: { bookmark_ids: [], batch_size: 10 },
        });
        expect(invalidIds.statusCode).toBe(400);
        expect(invalidIds.json()).toEqual({ error: '请提供书签 ID 列表' });

        const invalidNormalizedIds = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify-batch',
            headers: authHeaders,
            payload: { bookmark_ids: ['x', 0, -1], batch_size: 10 },
        });
        expect(invalidNormalizedIds.statusCode).toBe(400);
        expect(invalidNormalizedIds.json()).toEqual({ error: '无有效的书签 ID' });

        const missingConfig = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify-batch',
            headers: authHeaders,
            payload: { bookmark_ids: [1], batch_size: 10 },
        });
        expect(missingConfig.statusCode).toBe(400);
        expect(missingConfig.json()).toEqual({ error: '请先在设置页配置 AI' });

        seedAISettings(appCtx.db);

        const invalidBatchSize = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify-batch',
            headers: authHeaders,
            payload: { bookmark_ids: [1], batch_size: 25 },
        });
        expect(invalidBatchSize.statusCode).toBe(400);
        expect(invalidBatchSize.json()).toEqual({ error: 'batch_size 必须为 10、20 或 30' });

        const missingTemplate = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify-batch',
            headers: authHeaders,
            payload: { bookmark_ids: [1], batch_size: 10 },
        });
        expect(missingTemplate.statusCode).toBe(400);
        expect(missingTemplate.json()).toEqual({ error: '请先应用一个分类模板' });

        const invalidTemplate = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify-batch',
            headers: authHeaders,
            payload: { bookmark_ids: [1], batch_size: 10, template_id: 999999 },
        });
        expect(invalidTemplate.statusCode).toBe(400);
        expect(invalidTemplate.json()).toEqual({ error: '指定的模板不存在' });
    });

    it('creates preview plans with the configured default batch size for successful classify-batch requests', async () => {
        const { ctx: appCtx, harness, authHeaders } = await createHarnessApp([
            jsonCompletion({
                assignments: buildAssignments(25, '技术开发/前端'),
            }),
        ]);
        seedAISettings(appCtx.db, { batchSize: 30 });
        const template = activateAiTestTemplate(appCtx.db);
        const bookmarkIds = seedBookmarks(appCtx.db, Array.from({ length: 25 }, (_, index) => ({
            title: `Bookmark ${index + 1}`,
            url: `https://bookmark-${index + 1}.example.test`,
        })));

        const response = await appCtx.app.inject({
            method: 'POST',
            url: '/api/ai/classify-batch',
            headers: authHeaders,
            payload: {
                bookmark_ids: bookmarkIds,
                template_id: template.id,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ success: true });

        await jobQueue.onIdle();

        const { planId, jobId } = response.json() as { planId: string; jobId: string };
        const plan = getPlan(appCtx.db, planId);
        const job = getJob(appCtx.db, jobId);

        expect(plan?.status).toBe('preview');
        expect(plan?.needs_review_count).toBe(0);
        expect(job).toMatchObject({
            status: 'done',
            total: 25,
            processed: 25,
            inserted: 25,
            skipped: 0,
        });
        expect(harness.calls).toHaveLength(1);
    });

});
