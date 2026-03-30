import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { createTemplate, type CategoryNode } from '../src/template-service';
import { createTestApp } from '../tests/helpers/app';

interface ElementRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
}

interface ScrollState {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

const LONG_TEMPLATE_NAME = '长树模板验收模板';
const SAVED_TEMPLATE_NAME = '长树模板验收模板（已保存）';
const CANCELED_TEMPLATE_NAME = '长树模板验收模板（未保存）';
const ROOT_COUNT = 18;
const CHILDREN_PER_ROOT = 4;

function buildLongTemplateTree(): CategoryNode[] {
    return Array.from({ length: ROOT_COUNT }, (_, rootIndex) => ({
        name: `一级分类 ${rootIndex + 1}`,
        children: Array.from({ length: CHILDREN_PER_ROOT }, (_, childIndex) => ({
            name: `子分类 ${rootIndex + 1}-${childIndex + 1}`,
        })),
    }));
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

async function readRect(page: Page, testId: string): Promise<ElementRect> {
    const locator = page.getByTestId(testId);
    await locator.waitFor({ state: 'visible' });
    return locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
        };
    });
}

async function assertFitsViewport(page: Page, testId: string, label: string): Promise<ElementRect> {
    const rect = await readRect(page, testId);
    const viewport = page.viewportSize();

    assert(viewport, 'viewport size missing');
    assert(rect.top >= 0, `${label} top should stay within viewport: ${rect.top}`);
    assert(rect.bottom <= viewport.height, `${label} bottom should stay within viewport: ${rect.bottom} > ${viewport.height}`);

    return rect;
}

async function openTemplateSelect(page: Page): Promise<void> {
    if (await page.getByTestId('template-select-modal').isVisible().catch(() => false)) {
        return;
    }
    await page.getByTestId('open-template-select').click();
    await page.getByTestId('template-select-modal').waitFor({ state: 'visible' });
}

async function openTemplateEditor(page: Page, templateName: string): Promise<void> {
    await openTemplateSelect(page);
    const card = page.getByTestId('custom-template-card').filter({ hasText: templateName }).first();
    await card.waitFor({ state: 'visible' });
    await card.getByTestId('edit-template-button').click();
    await page.getByTestId('template-edit-modal').waitFor({ state: 'visible' });
    await pollUntil(
        async () => (await page.getByTestId('template-edit-name-input').inputValue()).trim(),
        (value) => value === templateName,
        5000,
        `template editor to load ${templateName}`,
    );
}

async function readTemplateNames(page: Page): Promise<string[]> {
    return page.getByTestId('template-card-name').allTextContents();
}

async function scrollTemplateEditorBodyToBottom(page: Page): Promise<ScrollState> {
    const body = page.getByTestId('template-edit-body');
    await body.waitFor({ state: 'visible' });
    return body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return {
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
        };
    });
}

async function confirmAppDialog(page: Page): Promise<void> {
    await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
    await page.getByTestId('app-dialog-confirm').click();
    await page.getByTestId('app-dialog').waitFor({ state: 'hidden' });
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-template-editor-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        createTemplate(ctx.db, LONG_TEMPLATE_NAME, buildLongTemplateTree());

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const viewport = { width: 960, height: 560 };
        const page = await browser.newPage({ viewport });
        await page.addInitScript(() => {
            localStorage.setItem('viewMode', 'table');
        });

        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);

        await openTemplateEditor(page, LONG_TEMPLATE_NAME);

        const selectPanelRect = await assertFitsViewport(page, 'template-select-panel', 'template select panel');
        const initialPanelRect = await assertFitsViewport(page, 'template-edit-panel', 'template edit panel');
        const initialFooterRect = await assertFitsViewport(page, 'template-edit-footer', 'template edit footer');
        const initialSaveRect = await assertFitsViewport(page, 'template-edit-save', 'template edit save button');
        const initialCancelRect = await assertFitsViewport(page, 'template-edit-cancel', 'template edit cancel button');

        await page.getByTestId('template-edit-name-input').fill(SAVED_TEMPLATE_NAME);

        const bottomScrollState = await scrollTemplateEditorBodyToBottom(page);
        assert(
            bottomScrollState.scrollHeight > bottomScrollState.clientHeight,
            `expected template editor body to be scrollable, got ${JSON.stringify(bottomScrollState)}`,
        );
        const bottomFooterRect = await assertFitsViewport(page, 'template-edit-footer', 'template edit footer after scroll');
        const bottomSaveRect = await assertFitsViewport(page, 'template-edit-save', 'template edit save button after scroll');
        const bottomCancelRect = await assertFitsViewport(page, 'template-edit-cancel', 'template edit cancel button after scroll');

        await page.getByTestId('template-edit-save').click();
        await page.getByTestId('template-edit-modal').waitFor({ state: 'hidden' });

        const savedTemplateNames = await pollUntil(
            () => readTemplateNames(page),
            (names) => names.includes(SAVED_TEMPLATE_NAME),
            5000,
            'saved template name to appear in template list',
        );

        await openTemplateEditor(page, SAVED_TEMPLATE_NAME);
        await page.getByTestId('template-edit-name-input').fill(CANCELED_TEMPLATE_NAME);
        const cancelScrollState = await scrollTemplateEditorBodyToBottom(page);
        const cancelFooterRect = await assertFitsViewport(page, 'template-edit-footer', 'template edit footer before cancel');

        await page.getByTestId('template-edit-cancel').click();
        await confirmAppDialog(page);
        await page.getByTestId('template-edit-modal').waitFor({ state: 'hidden' });

        const finalTemplateNames = await pollUntil(
            () => readTemplateNames(page),
            (names) => names.includes(SAVED_TEMPLATE_NAME) && !names.includes(CANCELED_TEMPLATE_NAME),
            5000,
            'canceled template name to stay unsaved',
        );

        console.log(JSON.stringify({
            issueId: 'R6-UI-02',
            mode: 'template-editor-modal-harness',
            baseUrl,
            viewport,
            results: {
                rootCount: ROOT_COUNT,
                childCount: ROOT_COUNT * CHILDREN_PER_ROOT,
                selectPanelRect,
                initialPanelRect,
                initialFooterRect,
                initialSaveRect,
                initialCancelRect,
                bottomScrollState,
                bottomFooterRect,
                bottomSaveRect,
                bottomCancelRect,
                cancelScrollState,
                cancelFooterRect,
                savedTemplateNames,
                finalTemplateNames,
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
