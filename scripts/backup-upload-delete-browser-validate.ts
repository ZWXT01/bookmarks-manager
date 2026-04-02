import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';

import { createTestApp } from '../tests/helpers/app';
import { seedBookmarks, seedCategory } from '../tests/helpers/db';

interface UploadRestoreValidationResult {
    createdBackupName: string;
    uploadSourceName: string;
    preRestoreBackupName: string | null;
    titlesBeforeMutation: string[];
    titlesAfterMutation: string[];
    titlesAfterUploadRestore: string[];
    restoredCategoryLabel: string;
}

interface DeleteValidationResult {
    deletedBackupName: string;
    removedFromUi: boolean;
    removedFromDisk: boolean;
    remainingManualRows: number;
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

async function confirmDialog(page: Page): Promise<void> {
    await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
    await page.getByTestId('app-dialog-confirm').click();
    await pollUntil(
        async () => await page.getByTestId('app-dialog-confirm').count(),
        (count) => count === 0,
        5000,
        'confirm dialog button to disappear',
    );
}

async function closeAlertDialogWithReload(page: Page): Promise<void> {
    await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
    const reloadPromise = page.waitForLoadState('domcontentloaded');
    await page.getByTestId('app-dialog-ok').click();
    await reloadPromise;
}

async function readManualBackupNames(page: Page): Promise<string[]> {
    return page.getByTestId('manual-backup-row').evaluateAll((nodes) => {
        return nodes
            .map((node) => (node instanceof HTMLElement ? node.dataset.backupName ?? '' : ''))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    });
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-backup-upload-delete-browser-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        const initialCategoryId = seedCategory(ctx.db, '上传还原分类');
        seedBookmarks(ctx.db, [
            {
                title: '上传还原前书签 A',
                url: 'https://example.com/upload-restore/a',
                categoryId: initialCategoryId,
            },
            {
                title: '上传还原前书签 B',
                url: 'https://example.com/upload-restore/b',
                categoryId: initialCategoryId,
            },
        ]);

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);

        const titlesBeforeMutation = await pollUntil(
            () => readVisibleBookmarkTitles(page),
            (titles) => titles.length === 2 && titles.includes('上传还原前书签 A') && titles.includes('上传还原前书签 B'),
            5000,
            'initial homepage bookmarks',
        );

        await page.getByTestId('open-backup-modal').click();
        await page.getByTestId('backup-modal').waitFor({ state: 'visible' });
        await page.getByTestId('backup-run-now').click();

        const createdBackupName = await pollUntil(
            async () => {
                const row = page.getByTestId('manual-backup-row').first();
                if (!(await row.isVisible().catch(() => false))) return '';
                return (await row.getAttribute('data-backup-name'))?.trim() ?? '';
            },
            (name) => name.startsWith('manual_') && name.endsWith('.db'),
            5000,
            'manual backup row after run-now',
        );

        const uploadSourcePath = path.join(ctx.paths.backupDir, createdBackupName);
        assert(fs.existsSync(uploadSourcePath), `backup file missing: ${createdBackupName}`);

        ctx.db.exec('DELETE FROM bookmarks');
        ctx.db.exec('DELETE FROM categories');
        const corruptedCategoryId = seedCategory(ctx.db, '损坏分类');
        seedBookmarks(ctx.db, [
            {
                title: '损坏后的临时书签',
                url: 'https://example.com/upload-restore/corrupted',
                categoryId: corruptedCategoryId,
            },
        ]);

        await page.reload({ waitUntil: 'domcontentloaded' });
        const titlesAfterMutation = await pollUntil(
            () => readVisibleBookmarkTitles(page),
            (titles) => titles.length === 1 && titles[0] === '损坏后的临时书签',
            5000,
            'mutated homepage bookmarks',
        );

        await page.getByTestId('open-backup-modal').click();
        await page.getByTestId('backup-modal').waitFor({ state: 'visible' });
        await page.getByTestId('backup-upload-input').setInputFiles(uploadSourcePath);
        await page.getByTestId('backup-upload-submit').click();
        await confirmDialog(page);
        await closeAlertDialogWithReload(page);

        const titlesAfterUploadRestore = await pollUntil(
            () => readVisibleBookmarkTitles(page),
            (titles) => titles.length === 2 && titles.includes('上传还原前书签 A') && titles.includes('上传还原前书签 B'),
            5000,
            'restored homepage bookmarks after upload restore',
        );

        const restoredCategoryLabel = await pollUntil(
            () => readBookmarkCategoryLabel(page, '上传还原前书签 A'),
            (label) => label === '上传还原分类',
            5000,
            'restored bookmark category label',
        );

        const preRestoreBackupName = fs.readdirSync(ctx.paths.backupDir)
            .find((name) => name.startsWith('pre_restore_') && name.endsWith('.db')) ?? null;
        assert(preRestoreBackupName, 'pre_restore backup file was not created after upload restore');

        await page.getByTestId('open-backup-modal').click();
        await page.getByTestId('backup-modal').waitFor({ state: 'visible' });
        const backupRow = page.locator(`[data-testid="manual-backup-row"][data-backup-name="${createdBackupName}"]`).first();
        await backupRow.getByTestId('backup-delete-button').click();
        await confirmDialog(page);

        const remainingManualBackupNames = await pollUntil(
            () => readManualBackupNames(page),
            (names) => !names.includes(createdBackupName),
            5000,
            'manual backup row removal after delete',
        );

        const uploadRestoreResult: UploadRestoreValidationResult = {
            createdBackupName,
            uploadSourceName: path.basename(uploadSourcePath),
            preRestoreBackupName,
            titlesBeforeMutation,
            titlesAfterMutation,
            titlesAfterUploadRestore,
            restoredCategoryLabel,
        };

        const deleteResult: DeleteValidationResult = {
            deletedBackupName: createdBackupName,
            removedFromUi: !remainingManualBackupNames.includes(createdBackupName),
            removedFromDisk: !fs.existsSync(uploadSourcePath),
            remainingManualRows: remainingManualBackupNames.length,
        };

        assert.equal(deleteResult.removedFromUi, true);
        assert.equal(deleteResult.removedFromDisk, true);
        assert.equal(deleteResult.remainingManualRows, 0);

        console.log(JSON.stringify({
            issueId: 'R9-QA-01',
            mode: 'backup-upload-delete-browser-harness',
            baseUrl,
            results: {
                uploadRestore: uploadRestoreResult,
                delete: deleteResult,
            },
        }, null, 2));
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            await ctx.cleanup();
        }
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
