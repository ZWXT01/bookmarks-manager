import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { createQueuedAIHarness, seedAISettings, textCompletion } from '../tests/helpers/ai';
import { createTestApp } from '../tests/helpers/app';

const PRODUCT_PRESET_NAME = '产品运营版';
const CONTENT_PRESET_NAME = '内容创作版';

const PRODUCT_EXPECTED_TOP_LEVEL = ['市场洞察', '内容运营', '产品设计', '商业化', '项目协作'];
const CONTENT_EXPECTED_TOP_LEVEL = ['选题灵感', '写作与脚本', '视觉制作', '发布运营', '品牌资产'];
const PRESET_NAMES = [
    '综合通用版',
    '开发者版',
    '生活娱乐版',
    '极简版',
    PRODUCT_PRESET_NAME,
    CONTENT_PRESET_NAME,
    '研究学习版',
    '收藏归档版',
];

interface FlowResult {
    sourcePreset: string;
    createdTemplateName: string | null;
    activeTemplateName: string | null;
    navOrder: string[];
    managerOrder: string[];
    classifyResult: string;
    promptIncludes: string[];
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

async function openTemplateSelect(page: Page): Promise<void> {
    if (await page.getByTestId('template-select-modal').isVisible().catch(() => false)) {
        return;
    }
    await page.getByTestId('open-template-select').click();
    await page.getByTestId('template-select-modal').waitFor({ state: 'visible' });
}

async function confirmDialog(page: Page): Promise<void> {
    await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
    await page.getByTestId('app-dialog-confirm').click();
    await page.getByTestId('app-dialog').waitFor({ state: 'hidden' });
}

async function readPresetTemplateNames(page: Page): Promise<string[]> {
    return page.getByTestId('preset-template-card-name').allTextContents();
}

async function readCustomTemplateNames(page: Page): Promise<string[]> {
    return page.getByTestId('template-card-name').allTextContents();
}

async function readNavOrder(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-testid="category-nav-tab"]'))
            .map((node) => {
                if (!(node instanceof HTMLElement)) return '';
                const spans = Array.from(node.querySelectorAll('span'));
                return spans[1]?.textContent?.trim() ?? node.textContent?.trim() ?? '';
            })
            .filter(Boolean);
    });
}

async function readManagerOrder(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-testid="category-drag-card"] h3'))
            .map((node) => node.textContent?.trim() ?? '')
            .filter(Boolean);
    });
}

async function readActiveTemplateName(page: Page): Promise<string | null> {
    const text = await page.locator('[data-testid="active-template-name"]').textContent().catch(() => null);
    const trimmed = text?.trim() ?? '';
    return trimmed || null;
}

async function openCategoryManager(page: Page, expectedCount: number): Promise<void> {
    await page.getByTestId('open-category-manager').click();
    await page.getByTestId('category-manager-modal').waitFor({ state: 'visible' });
    await pollUntil(
        () => readManagerOrder(page),
        (order) => order.length === expectedCount,
        5000,
        'category manager order',
    );
}

async function closeCategoryManager(page: Page): Promise<void> {
    await page.getByTestId('close-category-manager').click();
    await page.getByTestId('category-manager-modal').waitFor({ state: 'hidden' });
}

async function createPresetCopy(page: Page, presetName: string): Promise<string> {
    await openTemplateSelect(page);
    await page.getByTestId('template-tab-preset').click();

    const presetCard = page.getByTestId('preset-template-card').filter({ hasText: presetName }).first();
    await presetCard.waitFor({ state: 'visible' });
    await presetCard.getByTestId('copy-preset-template-button').click();

    await page.getByTestId('template-tab-custom').click();
    const createdName = await pollUntil(
        async () => {
            const names = await readCustomTemplateNames(page);
            return names.find((name) => name.startsWith(`${presetName}（自定义）`)) || null;
        },
        (name) => Boolean(name),
        5000,
        `${presetName} custom copy to appear`,
    );

    assert(createdName, `failed to create custom copy for ${presetName}`);
    return createdName;
}

async function applyCustomTemplate(page: Page, templateName: string): Promise<void> {
    await openTemplateSelect(page);
    await page.getByTestId('template-tab-custom').click();
    const customCard = page.getByTestId('custom-template-card').filter({ hasText: templateName }).first();
    await customCard.waitFor({ state: 'visible' });
    await customCard.getByTestId('apply-template-button').click();
    await confirmDialog(page);
    await page.getByTestId('template-select-modal').waitFor({ state: 'hidden' });
}

async function createAndApplyPreset(page: Page, presetName: string): Promise<string> {
    await openTemplateSelect(page);
    await page.getByTestId('template-tab-preset').click();

    const beforeNames = await readCustomTemplateNames(page).catch(() => []);
    const presetCard = page.getByTestId('preset-template-card').filter({ hasText: presetName }).first();
    await presetCard.waitFor({ state: 'visible' });
    await presetCard.getByTestId('use-preset-template-button').click();

    await page.getByTestId('template-select-modal').waitFor({ state: 'hidden' });

    const createdName = await pollUntil(
        async () => {
            await openTemplateSelect(page);
            await page.getByTestId('template-tab-custom').click();
            const names = await readCustomTemplateNames(page);
            const created = names.find((name) => name.startsWith(`${presetName}（自定义）`) && !beforeNames.includes(name)) || null;
            await page.getByTestId('template-select-close').click();
            await page.getByTestId('template-select-modal').waitFor({ state: 'hidden' });
            return created;
        },
        (name) => Boolean(name),
        5000,
        `${presetName} direct-create custom copy to appear`,
    );

    assert(createdName, `failed to create/apply preset ${presetName}`);
    return createdName;
}

async function assertTemplateApplied(page: Page, expectedNamePrefix: string, expectedNavOrder: string[]): Promise<{ activeTemplateName: string; navOrder: string[]; managerOrder: string[] }> {
    const activeTemplateName = await pollUntil(
        () => readActiveTemplateName(page),
        (value) => Boolean(value && value.startsWith(expectedNamePrefix)),
        5000,
        `active template ${expectedNamePrefix}`,
    );
    const navOrder = await pollUntil(
        () => readNavOrder(page),
        (value) => JSON.stringify(value) === JSON.stringify(expectedNavOrder),
        5000,
        `${expectedNamePrefix} nav order`,
    );

    await openCategoryManager(page, expectedNavOrder.length);
    const managerOrder = await readManagerOrder(page);
    await closeCategoryManager(page);

    assert.deepEqual(managerOrder, expectedNavOrder, `${expectedNamePrefix} manager order mismatch`);

    return {
        activeTemplateName: activeTemplateName!,
        navOrder,
        managerOrder,
    };
}

async function classifyAndAssertPrompt(ctx: Awaited<ReturnType<typeof createTestApp>>, expectedCategory: string): Promise<string> {
    const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/ai/classify',
        headers: {
            authorization: `Bearer ${ctx.auth.apiToken}`,
            'content-type': 'application/json',
        },
        payload: {
            title: '模板切换默认分类验证',
            url: 'https://example.com/preset-template-validation',
            description: '用于验证默认活动模板候选分类是否已刷新',
        },
    });

    assert.equal(response.statusCode, 200, `classify failed: ${response.statusCode} ${response.body}`);
    const result = response.json() as { category: string };
    assert.equal(result.category, expectedCategory, 'classify result mismatch');

    return result.category;
}

async function main() {
    const aiHarness = createQueuedAIHarness([
        textCompletion('内容运营/选题策划'),
        textCompletion('写作与脚本/长文写作'),
    ]);
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-preset-template-',
        backupEnabled: false,
        periodicCheckEnabled: false,
        aiClientFactory: aiHarness.aiClientFactory,
    });

    let browser: Browser | null = null;

    try {
        seedAISettings(ctx.db);

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        await page.addInitScript(() => {
            localStorage.setItem('viewMode', 'table');
        });

        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);
        await openTemplateSelect(page);
        await page.getByTestId('template-tab-preset').click();

        const presetNames = await pollUntil(
            () => readPresetTemplateNames(page),
            (names) => PRESET_NAMES.every((name) => names.includes(name)),
            5000,
            'preset template names',
        );
        await page.getByTestId('template-select-close').click();
        await page.getByTestId('template-select-modal').waitFor({ state: 'hidden' });

        const productCustomName = await createPresetCopy(page, PRODUCT_PRESET_NAME);
        await applyCustomTemplate(page, productCustomName);
        const firstApplied = await assertTemplateApplied(page, PRODUCT_PRESET_NAME, PRODUCT_EXPECTED_TOP_LEVEL);
        const firstCategory = await classifyAndAssertPrompt(ctx, '内容运营/选题策划');
        const firstPrompt = String(aiHarness.calls[0]?.messages?.[1]?.content || '');
        assert(firstPrompt.includes('内容运营/选题策划'), 'first classify prompt missing product preset category');
        assert(firstPrompt.includes('项目协作/Roadmap'), 'first classify prompt missing product preset roadmap category');
        assert(!firstPrompt.includes('写作与脚本/长文写作'), 'first classify prompt still contains content preset category');

        const contentCustomName = await createAndApplyPreset(page, CONTENT_PRESET_NAME);
        const secondApplied = await assertTemplateApplied(page, CONTENT_PRESET_NAME, CONTENT_EXPECTED_TOP_LEVEL);
        const secondCategory = await classifyAndAssertPrompt(ctx, '写作与脚本/长文写作');
        const secondPrompt = String(aiHarness.calls[1]?.messages?.[1]?.content || '');
        assert(secondPrompt.includes('写作与脚本/长文写作'), 'second classify prompt missing content preset category');
        assert(secondPrompt.includes('品牌资产/作品集'), 'second classify prompt missing content preset asset category');
        assert(!secondPrompt.includes('内容运营/选题策划'), 'second classify prompt still contains product preset category');

        assert.equal(aiHarness.remainingSteps(), 0, 'unused AI fixture responses remain');

        const result = {
            issueId: 'R6-TPL-06',
            mode: 'preset-template-browser-harness',
            baseUrl,
            presetNames,
            firstFlow: {
                sourcePreset: PRODUCT_PRESET_NAME,
                createdTemplateName: productCustomName,
                activeTemplateName: firstApplied.activeTemplateName,
                navOrder: firstApplied.navOrder,
                managerOrder: firstApplied.managerOrder,
                classifyResult: firstCategory,
                promptIncludes: ['内容运营/选题策划', '项目协作/Roadmap'],
            } satisfies FlowResult,
            secondFlow: {
                sourcePreset: CONTENT_PRESET_NAME,
                createdTemplateName: contentCustomName,
                activeTemplateName: secondApplied.activeTemplateName,
                navOrder: secondApplied.navOrder,
                managerOrder: secondApplied.managerOrder,
                classifyResult: secondCategory,
                promptIncludes: ['写作与脚本/长文写作', '品牌资产/作品集'],
            } satisfies FlowResult,
        };

        console.log(JSON.stringify(result, null, 2));
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
