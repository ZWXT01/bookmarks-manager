import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { createTestApp } from '../tests/helpers/app';
import { seedCategoryTree } from '../tests/helpers/factories';

interface ValidationResult {
    initialManagerOrder: string[];
    initialNavOrder: string[];
    reorderedManagerOrder: string[];
    reorderedNavOrder: string[];
    reorderedSelectOrder: string[];
    reloadedNavOrder: string[];
    reloadedSelectOrder: string[];
}

const SEEDED_TREE = [
    { name: '工作', child: '项目' },
    { name: '学习', child: '资料' },
    { name: '生活', child: '清单' },
    { name: '娱乐', child: '电影' },
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
    await page.getByRole('textbox', { name: '请输入用户名' }).fill(username);
    await page.getByRole('textbox', { name: '请输入密码' }).fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(`${baseUrl}/`);
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

async function readAddBookmarkSelectOrder(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const select = document.querySelector('[data-testid="add-bookmark-category-select"]');
        if (!(select instanceof HTMLSelectElement)) {
            throw new Error('add bookmark category select not found');
        }

        return Array.from(select.options)
            .map((option) => option.textContent?.trim() ?? '')
            .filter((text) => text && text !== '未分类');
    });
}

async function openCategoryManager(page: Page): Promise<void> {
    await page.getByTestId('open-category-manager').click();
    await page.getByTestId('category-manager-modal').waitFor({ state: 'visible' });
    await pollUntil(
        () => readManagerOrder(page),
        (order) => order.length === SEEDED_TREE.length,
        5000,
        'category manager cards to render',
    );
}

async function dragFirstCategoryToLast(page: Page): Promise<void> {
    const cards = page.getByTestId('category-drag-card');
    const sourceHandle = cards.nth(0).locator('.drag-handle');
    const targetCard = cards.nth(SEEDED_TREE.length - 1);
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetCard.boundingBox();

    assert(sourceBox, 'source drag handle bounding box missing');
    assert(targetBox, 'target card bounding box missing');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.9, { steps: 20 });
    await page.mouse.up();
}

function buildExpectedSelectOrder(topLevelOrder: string[]): string[] {
    return topLevelOrder.flatMap((name) => {
        const item = SEEDED_TREE.find((entry) => entry.name === name);
        assert(item, `missing seeded category metadata for ${name}`);
        return [item.name, `${item.name}/${item.child}`];
    });
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-category-interaction-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

        seedCategoryTree(ctx.db, SEEDED_TREE.map((item) => ({
            name: item.name,
            children: [{ name: item.child }],
        })));

        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);
        await openCategoryManager(page);

        const initialManagerOrder = await readManagerOrder(page);
        const initialNavOrder = await readNavOrder(page);
        assert.deepEqual(initialManagerOrder, SEEDED_TREE.map((item) => item.name), 'initial manager order mismatch');
        assert.deepEqual(initialNavOrder, initialManagerOrder, 'initial navigation order should match category manager');

        await dragFirstCategoryToLast(page);

        const expectedReorderedTopLevel = [...initialManagerOrder.slice(1), initialManagerOrder[0]];
        const reorderedManagerOrder = await pollUntil(
            () => readManagerOrder(page),
            (order) => order.length === expectedReorderedTopLevel.length
                && order.every((name, index) => name === expectedReorderedTopLevel[index]),
            10000,
            'category manager order to persist after drag sorting',
        );

        const reorderedNavOrder = await pollUntil(
            () => readNavOrder(page),
            (order) => order.length === expectedReorderedTopLevel.length
                && order.every((name, index) => name === expectedReorderedTopLevel[index]),
            10000,
            'category navigation order to sync after drag sorting',
        );

        const expectedSelectOrder = buildExpectedSelectOrder(expectedReorderedTopLevel);
        const reorderedSelectOrder = await pollUntil(
            () => readAddBookmarkSelectOrder(page),
            (order) => order.length === expectedSelectOrder.length
                && order.every((name, index) => name === expectedSelectOrder[index]),
            10000,
            'category select order to sync after drag sorting',
        );

        await page.reload({ waitUntil: 'domcontentloaded' });

        const reloadedNavOrder = await pollUntil(
            () => readNavOrder(page),
            (order) => order.length === expectedReorderedTopLevel.length
                && order.every((name, index) => name === expectedReorderedTopLevel[index]),
            10000,
            'category navigation order to persist after reload',
        );

        const reloadedSelectOrder = await pollUntil(
            () => readAddBookmarkSelectOrder(page),
            (order) => order.length === expectedSelectOrder.length
                && order.every((name, index) => name === expectedSelectOrder[index]),
            10000,
            'category select order to persist after reload',
        );

        const results: ValidationResult = {
            initialManagerOrder,
            initialNavOrder,
            reorderedManagerOrder,
            reorderedNavOrder,
            reorderedSelectOrder,
            reloadedNavOrder,
            reloadedSelectOrder,
        };

        console.log(JSON.stringify({
            issueId: 'R3-QA-03',
            mode: 'category-interaction-harness',
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
