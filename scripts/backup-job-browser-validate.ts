import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';

import { updateJob } from '../src/jobs';
import { createTestApp } from '../tests/helpers/app';
import { seedBookmarks, seedJob } from '../tests/helpers/factories';

interface BackupValidationResult {
    createdBackupName: string;
    preRestoreBackupName: string | null;
    titlesBeforeMutation: string[];
    titlesAfterMutation: string[];
    titlesAfterRestore: string[];
}

interface JobDetailValidationResult {
    intermediate: {
        status: string;
        progress: string;
        message: string;
        currentItem: string;
    };
    final: {
        status: string;
        progress: string;
        inserted: string;
        skipped: string;
        failed: string;
        message: string;
    };
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

async function closeAlertDialog(page: Page): Promise<void> {
    await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
    await page.getByTestId('app-dialog-ok').click();
}

async function readJobSnapshot(page: Page) {
    return {
        status: (await page.getByTestId('job-status').textContent())?.trim() ?? '',
        progress: `${(await page.getByTestId('job-progress').textContent())?.trim() ?? ''}/${(await page.getByTestId('job-total').textContent())?.trim() ?? ''}`,
        inserted: (await page.getByTestId('job-inserted').textContent())?.trim() ?? '',
        skipped: (await page.getByTestId('job-skipped').textContent())?.trim() ?? '',
        failed: (await page.getByTestId('job-failed').textContent())?.trim() ?? '',
        message: (await page.getByTestId('job-message').textContent())?.trim() ?? '',
        currentItem: (await page.getByTestId('job-current-item').textContent())?.trim() ?? '',
    };
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-backup-job-browser-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        seedBookmarks(ctx.db, [
            { title: '备份前书签 A', url: 'https://example.com/backup-a' },
            { title: '备份前书签 B', url: 'https://example.com/backup-b' },
        ]);

        const runningJob = seedJob(ctx.db, {
            type: 'check',
            status: 'running',
            total: 4,
            processed: 1,
            inserted: 0,
            skipped: 0,
            failed: 0,
            message: '检查中：首条书签',
        });

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);

        const titlesBeforeMutation = await pollUntil(
            () => readVisibleBookmarkTitles(page),
            (titles) => titles.length === 2 && titles.includes('备份前书签 A') && titles.includes('备份前书签 B'),
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
            'manual backup row',
        );

        assert(fs.existsSync(path.join(ctx.paths.backupDir, createdBackupName)), `backup file missing: ${createdBackupName}`);

        ctx.db.exec('DELETE FROM bookmarks');
        seedBookmarks(ctx.db, [
            { title: '损坏后的临时书签', url: 'https://example.com/corrupted' },
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
        const backupRow = page.locator(`[data-testid="manual-backup-row"][data-backup-name="${createdBackupName}"]`).first();
        await backupRow.getByTestId('backup-restore-button').click();
        await confirmDialog(page);

        await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
        const reloadPromise = page.waitForLoadState('domcontentloaded');
        await closeAlertDialog(page);
        await reloadPromise;

        const titlesAfterRestore = await pollUntil(
            () => readVisibleBookmarkTitles(page),
            (titles) => titles.length === 2 && titles.includes('备份前书签 A') && titles.includes('备份前书签 B'),
            5000,
            'restored homepage bookmarks',
        );

        const preRestoreBackupName = fs.readdirSync(ctx.paths.backupDir).find((name) => name.startsWith('pre_restore_') && name.endsWith('.db')) ?? null;
        assert(preRestoreBackupName, 'pre_restore backup file was not created');

        await page.goto(`${baseUrl}/jobs/${runningJob.id}`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('job-detail-page').waitFor({ state: 'visible' });

        const updater = (async () => {
            await sleep(800);
            updateJob(ctx.db, runningJob.id, {
                processed: 2,
                inserted: 1,
                message: '检查中：第二条书签',
            });

            await sleep(800);
            updateJob(ctx.db, runningJob.id, {
                status: 'done',
                processed: 4,
                inserted: 3,
                skipped: 1,
                failed: 0,
                message: '检查完成：4/4',
            });
        })();

        const intermediateSnapshot = await pollUntil(
            () => readJobSnapshot(page),
            (snapshot) => snapshot.progress === '2/4' && snapshot.message === '检查中：第二条书签',
            5000,
            'job detail intermediate progress',
        );

        assert.equal(intermediateSnapshot.status, '运行中');
        assert.equal(intermediateSnapshot.currentItem, '检查中：第二条书签');

        const finalSnapshot = await pollUntil(
            () => readJobSnapshot(page),
            (snapshot) => snapshot.status === '已完成' && snapshot.progress === '4/4' && snapshot.message === '检查完成：4/4',
            7000,
            'job detail final progress',
        );

        await updater;

        const backupResult: BackupValidationResult = {
            createdBackupName,
            preRestoreBackupName,
            titlesBeforeMutation,
            titlesAfterMutation,
            titlesAfterRestore,
        };

        const jobResult: JobDetailValidationResult = {
            intermediate: {
                status: intermediateSnapshot.status,
                progress: intermediateSnapshot.progress,
                message: intermediateSnapshot.message,
                currentItem: intermediateSnapshot.currentItem,
            },
            final: {
                status: finalSnapshot.status,
                progress: finalSnapshot.progress,
                inserted: finalSnapshot.inserted,
                skipped: finalSnapshot.skipped,
                failed: finalSnapshot.failed,
                message: finalSnapshot.message,
            },
        };

        console.log(JSON.stringify({
            issueId: 'R8-QA-01',
            mode: 'backup-job-browser-harness',
            baseUrl,
            results: {
                backup: backupResult,
                jobDetail: jobResult,
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
