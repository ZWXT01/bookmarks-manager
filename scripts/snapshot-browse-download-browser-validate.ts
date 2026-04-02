import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext, type Download, type Page } from 'playwright';

import { createTestApp } from '../tests/helpers/app';
import { seedSnapshot } from '../tests/helpers/factories';

interface FilterValidationResult {
    initialTitles: string[];
    searchFilteredTitles: string[];
    dateFilteredTitles: string[];
    clearedTitles: string[];
}

interface ViewValidationResult {
    openedFilename: string;
    bodyIncludesTargetMarker: boolean;
    bodyIncludesTargetHeading: boolean;
}

interface DownloadValidationResult {
    suggestedFilename: string;
    downloadedContentIncludesTargetMarker: boolean;
    downloadedContentIncludesTargetHeading: boolean;
}

interface DeleteValidationResult {
    deletedSnapshotId: number;
    filteredTitlesAfterDelete: string[];
    emptyStateVisibleAfterDelete: boolean;
    remainingTitlesAfterClear: string[];
    dbCountAfterDelete: number;
    fileRemoved: boolean;
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

async function readVisibleSnapshotTitles(page: Page): Promise<string[]> {
    const titles = await page.getByTestId('snapshot-title').allTextContents().catch(() => []);
    return titles.map((title) => title.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

async function readDownloadContent(download: Download): Promise<{ filename: string; content: string }> {
    const filePath = await download.path();
    assert(filePath, 'download path should exist');
    return {
        filename: download.suggestedFilename(),
        content: fs.readFileSync(filePath, 'utf8'),
    };
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-snapshot-browse-browser-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;
    let browserContext: BrowserContext | null = null;

    try {
        const targetContent = '<!doctype html><html><body><h1>目标快照内容</h1><p>target-marker-42</p></body></html>';
        const targetSnapshot = seedSnapshot(ctx.db, {
            snapshotsDir: ctx.paths.snapshotsDir,
            url: 'https://example.com/snapshot-target',
            title: '筛选目标快照',
            filename: 'snapshot-target.html',
            content: targetContent,
            created_at: '2026-04-02T03:04:05.000Z',
        });

        seedSnapshot(ctx.db, {
            snapshotsDir: ctx.paths.snapshotsDir,
            url: 'https://example.com/snapshot-target-history',
            title: '筛选目标历史快照',
            filename: 'snapshot-target-history.html',
            content: '<!doctype html><html><body><h1>历史快照</h1><p>history-marker</p></body></html>',
            created_at: '2026-04-01T10:11:12.000Z',
        });

        seedSnapshot(ctx.db, {
            snapshotsDir: ctx.paths.snapshotsDir,
            url: 'https://example.com/snapshot-other',
            title: '其它无关快照',
            filename: 'snapshot-other.html',
            content: '<!doctype html><html><body><h1>其它快照</h1><p>other-marker</p></body></html>',
            created_at: '2026-04-02T14:15:16.000Z',
        });

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });
        browserContext = await browser.newContext({
            viewport: { width: 1360, height: 960 },
            acceptDownloads: true,
        });
        const page = await browserContext.newPage();

        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);
        await page.goto(`${baseUrl}/snapshots`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('snapshots-page').waitFor({ state: 'visible' });

        const initialTitles = await pollUntil(
            () => readVisibleSnapshotTitles(page),
            (titles) => titles.length === 3,
            5000,
            'initial snapshot titles',
        );

        await page.getByTestId('snapshot-search-input').fill('筛选目标');
        const searchFilteredTitles = await pollUntil(
            () => readVisibleSnapshotTitles(page),
            (titles) => titles.length === 2 && titles.every((title) => title.includes('筛选目标')),
            5000,
            'search filtered snapshot titles',
        );

        await page.getByTestId('snapshot-date-filter').fill('2026-04-02');
        const dateFilteredTitles = await pollUntil(
            () => readVisibleSnapshotTitles(page),
            (titles) => titles.length === 1 && titles[0] === '筛选目标快照',
            5000,
            'date filtered snapshot titles',
        );

        const targetRow = page.locator('[data-testid="snapshot-row"]').filter({
            has: page.getByTestId('snapshot-title').filter({ hasText: '筛选目标快照' }),
        }).first();

        const viewPagePromise = browserContext.waitForEvent('page');
        await targetRow.getByTestId('snapshot-view-link').click();
        const viewPage = await viewPagePromise;
        await viewPage.waitForLoadState('domcontentloaded');
        const viewHtml = await viewPage.content();
        const viewBodyText = ((await viewPage.locator('body').textContent()) ?? '').trim();
        const viewResult: ViewValidationResult = {
            openedFilename: path.basename(new URL(viewPage.url()).pathname),
            bodyIncludesTargetMarker: viewHtml.includes('target-marker-42'),
            bodyIncludesTargetHeading: viewBodyText.includes('目标快照内容'),
        };
        await viewPage.close();

        const downloadPromise = page.waitForEvent('download');
        await targetRow.getByTestId('snapshot-download-link').click();
        const download = await downloadPromise;
        const downloaded = await readDownloadContent(download);
        const downloadResult: DownloadValidationResult = {
            suggestedFilename: downloaded.filename,
            downloadedContentIncludesTargetMarker: downloaded.content.includes('target-marker-42'),
            downloadedContentIncludesTargetHeading: downloaded.content.includes('目标快照内容'),
        };

        await targetRow.getByTestId('snapshot-delete-button').click();
        await page.getByTestId('snapshot-delete-modal').waitFor({ state: 'visible' });
        await page.getByTestId('snapshot-delete-confirm').click();

        const filteredTitlesAfterDelete = await pollUntil(
            () => readVisibleSnapshotTitles(page),
            (titles) => titles.length === 0,
            5000,
            'filtered snapshot titles after delete',
        );
        const emptyStateVisibleAfterDelete = await page.getByTestId('snapshots-empty-state').isVisible().catch(() => false);
        const dbCountAfterDelete = (ctx.db.prepare('SELECT COUNT(*) AS count FROM snapshots').get() as { count: number }).count;
        const fileRemoved = !fs.existsSync(path.join(ctx.paths.snapshotsDir, targetSnapshot.filename));

        await page.getByTestId('snapshot-clear-filter').click();
        const clearedTitles = await pollUntil(
            () => readVisibleSnapshotTitles(page),
            (titles) => titles.length === 2 && !titles.includes('筛选目标快照'),
            5000,
            'snapshot titles after clearing filter',
        );

        const filterResult: FilterValidationResult = {
            initialTitles,
            searchFilteredTitles,
            dateFilteredTitles,
            clearedTitles,
        };

        const deleteResult: DeleteValidationResult = {
            deletedSnapshotId: targetSnapshot.id,
            filteredTitlesAfterDelete,
            emptyStateVisibleAfterDelete,
            remainingTitlesAfterClear: clearedTitles,
            dbCountAfterDelete,
            fileRemoved,
        };

        assert.equal(viewResult.openedFilename, targetSnapshot.filename);
        assert.equal(viewResult.bodyIncludesTargetMarker, true);
        assert.equal(downloadResult.suggestedFilename, '筛选目标快照.html');
        assert.equal(downloadResult.downloadedContentIncludesTargetMarker, true);
        assert.equal(downloadResult.downloadedContentIncludesTargetHeading, true);
        assert.equal(deleteResult.emptyStateVisibleAfterDelete, true);
        assert.equal(deleteResult.dbCountAfterDelete, 2);
        assert.equal(deleteResult.fileRemoved, true);

        console.log(JSON.stringify({
            issueId: 'R9-QA-02',
            mode: 'snapshot-browse-download-browser-harness',
            baseUrl,
            results: {
                filter: filterResult,
                view: viewResult,
                download: downloadResult,
                delete: deleteResult,
            },
        }, null, 2));
    } finally {
        if (browserContext) await browserContext.close().catch(() => { });
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
