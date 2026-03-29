import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { createTestApp } from '../tests/helpers/app';
import { seedCategoryTree } from '../tests/helpers/factories';

interface NavMetrics {
    tabCount: number;
    rowCount: number;
    minTop: number;
    maxTop: number;
    scrollLeft: number;
    scrollWidth: number;
    clientWidth: number;
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

async function readNavMetrics(page: Page): Promise<NavMetrics> {
    return page.evaluate(() => {
        const container = document.querySelector('.category-tabs');
        if (!(container instanceof HTMLElement)) {
            throw new Error('category-tabs container not found');
        }

        const tabs = Array.from(container.querySelectorAll('[role="tab"]')).filter((node): node is HTMLElement => node instanceof HTMLElement);
        const topValues = tabs.map((tab) => Math.round(tab.getBoundingClientRect().top));
        const uniqueRows = [...new Set(topValues)];

        return {
            tabCount: tabs.length,
            rowCount: uniqueRows.length,
            minTop: uniqueRows.length ? Math.min(...uniqueRows) : 0,
            maxTop: uniqueRows.length ? Math.max(...uniqueRows) : 0,
            scrollLeft: container.scrollLeft,
            scrollWidth: container.scrollWidth,
            clientWidth: container.clientWidth,
        };
    });
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-category-nav-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

        seedCategoryTree(ctx.db, Array.from({ length: 14 }, (_, index) => ({
            name: `分类${String(index + 1).padStart(2, '0')}长标签`,
            children: [{ name: `子分类${String(index + 1).padStart(2, '0')}` }],
        })));

        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);

        const initialMetrics = await pollUntil(
            () => readNavMetrics(page),
            (metrics) => metrics.tabCount >= 16 && metrics.rowCount === 1 && metrics.scrollWidth > metrics.clientWidth,
            10000,
            'category navigation to stabilize as a single horizontal row',
        );

        const rightScrollButton = page.getByRole('button', { name: '向右滚动' });
        const scrollBeforeButton = initialMetrics.scrollLeft;
        await rightScrollButton.click();
        const afterButton = await pollUntil(
            () => readNavMetrics(page),
            (metrics) => metrics.scrollLeft > scrollBeforeButton + 40,
            5000,
            'right scroll button to move category navigation',
        );

        const navLocator = page.locator('.category-tabs');
        const scrollBeforeWheel = afterButton.scrollLeft;
        await navLocator.hover();
        await page.mouse.wheel(0, 480);
        const afterWheel = await pollUntil(
            () => readNavMetrics(page),
            (metrics) => metrics.scrollLeft > scrollBeforeWheel + 40,
            5000,
            'mouse wheel to move category navigation horizontally',
        );

        const box = await navLocator.boundingBox();
        assert(box, 'category navigation bounding box not available');
        const scrollBeforeDrag = afterWheel.scrollLeft;
        await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 10 });
        await page.mouse.up();
        const afterDrag = await pollUntil(
            () => readNavMetrics(page),
            (metrics) => metrics.scrollLeft > scrollBeforeDrag + 80,
            5000,
            'drag gesture to move category navigation horizontally',
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        const afterReload = await pollUntil(
            () => readNavMetrics(page),
            (metrics) => metrics.tabCount >= 16 && metrics.rowCount === 1,
            10000,
            'category navigation to remain a single row after reload',
        );

        console.log(JSON.stringify({
            issueId: 'R3-UI-01',
            mode: 'category-nav-harness',
            baseUrl,
            results: {
                tabCount: afterReload.tabCount,
                rowCountInitial: initialMetrics.rowCount,
                rowCountAfterReload: afterReload.rowCount,
                overflowDetected: initialMetrics.scrollWidth > initialMetrics.clientWidth,
                buttonScrollWorked: afterButton.scrollLeft > scrollBeforeButton,
                wheelScrollWorked: afterWheel.scrollLeft > scrollBeforeWheel,
                dragScrollWorked: afterDrag.scrollLeft > scrollBeforeDrag,
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
