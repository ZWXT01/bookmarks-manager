import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { addJobFailure, getJob } from '../src/jobs';
import { createTestApp } from '../tests/helpers/app';
import { seedJob } from '../tests/helpers/factories';

interface CurrentJobCancelResult {
    jobId: string;
    bannerProgress: string;
    finalStatus: string;
    bannerHiddenAfterCancel: boolean;
}

interface ImportCancelResult {
    jobId: string;
    summaryBeforeCancel: string;
    finalStatus: string;
    modalHiddenAfterCancel: boolean;
}

interface JobDetailCancelResult {
    jobId: string;
    statusAfterReload: string;
    messageAfterReload: string;
    cancelButtonVisibleAfterReload: boolean;
}

interface FailurePaginationResult {
    jobId: string;
    initialPage: string;
    initialTotalPages: string;
    initialRowCount: number;
    initialFirstInput: string;
    secondPage: string;
    secondPageRowCount: number;
    secondPageInputs: string[];
    pageSizeAfterChange: string;
    totalPagesAfterChange: string;
    rowCountAfterChange: number;
    firstInputAfterChange: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil<T>(
    read: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs: number,
    description: string,
): Promise<T> {
    const startedAt = Date.now();
    let lastError: unknown = null;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const value = await read();
            if (predicate(value)) return value;
        } catch (error) {
            lastError = error;
        }
        await sleep(100);
    }

    if (lastError instanceof Error) {
        throw new Error(`Timed out waiting for ${description}: ${lastError.message}`);
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

async function getAlpineApp(page: Page): Promise<void> {
    await pollUntil(
        () => page.locator('body > div[x-data]').evaluate((node) => Boolean((node as { _x_dataStack?: unknown[] })._x_dataStack?.[0])),
        (ready) => ready === true,
        5000,
        'homepage Alpine app to initialize',
    );
}

async function mountImportProgressModal(page: Page, jobId: string): Promise<void> {
    await page.locator('body > div[x-data]').evaluate((node, mountedJobId) => {
        const app = (node as { _x_dataStack?: Array<Record<string, unknown>> })._x_dataStack?.[0];
        if (!app) throw new Error('bookmark app not found');

        app.importJobId = mountedJobId;
        app.jobType = 'import';
        app.lastJobId = mountedJobId;
        app.lastJobType = 'import';
        app.showImportProgressModal = true;
        app.importStats = { processed: 0, total: 10, inserted: 0, failed: 0 };
        app.importProgress = 0;

        const subscribe = app.subscribeToImportProgress;
        if (typeof subscribe !== 'function') throw new Error('subscribeToImportProgress is not available');
        subscribe.call(app);
    }, jobId);
}

async function readFailureInputs(page: Page): Promise<string[]> {
    return page.getByTestId('failure-input').evaluateAll((nodes) => {
        return nodes
            .map((node) => (node.textContent ?? '').trim())
            .filter(Boolean);
    });
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-job-cancel-failures-browser-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        const currentJob = seedJob(ctx.db, {
            id: 'browser-current-job-cancel',
            type: 'check',
            status: 'running',
            total: 6,
            processed: 2,
            inserted: 0,
            skipped: 0,
            failed: 0,
            message: '检查中：顶部任务取消',
        });

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);
        await getAlpineApp(page);

        const banner = page.getByTestId('current-job-banner');
        await pollUntil(
            async () => (await banner.getAttribute('data-job-id')) ?? '',
            (jobId) => jobId === currentJob.id,
            10000,
            'current job banner to bind the check job',
        );

        const bannerProgress = ((await page.getByTestId('current-job-progress').textContent()) ?? '').trim();
        assert.equal(bannerProgress, '2/6');

        await page.getByTestId('current-job-cancel').click();

        const currentJobAfterCancel = await pollUntil(
            async () => getJob(ctx.db, currentJob.id)?.status ?? '',
            (status) => status === 'canceled',
            5000,
            'current job status to become canceled',
        );

        const bannerHiddenAfterCancel = await pollUntil(
            async () => await page.getByTestId('current-job-banner').count(),
            (count) => count === 0,
            5000,
            'current job banner to disappear after cancel',
        ).then(() => true);

        const importJob = seedJob(ctx.db, {
            id: 'browser-import-cancel',
            type: 'import',
            status: 'running',
            total: 10,
            processed: 0,
            inserted: 0,
            skipped: 0,
            failed: 0,
            message: '正在导入',
        });

        await mountImportProgressModal(page, importJob.id);
        await page.getByTestId('import-progress-modal').waitFor({ state: 'visible' });

        const summaryBeforeCancel = await pollUntil(
            async () => ((await page.getByTestId('import-progress-summary').textContent()) ?? '').trim(),
            (summary) => summary === '0/10 (成功:0 失败:0)',
            5000,
            'import progress summary to initialize',
        );

        await page.getByTestId('import-progress-cancel').click();

        const importJobAfterCancel = await pollUntil(
            async () => getJob(ctx.db, importJob.id)?.status ?? '',
            (status) => status === 'canceled',
            5000,
            'import job status to become canceled',
        );

        const modalHiddenAfterCancel = await pollUntil(
            async () => await page.getByTestId('import-progress-modal').isVisible().catch(() => false),
            (visible) => visible === false,
            6000,
            'import progress modal to disappear after cancel',
        ).then(() => true);

        const detailJob = seedJob(ctx.db, {
            id: 'browser-job-detail-cancel',
            type: 'import',
            status: 'running',
            total: 8,
            processed: 3,
            inserted: 2,
            skipped: 1,
            failed: 0,
            message: '导入中：任务详情取消',
        });

        await page.goto(`${baseUrl}/jobs/${detailJob.id}`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('job-detail-page').waitFor({ state: 'visible' });
        await page.getByTestId('cancel-job-btn').click();

        const detailJobAfterCancel = await pollUntil(
            async () => getJob(ctx.db, detailJob.id)?.status ?? '',
            (status) => status === 'canceled',
            5000,
            'job detail task status to become canceled',
        );

        const statusAfterReload = await pollUntil(
            async () => ((await page.getByTestId('job-status').textContent()) ?? '').trim(),
            (status) => status === '已取消',
            5000,
            'job detail page to reload with canceled status',
        );
        const messageAfterReload = ((await page.getByTestId('job-message').textContent()) ?? '').trim();
        const cancelButtonVisibleAfterReload = await page.getByTestId('cancel-job-btn').isVisible().catch(() => false);

        const failuresJob = seedJob(ctx.db, {
            id: 'browser-failure-pagination',
            type: 'import',
            status: 'failed',
            total: 25,
            processed: 25,
            inserted: 0,
            skipped: 0,
            failed: 25,
            message: '失败明细分页验证',
        });
        for (let index = 1; index <= 25; index += 1) {
            addJobFailure(ctx.db, failuresJob.id, `failure-input-${index}`, `failure-reason-${index}`);
        }

        await page.goto(`${baseUrl}/jobs/${failuresJob.id}`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('job-detail-page').waitFor({ state: 'visible' });

        const initialRowCount = await pollUntil(
            async () => await page.getByTestId('failure-row').count(),
            (count) => count === 20,
            5000,
            'initial failure page row count',
        );
        const initialPage = ((await page.getByTestId('failure-current-page').textContent()) ?? '').trim();
        const initialTotalPages = ((await page.getByTestId('failure-total-pages').textContent()) ?? '').trim();
        const initialFirstInput = ((await page.getByTestId('failure-input').first().textContent()) ?? '').trim();

        await page.getByTestId('failure-next-btn').click();

        const secondPage = await pollUntil(
            async () => ((await page.getByTestId('failure-current-page').textContent()) ?? '').trim(),
            (currentPage) => currentPage === '2',
            5000,
            'failure pager to move to page 2',
        );
        const secondPageRowCount = await pollUntil(
            async () => await page.getByTestId('failure-row').count(),
            (count) => count === 5,
            5000,
            'second failure page row count',
        );
        const secondPageInputs = await readFailureInputs(page);

        await page.getByTestId('failure-page-size').selectOption('50');

        const pageSizeAfterChange = await pollUntil(
            async () => ((await page.getByTestId('failure-page-size').inputValue()) ?? '').trim(),
            (pageSize) => pageSize === '50',
            5000,
            'failure page size to switch to 50',
        );
        const totalPagesAfterChange = await pollUntil(
            async () => ((await page.getByTestId('failure-total-pages').textContent()) ?? '').trim(),
            (totalPages) => totalPages === '1',
            5000,
            'failure total pages to collapse to 1',
        );
        const rowCountAfterChange = await pollUntil(
            async () => await page.getByTestId('failure-row').count(),
            (count) => count === 25,
            5000,
            'failure rows after increasing page size',
        );
        const firstInputAfterChange = ((await page.getByTestId('failure-input').first().textContent()) ?? '').trim();

        assert.equal(currentJobAfterCancel, 'canceled');
        assert.equal(importJobAfterCancel, 'canceled');
        assert.equal(detailJobAfterCancel, 'canceled');
        assert.equal(statusAfterReload, '已取消');
        assert.equal(messageAfterReload, '任务已取消');
        assert.equal(cancelButtonVisibleAfterReload, false);
        assert.equal(initialPage, '1');
        assert.equal(initialTotalPages, '2');
        assert.equal(initialFirstInput, 'failure-input-25');
        assert.equal(secondPage, '2');
        assert.deepEqual(secondPageInputs, [
            'failure-input-5',
            'failure-input-4',
            'failure-input-3',
            'failure-input-2',
            'failure-input-1',
        ]);
        assert.equal(pageSizeAfterChange, '50');
        assert.equal(totalPagesAfterChange, '1');
        assert.equal(firstInputAfterChange, 'failure-input-25');

        const currentJobResult: CurrentJobCancelResult = {
            jobId: currentJob.id,
            bannerProgress,
            finalStatus: currentJobAfterCancel,
            bannerHiddenAfterCancel,
        };

        const importCancelResult: ImportCancelResult = {
            jobId: importJob.id,
            summaryBeforeCancel,
            finalStatus: importJobAfterCancel,
            modalHiddenAfterCancel,
        };

        const detailCancelResult: JobDetailCancelResult = {
            jobId: detailJob.id,
            statusAfterReload,
            messageAfterReload,
            cancelButtonVisibleAfterReload,
        };

        const failurePaginationResult: FailurePaginationResult = {
            jobId: failuresJob.id,
            initialPage,
            initialTotalPages,
            initialRowCount,
            initialFirstInput,
            secondPage,
            secondPageRowCount,
            secondPageInputs,
            pageSizeAfterChange,
            totalPagesAfterChange,
            rowCountAfterChange,
            firstInputAfterChange,
        };

        console.log(JSON.stringify({
            issueId: 'R9-QA-03',
            mode: 'job-cancel-failures-browser-harness',
            baseUrl,
            results: {
                currentJobCancel: currentJobResult,
                importCancel: importCancelResult,
                jobDetailCancel: detailCancelResult,
                failurePagination: failurePaginationResult,
            },
        }, null, 2));
    } finally {
        if (browser) await browser.close().catch(() => { });
        await ctx.cleanup();
    }
}

void main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : String(error));
        process.exit(1);
    });
