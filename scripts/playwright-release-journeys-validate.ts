import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { getCategoryByPath } from '../src/category-service';
import { applyTemplate, createTemplate, type CategoryNode } from '../src/template-service';
import { createTestApp } from '../tests/helpers/app';
import { seedAISettings } from '../tests/helpers/ai';
import { seedBookmarks, seedJob, seedSnapshot } from '../tests/helpers/factories';

const PRIMARY_TEMPLATE_TREE: CategoryNode[] = [
    {
        name: '技术开发',
        children: [{ name: '前端' }, { name: '后端' }],
    },
    {
        name: '学习资源',
        children: [{ name: '文档' }, { name: '课程' }],
    },
    {
        name: '工具软件',
        children: [{ name: '效率' }, { name: 'AI' }],
    },
];

const ALTERNATE_TEMPLATE_TREE: CategoryNode[] = [
    {
        name: '工作台',
        children: [{ name: '任务' }, { name: '归档' }],
    },
    {
        name: '知识库',
        children: [{ name: '文档' }, { name: '参考' }],
    },
];

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

    while (Date.now() - startedAt < timeoutMs) {
        const value = await read();
        if (predicate(value)) return value;
        await sleep(100);
    }

    throw new Error(`Timed out waiting for ${description}`);
}

async function login(page: Page, baseUrl: string, username: string, password: string): Promise<void> {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    assert.match(await page.title(), /登录/);
    await page.getByRole('textbox', { name: '请输入用户名' }).fill(username);
    await page.getByRole('textbox', { name: '请输入密码' }).fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(`${baseUrl}/`);
}

async function readVisibleBookmarkTitles(page: Page): Promise<string[]> {
    const titles = await page.getByTestId('bookmark-row-title').allTextContents();
    return titles.map((title) => title.trim()).filter(Boolean);
}

async function readCustomTemplateNames(page: Page): Promise<string[]> {
    return page.getByTestId('template-card-name').allTextContents();
}

async function openTemplateSelect(page: Page): Promise<void> {
    if (await page.getByTestId('template-select-modal').isVisible().catch(() => false)) {
        return;
    }
    await page.getByTestId('open-template-select').click();
    await page.getByTestId('template-select-modal').waitFor({ state: 'visible' });
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-playwright-release-journeys-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        seedAISettings(ctx.db, {
            baseUrl: 'https://mock-ai.example.test/v1',
            apiKey: 'mock-ai-key',
            model: 'mock-model',
            batchSize: 20,
        });

        const primaryTemplate = createTemplate(ctx.db, 'MCP Smoke 模板', PRIMARY_TEMPLATE_TREE);
        createTemplate(ctx.db, 'MCP 备用模板', ALTERNATE_TEMPLATE_TREE);
        applyTemplate(ctx.db, primaryTemplate.id);

        const frontendCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        const docsCategory = getCategoryByPath(ctx.db, '学习资源/文档');

        assert(frontendCategory, 'frontend category missing');
        assert(docsCategory, 'docs category missing');

        seedBookmarks(ctx.db, [
            { title: '本地登录页', url: 'http://127.0.0.1/login', categoryId: frontendCategory.id },
            { title: '本地任务页', url: 'http://127.0.0.1/jobs', categoryId: docsCategory.id },
            { title: '本地设置页', url: 'http://127.0.0.1/settings', categoryId: null },
        ]);

        seedSnapshot(ctx.db, {
            snapshotsDir: ctx.paths.snapshotsDir,
            url: 'http://127.0.0.1/login',
            title: '登录页快照',
            content: '<!doctype html><html><body><h1>Login Snapshot</h1></body></html>',
        });

        seedJob(ctx.db, {
            type: 'import',
            status: 'done',
            total: 1,
            processed: 1,
            inserted: 1,
            message: '历史导入已完成',
        });

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);

        const activeTemplateName = await pollUntil(
            async () => (await page.getByTestId('active-template-name').textContent())?.trim() ?? '',
            (value) => value === 'MCP Smoke 模板',
            5000,
            'active template name',
        );
        const bookmarkTitles = await pollUntil(
            () => readVisibleBookmarkTitles(page),
            (titles) => titles.includes('本地登录页') && titles.includes('本地任务页') && titles.includes('本地设置页'),
            5000,
            'homepage bookmarks',
        );

        await page.getByTestId('open-ai-organize').click();
        await page.getByTestId('ai-organize-modal').waitFor({ state: 'visible' });
        await page.getByTestId('organize-phase-idle').waitFor({ state: 'visible' });
        await page.getByTestId('ai-organize-close').click();
        await page.getByTestId('ai-organize-modal').waitFor({ state: 'hidden' });

        await openTemplateSelect(page);
        const templateNames = await pollUntil(
            () => readCustomTemplateNames(page),
            (names) => names.includes('MCP Smoke 模板') && names.includes('MCP 备用模板'),
            5000,
            'template select names',
        );
        await page.getByTestId('template-select-close').click();
        await page.getByTestId('template-select-modal').waitFor({ state: 'hidden' });

        await page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
        assert.match(await page.title(), /设置/);
        await page.getByTestId('ai-test-btn').waitFor({ state: 'visible' });

        await page.goto(`${baseUrl}/jobs`, { waitUntil: 'domcontentloaded' });
        assert.match(await page.title(), /任务列表/);
        await page.getByText('历史导入已完成').waitFor({ state: 'visible' });

        await page.goto(`${baseUrl}/snapshots`, { waitUntil: 'domcontentloaded' });
        assert.match(await page.title(), /快照/);
        await page.getByText('登录页快照').waitFor({ state: 'visible' });

        console.log(JSON.stringify({
            issueIds: ['R1-QA-01', 'R2-E2E-01', 'R2-REL-03'],
            mode: 'playwright-release-journeys',
            baseUrl,
            results: {
                activeTemplateName,
                bookmarkTitles,
                templateNames,
                pages: {
                    loginTitle: '登录 - 书签管理器',
                    settingsVisible: true,
                    jobsVisible: true,
                    snapshotsVisible: true,
                    aiOrganizeIdleVisible: true,
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
