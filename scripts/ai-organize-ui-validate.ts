import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { getPlan } from '../src/ai-organize-plan';
import { getCategoryByPath } from '../src/category-service';
import { getJob } from '../src/jobs';
import { activateAiTestTemplate, createQueuedAIHarness, jsonCompletion, seedAISettings } from '../tests/helpers/ai';
import { createTestApp } from '../tests/helpers/app';
import { seedBookmarks, seedJob, seedPlan } from '../tests/helpers/factories';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function pollUntil<T>(
    read: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs: number,
    description: string,
): Promise<T> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const value = await read();
        if (predicate(value)) return value;
        await sleep(100);
    }

    throw new Error(`Timed out waiting for ${description}`);
}

async function login(page: Page, baseUrl: string, username: string, password: string): Promise<void> {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: '请输入用户名' }).fill(username);
    await page.getByRole('textbox', { name: '请输入密码' }).fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(`${baseUrl}/`);
}

async function openOrganizeModal(page: Page): Promise<void> {
    if (await page.getByTestId('ai-organize-modal').isVisible().catch(() => false)) {
        return;
    }
    await page.getByTestId('open-ai-organize').click();
    await page.getByTestId('ai-organize-modal').waitFor({ state: 'visible' });
}

async function closeOrganizeModal(page: Page): Promise<void> {
    if (!(await page.getByTestId('ai-organize-modal').isVisible().catch(() => false))) {
        return;
    }
    const closeButton = page.getByTestId('ai-organize-close');
    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
    } else {
        await page.keyboard.press('Escape');
    }
    await page.getByTestId('ai-organize-modal').waitFor({ state: 'hidden' });
}

async function recoverPlanInUi(page: Page, planId: string): Promise<void> {
    await page.evaluate(async (currentPlanId) => {
        const root = document.querySelector('[x-data]') as HTMLElement & { _x_dataStack?: Array<Record<string, unknown>> } | null;
        const app = root?._x_dataStack?.[0] as { recoverActivePlan?: (planId: string) => Promise<void> } | undefined;
        if (!app?.recoverActivePlan) {
            throw new Error('bookmark app not ready');
        }
        await app.recoverActivePlan(currentPlanId);
    }, planId);
}

async function readCurrentPlanId(page: Page): Promise<string | null> {
    return page.evaluate(() => {
        const root = document.querySelector('[x-data]') as HTMLElement & { _x_dataStack?: Array<Record<string, unknown>> } | null;
        const app = root?._x_dataStack?.[0] as { organizePlan?: { id?: string | null } } | undefined;
        return app?.organizePlan?.id ?? null;
    });
}

async function readOrganizeAppState(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(() => {
        const root = document.querySelector('[x-data]') as HTMLElement & { _x_dataStack?: Array<Record<string, unknown>> } | null;
        const app = root?._x_dataStack?.[0] as {
            showAIOrganizeModal?: boolean;
            organizePhase?: string | null;
            organizePlan?: { id?: string | null; status?: string | null; message?: string | null } | null;
        } | undefined;
        return {
            showAIOrganizeModal: app?.showAIOrganizeModal ?? null,
            organizePhase: app?.organizePhase ?? null,
            organizePlanId: app?.organizePlan?.id ?? null,
            organizePlanStatus: app?.organizePlan?.status ?? null,
            organizePlanMessage: app?.organizePlan?.message ?? null,
        };
    });
}

async function readOrganizeMessage(page: Page): Promise<string> {
    return (await page.getByTestId('organize-phase-message').textContent())?.trim() ?? '';
}

async function readProgressSummary(page: Page): Promise<string> {
    return (await page.getByTestId('organize-progress-summary').textContent())?.trim() ?? '';
}

async function domClick(page: Page, testId: string): Promise<void> {
    await page.getByTestId(testId).evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
            throw new Error(`element is not clickable: ${testId}`);
        }
        element.click();
    });
}

async function callBookmarkAppMethod(page: Page, methodName: string): Promise<void> {
    await page.evaluate(async (currentMethodName) => {
        const root = document.querySelector('[x-data]') as HTMLElement & { _x_dataStack?: Array<Record<string, unknown>> } | null;
        const app = root?._x_dataStack?.[0] as Record<string, unknown> | undefined;
        const method = app?.[currentMethodName];
        if (typeof method !== 'function') {
            throw new Error(`bookmark app method not found: ${currentMethodName}`);
        }
        await method.call(app);
    }, methodName);
}

async function postJsonInPage(page: Page, url: string, body: unknown = {}): Promise<{ status: number; data: unknown }> {
    return page.evaluate(async ({ currentUrl, currentBody }) => {
        const response = await fetch(currentUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentBody),
        });
        const data = await response.json().catch(() => null);
        return {
            status: response.status,
            data,
        };
    }, { currentUrl: url, currentBody: body });
}

async function main() {
    const firstRun = createDeferred<ReturnType<typeof jsonCompletion>>();
    const aiHarness = createQueuedAIHarness([
        () => firstRun.promise,
        jsonCompletion({
            assignments: [
                { index: 1, category: '技术开发/后端' },
            ],
        }),
    ]);

    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-ai-organize-ui-',
        backupEnabled: false,
        periodicCheckEnabled: false,
        aiClientFactory: aiHarness.aiClientFactory,
    });

    let browser: Browser | null = null;

    try {
        seedAISettings(ctx.db);
        const template = activateAiTestTemplate(ctx.db, 'AI Organize UI 模板');
        const templateTree = JSON.parse(template.tree) as Array<Record<string, unknown>>;

        const docsCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const frontendCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        const backendCategory = getCategoryByPath(ctx.db, '技术开发/后端');

        assert(docsCategory, 'source category missing');
        assert(frontendCategory, 'frontend category missing');
        assert(backendCategory, 'backend category missing');

        const [assigningBookmarkId, retryBookmarkId, errorBookmarkId, previewMovingBookmarkId, previewKeeperBookmarkId] = seedBookmarks(ctx.db, [
            { title: 'Assigning Cancel Bookmark', url: 'https://assigning.example.test', categoryId: docsCategory.id },
            { title: 'Retry Bookmark', url: 'https://retry.example.test', categoryId: docsCategory.id },
            { title: 'Error Bookmark', url: 'https://error.example.test', categoryId: docsCategory.id },
            { title: 'Preview Moving Bookmark', url: 'https://preview-moving.example.test', categoryId: docsCategory.id },
            { title: 'Preview Keeper Bookmark', url: 'https://preview-keeper.example.test', categoryId: docsCategory.id },
        ]);

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);
        await page.getByTestId('active-template-name').waitFor({ state: 'visible' });

        await openOrganizeModal(page);
        await domClick(page, 'organize-start');
        await page.getByTestId('organize-phase-assigning').waitFor({ state: 'visible' });

        const assigningPlanId = await pollUntil(
            () => readCurrentPlanId(page),
            (value) => Boolean(value),
            5000,
            'assigning plan id',
        );
        assert(assigningPlanId, 'assigning plan id missing');
        assert.equal(await readProgressSummary(page), '批次 0 / 0');

        const cancelResponse = await postJsonInPage(page, `/api/ai/organize/${assigningPlanId}/cancel`);
        assert.equal(cancelResponse.status, 200);
        await pollUntil(
            async () => getPlan(ctx.db, assigningPlanId)?.status ?? null,
            (value) => value === 'canceled',
            5000,
            'assigning plan cancel transition',
        );
        await callBookmarkAppMethod(page, 'closeOrganizeModal');
        firstRun.resolve(jsonCompletion({
            assignments: [
                { index: 1, category: '技术开发/前端' },
            ],
        }));
        const hiddenAfterCancel = await pollUntil(
            async () => await page.getByTestId('ai-organize-modal').isHidden().catch(() => true),
            (value) => value === true,
            5000,
            'assigning modal to hide after cancel',
        ).catch(async () => {
            const appState = await readOrganizeAppState(page);
            const dbState = getPlan(ctx.db, assigningPlanId);
            throw new Error(`assigning modal stayed open after cancel: ${JSON.stringify({ appState, dbState }, null, 2)}`);
        });
        assert.equal(hiddenAfterCancel, true);

        const assigningPlan = getPlan(ctx.db, assigningPlanId);
        assert(assigningPlan, 'assigning plan missing after cancel');
        assert.equal(assigningPlan.status, 'canceled');
        assert.equal(assigningPlan.phase, null);
        assert.equal(getJob(ctx.db, assigningPlan.job_id!)?.status, 'canceled');
        assert.equal(getPlan(ctx.db, assigningPlanId)?.status, 'canceled');

        const retryJob = seedJob(ctx.db, {
            id: 'ui-failed-job',
            type: 'ai_organize',
            status: 'failed',
            total: 1,
            processed: 1,
            inserted: 0,
            skipped: 1,
            failed: 1,
            message: '连续多个批次失败，请检查 AI 配置后重试',
        });
        const retryPlan = seedPlan(ctx.db, {
            id: 'ui-failed-plan',
            job_id: retryJob.id,
            status: 'failed',
            scope: `ids:${retryBookmarkId}`,
            template_id: template.id,
            target_tree: templateTree,
            assignments: [{ bookmark_id: retryBookmarkId, category_path: '', status: 'needs_review' }],
            failed_batch_ids: [0],
            needs_review_count: 1,
            batches_done: 1,
            batches_total: 1,
        });

        await openOrganizeModal(page);
        await recoverPlanInUi(page, retryPlan.id);
        await page.getByTestId('organize-phase-failed').waitFor({ state: 'visible' });
        assert.equal(await readOrganizeMessage(page), '连续多个批次失败，请检查 AI 配置后重试');
        assert.equal((await page.getByTestId('organize-failed-batches').textContent())?.trim(), '失败批次: 0');

        const retryResponse = await postJsonInPage(page, `/api/ai/organize/${retryPlan.id}/retry`);
        assert.equal(retryResponse.status, 200);
        await pollUntil(
            async () => getPlan(ctx.db, retryPlan.id)?.status ?? null,
            (value) => value === 'preview',
            5000,
            'failed plan retry to preview',
        );
        await recoverPlanInUi(page, retryPlan.id);
        await page.getByTestId('organize-phase-preview').waitFor({ state: 'visible' });

        const retriedPlan = getPlan(ctx.db, retryPlan.id);
        assert(retriedPlan, 'retried plan missing');
        assert.equal(retriedPlan.status, 'preview');
        const retrySummary = await readProgressSummary(page);
        assert.equal(retrySummary, '共处理 1 / 1 批次');

        await closeOrganizeModal(page);

        const errorJob = seedJob(ctx.db, {
            id: 'ui-error-job',
            type: 'ai_organize',
            status: 'failed',
            total: 1,
            processed: 0,
            inserted: 0,
            skipped: 0,
            failed: 1,
            message: 'plan is stale: scope bookmarks changed',
        });
        const errorPlan = seedPlan(ctx.db, {
            id: 'ui-error-plan',
            job_id: errorJob.id,
            status: 'error',
            scope: `ids:${errorBookmarkId}`,
            template_id: template.id,
            target_tree: templateTree,
        });

        await openOrganizeModal(page);
        await recoverPlanInUi(page, errorPlan.id);
        await page.getByTestId('organize-phase-error').waitFor({ state: 'visible' });
        assert.equal(await readOrganizeMessage(page), 'plan is stale: scope bookmarks changed');

        const errorCancelResponse = await postJsonInPage(page, `/api/ai/organize/${errorPlan.id}/cancel`);
        assert.equal(errorCancelResponse.status, 200);
        await callBookmarkAppMethod(page, 'closeOrganizeModal');
        await page.getByTestId('ai-organize-modal').waitFor({ state: 'hidden' });
        await pollUntil(
            async () => getPlan(ctx.db, errorPlan.id)?.status ?? null,
            (value) => value === 'canceled',
            5000,
            'error plan cancel transition',
        );

        const previewJob = seedJob(ctx.db, {
            id: 'ui-preview-job',
            type: 'ai_organize',
            status: 'done',
            total: 1,
            processed: 1,
            inserted: 1,
            skipped: 0,
            failed: 0,
            message: '整理预览已生成',
        });
        const previewPlan = seedPlan(ctx.db, {
            id: 'ui-preview-plan',
            job_id: previewJob.id,
            status: 'preview',
            scope: `ids:${previewMovingBookmarkId},${previewKeeperBookmarkId}`,
            template_id: template.id,
            target_tree: templateTree,
            assignments: [
                { bookmark_id: previewMovingBookmarkId, category_path: '技术开发/前端', status: 'assigned' },
            ],
            batches_done: 1,
            batches_total: 1,
            needs_review_count: 0,
            created_at: new Date(Date.now() - 60_000).toISOString(),
        });

        await page.goto(`${baseUrl}/jobs/${previewJob.id}`, { waitUntil: 'domcontentloaded' });
        await page.locator('#apply-plan-btn').waitFor({ state: 'visible' });
        await page.locator('#apply-plan-btn').click();
        await page.locator('#plan-applied').waitFor({ state: 'visible' });

        await pollUntil(
            async () => getPlan(ctx.db, previewPlan.id)?.status ?? null,
            (value) => value === 'applied',
            5000,
            'preview plan apply transition',
        );

        const movedBookmark = ctx.db.prepare('SELECT category_id FROM bookmarks WHERE id = ?').get(previewMovingBookmarkId) as { category_id: number | null };
        const keptBookmark = ctx.db.prepare('SELECT category_id FROM bookmarks WHERE id = ?').get(previewKeeperBookmarkId) as { category_id: number | null };
        assert.equal(movedBookmark.category_id, frontendCategory.id);
        assert.equal(keptBookmark.category_id, docsCategory.id);

        console.log(JSON.stringify({
            issueIds: ['R6-AI-01', 'R7-AI-01', 'R7-AI-05', 'R7-AI-06'],
            mode: 'ai-organize-ui-harness',
            baseUrl,
            results: {
                assigningCancel: {
                    planId: assigningPlanId,
                    status: assigningPlan.status,
                    jobStatus: getJob(ctx.db, assigningPlan.job_id!)?.status ?? null,
                    sourceBookmarkId: assigningBookmarkId,
                },
                failedRetry: {
                    planId: retryPlan.id,
                    status: retriedPlan.status,
                    message: getJob(ctx.db, retryJob.id)?.message ?? null,
                    summary: retrySummary,
                },
                errorCancel: {
                    planId: errorPlan.id,
                    status: getPlan(ctx.db, errorPlan.id)?.status ?? null,
                    message: getJob(ctx.db, errorJob.id)?.message ?? null,
                },
                previewApply: {
                    planId: previewPlan.id,
                    status: getPlan(ctx.db, previewPlan.id)?.status ?? null,
                    movedBookmarkCategoryId: movedBookmark.category_id,
                    keptBookmarkCategoryId: keptBookmark.category_id,
                },
            },
        }, null, 2));
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            await ctx.cleanup();
        }
    }

    process.exit(0);
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
