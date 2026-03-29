import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { createTestApp } from '../tests/helpers/app';

interface ResultSnapshot {
    title: string;
    badge: string;
    message: string;
    detailLines: string[];
}

interface ValidationResult {
    successState: ResultSnapshot;
    diagnosticState: ResultSnapshot;
}

async function login(page: Page, baseUrl: string, username: string, password: string): Promise<void> {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: '请输入用户名' }).fill(username);
    await page.getByRole('textbox', { name: '请输入密码' }).fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(`${baseUrl}/`);
}

async function readAiTestResult(page: Page): Promise<ResultSnapshot> {
    const panel = page.getByTestId('ai-test-result');
    await panel.waitFor({ state: 'visible' });

    const detailLines = await page.getByTestId('ai-test-result-item').evaluateAll((nodes) => {
        return nodes.map((node) => node.textContent?.trim() ?? '').filter(Boolean);
    }).catch(() => []);

    return {
        title: (await page.getByTestId('ai-test-result-title').textContent())?.trim() ?? '',
        badge: (await page.getByTestId('ai-test-result-badge').textContent())?.trim() ?? '',
        message: (await page.getByTestId('ai-test-result-message').textContent())?.trim() ?? '',
        detailLines,
    };
}

async function fillAiInputs(page: Page): Promise<void> {
    await page.getByTestId('ai-base-url-input').fill('https://mock-ai.example.test/v1');
    await page.getByTestId('ai-api-key-input').fill('test-key');
    await page.getByTestId('ai-model-input').fill('mock-model');
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-settings-ai-diagnostic-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);
        await page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
        await fillAiInputs(page);

        const queuedResponses = [
            {
                status: 200,
                body: { success: true, message: 'AI 配置测试成功' },
            },
            {
                status: 500,
                body: {
                    error: 'AI 配置基础连通正常，但聊天补全接口超时',
                    diagnostic: {
                        models_ok: true,
                        model_found: true,
                        models_status: 200,
                    },
                },
            },
        ];

        await page.route(`${baseUrl}/api/ai/test`, async (route) => {
            const next = queuedResponses.shift();
            assert(next, 'unexpected extra /api/ai/test request');
            await route.fulfill({
                status: next.status,
                contentType: 'application/json; charset=utf-8',
                body: JSON.stringify(next.body),
            });
        });

        await page.getByTestId('ai-test-btn').click();
        const successState = await readAiTestResult(page);
        assert.equal(successState.title, 'AI 连接测试成功');
        assert.equal(successState.badge, '通过');
        assert.equal(successState.message, 'AI 配置测试成功');
        assert.equal(successState.detailLines.length, 0);

        await page.getByTestId('ai-test-btn').click();
        const diagnosticState = await readAiTestResult(page);
        assert.equal(diagnosticState.title, '基础连通正常，聊天补全未通过');
        assert.equal(diagnosticState.badge, '需处理');
        assert.equal(diagnosticState.message, 'AI 配置基础连通正常，但聊天补全接口超时');
        assert.deepEqual(diagnosticState.detailLines, [
            '模型列表探测：正常',
            '当前模型：已发现',
            '模型列表状态码：200',
        ]);

        const results: ValidationResult = {
            successState,
            diagnosticState,
        };

        console.log(JSON.stringify({
            issueId: 'R5-AI-08',
            mode: 'settings-ai-diagnostic-ui',
            baseUrl,
            results,
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
