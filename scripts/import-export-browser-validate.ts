import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type Download, type Page } from 'playwright';

import { createTestApp } from '../tests/helpers/app';
import { seedBookmarks, seedCategory } from '../tests/helpers/db';

interface ImportValidationResult {
    importedTitles: string[];
    importedCategoryLabel: string;
    progressSummary: string;
    progressValue: string;
}

interface ExportValidationResult {
    allHtmlFilename: string;
    allHtmlContainsImportedTitles: boolean;
    allHtmlContainsFolderName: boolean;
    uncategorizedJsonFilename: string;
    uncategorizedJsonTitles: string[];
    uncategorizedJsonCount: number;
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

async function readVisibleBookmarkTitles(page: Page): Promise<string[]> {
    const titles = await page.getByTestId('bookmark-row-title').allTextContents();
    return titles.map((title) => title.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

async function readBookmarkCategoryLabel(page: Page, title: string): Promise<string> {
    const row = page.locator('[data-testid="bookmark-row"]').filter({
        has: page.getByTestId('bookmark-row-title').filter({ hasText: title }),
    }).first();
    return ((await row.getByTestId('bookmark-category-label').textContent()) ?? '').trim();
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
        tempPrefix: 'bookmarks-import-export-browser-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;
    let browserContext: Awaited<ReturnType<Browser['newContext']>> | null = null;

    try {
        const importCategoryId = seedCategory(ctx.db, '统一导入');
        const exportCategoryId = seedCategory(ctx.db, '已分类导出');

        seedBookmarks(ctx.db, [
            {
                title: '已分类导出书签',
                url: 'https://example.com/export/categorized',
                categoryId: exportCategoryId,
            },
            {
                title: '待导出未分类',
                url: 'https://example.com/export/uncategorized',
                categoryId: null,
            },
        ]);

        const importFilePath = path.join(ctx.paths.rootDir, 'import-browser-fixture.json');
        fs.writeFileSync(importFilePath, JSON.stringify([
            {
                url: 'https://example.com/import/one',
                title: '导入书签一',
                category: '源分类/忽略',
            },
            {
                url: 'https://example.com/import/two',
                title: '导入书签二',
                category: '源分类/忽略',
            },
        ], null, 2));

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });
        browserContext = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            acceptDownloads: true,
        });
        const page = await browserContext.newPage();

        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);

        const initialTitles = await pollUntil(
            () => readVisibleBookmarkTitles(page),
            (titles) => titles.includes('已分类导出书签') && titles.includes('待导出未分类'),
            5000,
            'initial homepage bookmarks',
        );
        assert(initialTitles.includes('已分类导出书签'));
        assert(initialTitles.includes('待导出未分类'));

        await page.getByTestId('import-file-input').setInputFiles(importFilePath);
        await page.getByTestId('import-override-category').check();
        await page.getByTestId('import-default-category').selectOption(String(importCategoryId));
        await page.getByTestId('import-submit').click();

        await page.getByTestId('import-progress-modal').waitFor({ state: 'visible' });
        const progressSummary = await pollUntil(
            async () => ((await page.getByTestId('import-progress-summary').textContent()) ?? '').trim(),
            (summary) => summary === '2/2 (成功:2 失败:0)',
            10000,
            'import progress summary',
        );
        const progressValue = ((await page.getByTestId('import-progress-value').textContent()) ?? '').trim();
        assert.equal(progressValue, '100%');

        await pollUntil(
            async () => !(await page.getByTestId('import-progress-modal').isVisible().catch(() => false)),
            (hidden) => hidden === true,
            10000,
            'import progress modal to close',
        );

        const importedTitles = await pollUntil(
            () => readVisibleBookmarkTitles(page),
            (titles) => titles.includes('导入书签一') && titles.includes('导入书签二'),
            10000,
            'imported bookmarks to appear on homepage',
        );
        const importedCategoryLabel = await pollUntil(
            () => readBookmarkCategoryLabel(page, '导入书签一'),
            (label) => label === '统一导入',
            5000,
            'imported bookmark category label',
        );

        await page.getByTestId('open-export-modal').click();
        await page.getByTestId('export-modal').waitFor({ state: 'visible' });
        const allHtmlDownloadPromise = page.waitForEvent('download');
        await page.getByTestId('export-download').click();
        const allHtmlDownload = await allHtmlDownloadPromise;
        const allHtml = await readDownloadContent(allHtmlDownload);
        assert.equal(allHtml.filename, 'bookmarks.html');

        await page.getByTestId('open-export-modal').click();
        await page.getByTestId('export-modal').waitFor({ state: 'visible' });
        await page.getByTestId('export-scope-select').selectOption('uncategorized');
        await page.getByTestId('export-format-select').selectOption('json');
        const uncategorizedJsonDownloadPromise = page.waitForEvent('download');
        await page.getByTestId('export-download').click();
        const uncategorizedJsonDownload = await uncategorizedJsonDownloadPromise;
        const uncategorizedJson = await readDownloadContent(uncategorizedJsonDownload);
        assert.equal(uncategorizedJson.filename, 'bookmarks.json');
        const uncategorizedRows = JSON.parse(uncategorizedJson.content) as Array<{ title: string; category_name: string | null }>;

        const importResult: ImportValidationResult = {
            importedTitles: importedTitles.filter((title) => title.startsWith('导入书签')).sort((a, b) => a.localeCompare(b, 'zh-CN')),
            importedCategoryLabel,
            progressSummary,
            progressValue,
        };

        const exportResult: ExportValidationResult = {
            allHtmlFilename: allHtml.filename,
            allHtmlContainsImportedTitles: allHtml.content.includes('导入书签一') && allHtml.content.includes('导入书签二'),
            allHtmlContainsFolderName: allHtml.content.includes('统一导入') && allHtml.content.includes('已分类导出'),
            uncategorizedJsonFilename: uncategorizedJson.filename,
            uncategorizedJsonTitles: uncategorizedRows.map((row) => row.title).sort((a, b) => a.localeCompare(b, 'zh-CN')),
            uncategorizedJsonCount: uncategorizedRows.length,
        };

        assert.equal(exportResult.uncategorizedJsonCount, 1);
        assert.deepEqual(exportResult.uncategorizedJsonTitles, ['待导出未分类']);
        assert(exportResult.allHtmlContainsImportedTitles, 'all export html should contain imported bookmark titles');
        assert(exportResult.allHtmlContainsFolderName, 'all export html should contain category folder names');

        console.log(JSON.stringify({
            issueId: 'R8-QA-03',
            mode: 'import-export-browser-harness',
            baseUrl,
            results: {
                import: importResult,
                export: exportResult,
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
