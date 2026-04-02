import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';

import { getJob } from '../src/jobs';
import { createTestApp } from '../tests/helpers/app';
import { seedJob, seedSnapshot } from '../tests/helpers/factories';

interface JobsValidationResult {
    beforeRows: string[];
    afterClearCompletedRows: string[];
    afterClearAllRows: string[];
    runningJobPreserved: boolean;
    clearedCompletedRemoved: boolean;
    emptyStateVisible: boolean;
}

interface SnapshotsValidationResult {
    initialTitles: string[];
    deletedIds: string[];
    remainingRows: number;
    emptyStateVisible: boolean;
    filesRemoved: boolean;
    dbCountAfterDelete: number;
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

async function confirmAppDialog(page: Page): Promise<void> {
    await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
    await page.getByTestId('app-dialog-confirm').click();
    await pollUntil(
        async () => await page.getByTestId('app-dialog-confirm').count(),
        (count) => count === 0,
        5000,
        'app dialog confirm button to disappear',
    );
}

async function closeAlertDialogWithReload(page: Page): Promise<void> {
    await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
    const reloadPromise = page.waitForLoadState('domcontentloaded');
    await page.getByTestId('app-dialog-ok').click();
    await reloadPromise;
}

async function readJobRowIds(page: Page): Promise<string[]> {
    return page.getByTestId('jobs-row').evaluateAll((nodes) => {
        return nodes
            .map((node) => (node instanceof HTMLElement ? node.dataset.jobId ?? '' : ''))
            .filter(Boolean);
    });
}

async function readSnapshotTitles(page: Page): Promise<string[]> {
    const titles = await page.getByTestId('snapshot-title').allTextContents();
    return titles.map((title) => title.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-jobs-snapshots-browser-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        const runningJob = seedJob(ctx.db, {
            id: 'browser-running-job',
            type: 'check',
            status: 'running',
            total: 5,
            processed: 1,
            inserted: 0,
            skipped: 0,
            failed: 0,
            message: 'running job',
        });
        const doneJob = seedJob(ctx.db, {
            id: 'browser-done-job',
            type: 'import',
            status: 'done',
            total: 1,
            processed: 1,
            inserted: 1,
            skipped: 0,
            failed: 0,
            message: 'done job',
        });
        const failedJob = seedJob(ctx.db, {
            id: 'browser-failed-job',
            type: 'check',
            status: 'failed',
            total: 2,
            processed: 2,
            inserted: 0,
            skipped: 0,
            failed: 2,
            message: 'failed job',
        });

        const snapshotRows = [
            seedSnapshot(ctx.db, {
                snapshotsDir: ctx.paths.snapshotsDir,
                url: 'https://example.com/snap-a',
                title: '快照 A',
                filename: 'snapshot-a.html',
                content: '<!doctype html><html><body>snapshot A</body></html>',
            }),
            seedSnapshot(ctx.db, {
                snapshotsDir: ctx.paths.snapshotsDir,
                url: 'https://example.com/snap-b',
                title: '快照 B',
                filename: 'snapshot-b.html',
                content: '<!doctype html><html><body>snapshot B</body></html>',
            }),
            seedSnapshot(ctx.db, {
                snapshotsDir: ctx.paths.snapshotsDir,
                url: 'https://example.com/snap-c',
                title: '快照 C',
                filename: 'snapshot-c.html',
                content: '<!doctype html><html><body>snapshot C</body></html>',
            }),
        ];

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);

        await page.goto(`${baseUrl}/jobs`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('jobs-page').waitFor({ state: 'visible' });

        const beforeRows = await pollUntil(
            () => readJobRowIds(page),
            (ids) => ids.includes(runningJob.id) && ids.includes(doneJob.id) && ids.includes(failedJob.id),
            5000,
            'initial jobs rows',
        );

        await page.getByTestId('jobs-clear-completed').click();
        await confirmAppDialog(page);
        await closeAlertDialogWithReload(page);

        const afterClearCompletedRows = await pollUntil(
            () => readJobRowIds(page),
            (ids) => ids.length === 1 && ids[0] === runningJob.id,
            5000,
            'jobs rows after clear completed',
        );

        const runningJobAfterClearCompleted = getJob(ctx.db, runningJob.id);
        assert.equal(runningJobAfterClearCompleted?.status, 'running');
        assert.equal(getJob(ctx.db, doneJob.id), null);
        assert.equal(getJob(ctx.db, failedJob.id), null);

        await page.getByTestId('jobs-clear-all').click();
        await confirmAppDialog(page);
        await closeAlertDialogWithReload(page);

        const emptyStateVisible = await pollUntil(
            async () => await page.getByTestId('jobs-empty-state').isVisible().catch(() => false),
            (visible) => visible === true,
            5000,
            'jobs empty state',
        );

        const afterClearAllRows = await readJobRowIds(page);
        assert.equal((ctx.db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count, 0);

        await page.goto(`${baseUrl}/snapshots`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('snapshots-page').waitFor({ state: 'visible' });

        const initialTitles = await pollUntil(
            () => readSnapshotTitles(page),
            (titles) => titles.length === 3,
            5000,
            'initial snapshot titles',
        );

        await page.getByTestId('snapshots-select-all').check();
        await page.getByTestId('snapshots-batch-delete').click();
        await page.getByTestId('snapshot-batch-delete-modal').waitFor({ state: 'visible' });
        await page.getByTestId('snapshot-batch-delete-confirm').click();

        const snapshotsEmptyStateVisible = await pollUntil(
            async () => await page.getByTestId('snapshots-empty-state').isVisible().catch(() => false),
            (visible) => visible === true,
            5000,
            'snapshots empty state after batch delete',
        );

        const remainingRows = await page.getByTestId('snapshot-row').count().catch(() => 0);
        const dbCountAfterDelete = (ctx.db.prepare('SELECT COUNT(*) AS count FROM snapshots').get() as { count: number }).count;
        const filesRemoved = snapshotRows.every((row) => !fs.existsSync(path.join(ctx.paths.snapshotsDir, row.filename)));

        const jobsResult: JobsValidationResult = {
            beforeRows,
            afterClearCompletedRows,
            afterClearAllRows,
            runningJobPreserved: runningJobAfterClearCompleted?.id === runningJob.id,
            clearedCompletedRemoved: getJob(ctx.db, doneJob.id) === null && getJob(ctx.db, failedJob.id) === null,
            emptyStateVisible,
        };

        const snapshotsResult: SnapshotsValidationResult = {
            initialTitles,
            deletedIds: snapshotRows.map((row) => String(row.id)),
            remainingRows,
            emptyStateVisible: snapshotsEmptyStateVisible,
            filesRemoved,
            dbCountAfterDelete,
        };

        console.log(JSON.stringify({
            issueId: 'R8-QA-02',
            mode: 'jobs-snapshots-browser-harness',
            baseUrl,
            results: {
                jobs: jobsResult,
                snapshots: snapshotsResult,
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
