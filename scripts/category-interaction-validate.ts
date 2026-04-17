import assert from 'node:assert/strict';

import { chromium, type Browser, type Page } from 'playwright';

import { applyTemplate, createTemplate } from '../src/template-service';
import { createTestApp } from '../tests/helpers/app';
import { seedBookmarks } from '../tests/helpers/db';

interface TemplateSeedNode {
    name: string;
    children?: TemplateSeedNode[];
}

interface BookmarkRow {
    id: number;
    title: string;
    category: string;
}

interface ValidationResult {
    initialManagerOrder: string[];
    initialNavOrder: string[];
    reorderedManagerOrder: string[];
    reorderedNavOrder: string[];
    reorderedSelectOrder: string[];
    deletedCategory: {
        navOrder: string[];
        selectOrder: string[];
        allTabSelected: boolean;
        visibleTitlesAfterReset: string[];
        bookmarkCategories: Record<string, string>;
    };
    movedCategory: {
        workSubcategories: string[];
        selectOrder: string[];
    };
    singleMove: {
        emptySourceTitles: string[];
        targetTitles: string[];
        bookmarkCategories: Record<string, string>;
    };
    batchMove: {
        projectTitles: string[];
        bookmarkCategories: Record<string, string>;
    };
    templateSwitch: {
        activeTemplate: string | null;
        navOrder: string[];
        selectOrder: string[];
        bookmarkCategories: Record<string, string>;
        resourceTitles: string[];
        reloadedTemplate: string | null;
        reloadedNavOrder: string[];
        reloadedBookmarkCategories: Record<string, string>;
    };
}

const TEMPLATE_A_NAME = '交互回归模板 A';
const TEMPLATE_B_NAME = '交互回归模板 B';

const TEMPLATE_A: TemplateSeedNode[] = [
    { name: '工作', children: [{ name: '项目' }] },
    { name: '学习', children: [{ name: '资料' }] },
    { name: '生活', children: [{ name: '清单' }] },
    { name: '娱乐', children: [{ name: '电影' }] },
];

const TEMPLATE_B: TemplateSeedNode[] = [
    { name: '归档', children: [{ name: '已处理' }] },
    { name: '资源', children: [{ name: '学习' }] },
    { name: '生活', children: [{ name: '采购' }] },
];

const BOOKMARK_TITLES = {
    spec: 'Spec 文档',
    react: 'React 教程',
    shopping: '采购清单',
    movie: '电影推荐',
} as const;

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

function buildExpectedSelectOrder(tree: TemplateSeedNode[]): string[] {
    return tree.flatMap((node) => [
        node.name,
        ...(node.children ?? []).map((child) => `${node.name}/${child.name}`),
    ]);
}

function bookmarkMap(rows: BookmarkRow[]): Record<string, string> {
    return Object.fromEntries(rows.map((row) => [row.title, row.category]));
}

function sortedTitles(rows: BookmarkRow[]): string[] {
    return rows.map((row) => row.title).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getCategoryIdByPath(db: any, path: string): number {
    const row = db.prepare('SELECT id FROM categories WHERE name = ?').get(path) as { id: number } | undefined;
    assert(row, `category not found: ${path}`);
    return row.id;
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

async function readVisibleBookmarks(page: Page): Promise<BookmarkRow[]> {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-testid="bookmark-row"]'))
            .map((row) => {
                if (!(row instanceof HTMLElement)) return null;
                const id = Number(row.dataset.bookmarkId);
                const title = row.querySelector('[data-testid="bookmark-row-title"]')?.textContent?.trim() ?? '';
                const category = row.querySelector('[data-testid="bookmark-category-label"]')?.textContent?.trim() ?? '';
                if (!Number.isFinite(id) || !title) return null;
                return { id, title, category };
            })
            .filter((row): row is BookmarkRow => Boolean(row));
    });
}

async function readOpenSubcategoryNames(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-testid="subcategory-nav-item"]'))
            .map((node) => node.querySelector('.subcategory-item-text')?.textContent?.trim() ?? '')
            .filter(Boolean);
    });
}

async function readActiveTemplateName(page: Page): Promise<string | null> {
    const text = await page.locator('[data-testid="active-template-name"]').textContent().catch(() => null);
    const trimmed = text?.trim() ?? '';
    return trimmed || null;
}

async function isAllTabSelected(page: Page): Promise<boolean> {
    return (await page.getByTestId('category-nav-all-tab').getAttribute('aria-selected')) === 'true';
}

async function openCategoryManager(page: Page, expectedCount: number): Promise<void> {
    await page.getByTestId('open-category-manager').click();
    await page.getByTestId('category-manager-modal').waitFor({ state: 'visible' });
    await pollUntil(
        () => readManagerOrder(page),
        (order) => order.length === expectedCount,
        5000,
        'category manager cards to render',
    );
}

async function closeCategoryManager(page: Page): Promise<void> {
    await page.getByTestId('close-category-manager').click();
    await page.getByTestId('category-manager-modal').waitFor({ state: 'hidden' });
}

async function dragFirstCategoryToLast(page: Page, expectedCount: number): Promise<void> {
    const cards = page.getByTestId('category-drag-card');
    const sourceHandle = cards.nth(0).locator('.drag-handle');
    const targetCard = cards.nth(expectedCount - 1);
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetCard.boundingBox();

    assert(sourceBox, 'source drag handle bounding box missing');
    assert(targetBox, 'target card bounding box missing');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.9, { steps: 20 });
    await page.mouse.up();
}

function topLevelTab(page: Page, name: string) {
    return page.getByTestId('category-nav-tab').filter({ hasText: name }).first();
}

async function openSubcategoryDropdown(page: Page, parentName: string, expectedMinCount = 1): Promise<string[]> {
    await topLevelTab(page, parentName).hover();
    await page.getByTestId('subcategory-panel').waitFor({ state: 'visible' });
    return pollUntil(
        () => readOpenSubcategoryNames(page),
        (names) => names.length >= expectedMinCount,
        5000,
        `${parentName} subcategory dropdown`,
    );
}

async function clickSubcategory(page: Page, parentName: string, childName: string): Promise<void> {
    await openSubcategoryDropdown(page, parentName);
    await page.getByTestId('subcategory-nav-item').filter({ hasText: childName }).first().click();
}

async function confirmDialog(page: Page): Promise<void> {
    await page.getByTestId('app-dialog').waitFor({ state: 'visible' });
    await page.getByTestId('app-dialog-confirm').click();
    await page.getByTestId('app-dialog').waitFor({ state: 'hidden' });
}

async function deleteCategoryFromManager(page: Page, categoryName: string): Promise<void> {
    const card = page.getByTestId('category-drag-card').filter({ hasText: categoryName }).first();
    await card.hover();
    await card.getByTestId('delete-category-button').first().click();
    await confirmDialog(page);
}

async function openBookmarkActions(page: Page, title: string): Promise<void> {
    const row = page.locator('[data-testid="bookmark-row"]', { hasText: title }).first();
    await row.getByTestId('bookmark-actions-button').click();
}

async function moveOneBookmark(page: Page, title: string, targetLabel: string): Promise<void> {
    const row = page.locator('[data-testid="bookmark-row"]', { hasText: title }).first();
    await openBookmarkActions(page, title);
    await row.getByTestId('bookmark-row-move-button').click();
    await page.getByTestId('move-one-modal').waitFor({ state: 'visible' });
    await page.locator('[data-testid="move-one-category-select"]').selectOption({ label: targetLabel });
    await page.getByTestId('confirm-move-one-bookmark').click();
    await page.getByTestId('move-one-modal').waitFor({ state: 'hidden' });
}

async function moveSelectedBookmarks(page: Page, titles: string[], targetLabel: string): Promise<void> {
    for (const title of titles) {
        const row = page.locator('[data-testid="bookmark-row"]', { hasText: title }).first();
        await row.getByTestId('bookmark-row-checkbox').check();
    }
    await page.getByTestId('move-selected-bookmarks-button').waitFor({ state: 'visible' });
    await page.getByTestId('move-selected-bookmarks-button').click();
    await page.getByTestId('move-selected-modal').waitFor({ state: 'visible' });
    await page.locator('[data-testid="move-selected-category-select"]').selectOption({ label: targetLabel });
    await page.getByTestId('confirm-move-selected-bookmarks').click();
    await page.getByTestId('move-selected-modal').waitFor({ state: 'hidden' });
}

async function moveCategoryByApi(page: Page, categoryId: number, newParentId: number): Promise<void> {
    await page.evaluate(async ({ categoryId: id, newParentId: parentId }) => {
        const response = await fetch(`/api/categories/${id}/move`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ parent_id: parentId }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error || 'move category failed');
        }
    }, { categoryId, newParentId });
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-category-interaction-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;

    try {
        const templateA = createTemplate(ctx.db, TEMPLATE_A_NAME, TEMPLATE_A);
        const templateB = createTemplate(ctx.db, TEMPLATE_B_NAME, TEMPLATE_B);
        applyTemplate(ctx.db, templateA.id);

        const categoryIds = {
            work: getCategoryIdByPath(ctx.db, '工作'),
            project: getCategoryIdByPath(ctx.db, '工作/项目'),
            studyDoc: getCategoryIdByPath(ctx.db, '学习/资料'),
            lifeList: getCategoryIdByPath(ctx.db, '生活/清单'),
            entertainment: getCategoryIdByPath(ctx.db, '娱乐'),
        };

        const [specBookmarkId, reactBookmarkId, shoppingBookmarkId, movieBookmarkId] = seedBookmarks(ctx.db, [
            { url: 'https://example.com/spec', title: BOOKMARK_TITLES.spec, categoryId: categoryIds.project },
            { url: 'https://example.com/react', title: BOOKMARK_TITLES.react, categoryId: categoryIds.studyDoc },
            { url: 'https://example.com/shopping', title: BOOKMARK_TITLES.shopping, categoryId: categoryIds.lifeList },
            { url: 'https://example.com/movie', title: BOOKMARK_TITLES.movie, categoryId: categoryIds.entertainment },
        ]);

        const insertSnapshot = ctx.db.prepare(
            'INSERT INTO template_snapshots (template_id, bookmark_id, category_path) VALUES (?, ?, ?)',
        );
        insertSnapshot.run(templateB.id, specBookmarkId, '资源/学习');
        insertSnapshot.run(templateB.id, reactBookmarkId, '资源/学习');
        insertSnapshot.run(templateB.id, shoppingBookmarkId, '生活/采购');
        insertSnapshot.run(templateB.id, movieBookmarkId, '归档/已处理');

        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.addInitScript(() => {
            localStorage.setItem('viewMode', 'table');
        });

        await login(page, baseUrl, ctx.auth.username, ctx.auth.password);

        await pollUntil(
            () => readActiveTemplateName(page),
            (name) => name === TEMPLATE_A_NAME,
            5000,
            'active template A to load',
        );

        await openCategoryManager(page, TEMPLATE_A.length);

        const initialManagerOrder = await readManagerOrder(page);
        const initialNavOrder = await readNavOrder(page);
        assert.deepEqual(initialManagerOrder, TEMPLATE_A.map((node) => node.name), 'initial manager order mismatch');
        assert.deepEqual(initialNavOrder, initialManagerOrder, 'initial navigation order should match category manager');

        await dragFirstCategoryToLast(page, TEMPLATE_A.length);

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

        const expectedReorderedSelectOrder = buildExpectedSelectOrder([
            TEMPLATE_A[1],
            TEMPLATE_A[2],
            TEMPLATE_A[3],
            TEMPLATE_A[0],
        ]);
        const reorderedSelectOrder = await pollUntil(
            () => readAddBookmarkSelectOrder(page),
            (order) => order.length === expectedReorderedSelectOrder.length
                && order.every((name, index) => name === expectedReorderedSelectOrder[index]),
            10000,
            'category select order to sync after drag sorting',
        );

        await closeCategoryManager(page);

        await topLevelTab(page, '娱乐').click();
        await pollUntil(
            async () => sortedTitles(await readVisibleBookmarks(page)),
            (titles) => titles.length === 1 && titles[0] === BOOKMARK_TITLES.movie,
            5000,
            'entertainment filter to show the movie bookmark',
        );

        await openCategoryManager(page, TEMPLATE_A.length);
        await deleteCategoryFromManager(page, '娱乐');

        const expectedAfterDeleteNavOrder = ['学习', '生活', '工作'];
        const expectedAfterDeleteSelectOrder = ['学习', '学习/资料', '生活', '生活/清单', '工作', '工作/项目'];
        const deletedNavOrder = await pollUntil(
            () => readNavOrder(page),
            (order) => order.length === expectedAfterDeleteNavOrder.length
                && order.every((name, index) => name === expectedAfterDeleteNavOrder[index]),
            10000,
            'navigation order after deleting entertainment',
        );
        const deletedSelectOrder = await pollUntil(
            () => readAddBookmarkSelectOrder(page),
            (order) => order.length === expectedAfterDeleteSelectOrder.length
                && order.every((name, index) => name === expectedAfterDeleteSelectOrder[index]),
            10000,
            'category select after deleting entertainment',
        );
        const deletedAllTabSelected = await pollUntil(
            () => isAllTabSelected(page),
            (selected) => selected,
            5000,
            'all tab to be selected after deleting active category',
        );
        await closeCategoryManager(page);
        const deletedRows = await pollUntil(
            () => readVisibleBookmarks(page),
            (rows) => bookmarkMap(rows)[BOOKMARK_TITLES.movie] === '未分类',
            10000,
            'bookmarks to refresh after deleting entertainment',
        );

        await moveCategoryByApi(page, categoryIds.studyDoc, categoryIds.work);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await pollUntil(
            () => readActiveTemplateName(page),
            (name) => name === TEMPLATE_A_NAME,
            5000,
            'active template A after category move reload',
        );
        const movedWorkSubcategories = await openSubcategoryDropdown(page, '工作', 2);
        assert(movedWorkSubcategories.includes('项目'), 'expected project to remain under 工作');
        assert(movedWorkSubcategories.includes('资料'), 'expected moved 资料 under 工作');
        const movedSelectOrder = await pollUntil(
            () => readAddBookmarkSelectOrder(page),
            (order) => order.includes('工作/资料') && !order.includes('学习/资料'),
            5000,
            'select options to reflect moved child category',
        );

        await clickSubcategory(page, '工作', '项目');
        await pollUntil(
            async () => sortedTitles(await readVisibleBookmarks(page)),
            (titles) => titles.length === 1 && titles[0] === BOOKMARK_TITLES.spec,
            5000,
            'project filter before moving the spec bookmark',
        );
        await moveOneBookmark(page, BOOKMARK_TITLES.spec, '生活/清单');
        const emptySourceRows = await pollUntil(
            () => readVisibleBookmarks(page),
            (rows) => rows.length === 0,
            10000,
            'project filter to become empty after moving spec bookmark away',
        );

        await clickSubcategory(page, '生活', '清单');
        const singleMoveRows = await pollUntil(
            () => readVisibleBookmarks(page),
            (rows) => {
                const categories = bookmarkMap(rows);
                return categories[BOOKMARK_TITLES.spec] === '生活/清单'
                    && categories[BOOKMARK_TITLES.shopping] === '生活/清单';
            },
            10000,
            'life list filter to show the moved spec bookmark',
        );

        await page.getByTestId('category-nav-all-tab').click();
        await pollUntil(
            async () => sortedTitles(await readVisibleBookmarks(page)),
            (titles) => titles.includes(BOOKMARK_TITLES.react) && titles.includes(BOOKMARK_TITLES.shopping),
            5000,
            'all tab before batch move',
        );
        await moveSelectedBookmarks(page, [BOOKMARK_TITLES.react, BOOKMARK_TITLES.shopping], '工作/项目');
        const batchMoveRows = await pollUntil(
            () => readVisibleBookmarks(page),
            (rows) => {
                const categories = bookmarkMap(rows);
                return categories[BOOKMARK_TITLES.react] === '工作/项目'
                    && categories[BOOKMARK_TITLES.shopping] === '工作/项目';
            },
            10000,
            'all tab categories after batch move',
        );

        await clickSubcategory(page, '工作', '项目');
        const projectRowsAfterBatchMove = await pollUntil(
            () => readVisibleBookmarks(page),
            (rows) => {
                const titles = sortedTitles(rows);
                return titles.length === 2
                    && titles.includes(BOOKMARK_TITLES.react)
                    && titles.includes(BOOKMARK_TITLES.shopping);
            },
            10000,
            'project filter to show batch-moved bookmarks',
        );

        await page.getByTestId('open-template-select').click();
        await page.getByTestId('template-select-modal').waitFor({ state: 'visible' });
        const templateCard = page.getByTestId('custom-template-card').filter({ hasText: TEMPLATE_B_NAME }).first();
        await templateCard.getByTestId('apply-template-button').click();
        await confirmDialog(page);
        await page.getByTestId('template-select-modal').waitFor({ state: 'hidden' });

        const expectedTemplateBSelectOrder = buildExpectedSelectOrder(TEMPLATE_B);
        const templateBActiveName = await pollUntil(
            () => readActiveTemplateName(page),
            (name) => name === TEMPLATE_B_NAME,
            10000,
            'template B to become active',
        );
        const templateBNavOrder = await pollUntil(
            () => readNavOrder(page),
            (order) => order.length === TEMPLATE_B.length
                && order.every((name, index) => name === TEMPLATE_B[index].name),
            10000,
            'template B navigation order',
        );
        const templateBSelectOrder = await pollUntil(
            () => readAddBookmarkSelectOrder(page),
            (order) => order.length === expectedTemplateBSelectOrder.length
                && order.every((name, index) => name === expectedTemplateBSelectOrder[index]),
            10000,
            'template B select order',
        );
        await page.getByTestId('category-nav-all-tab').click();
        const templateBRows = await pollUntil(
            () => readVisibleBookmarks(page),
            (rows) => {
                const categories = bookmarkMap(rows);
                return categories[BOOKMARK_TITLES.spec] === '资源/学习'
                    && categories[BOOKMARK_TITLES.react] === '资源/学习'
                    && categories[BOOKMARK_TITLES.shopping] === '生活/采购'
                    && categories[BOOKMARK_TITLES.movie] === '归档/已处理';
            },
            10000,
            'bookmark assignments after switching to template B',
        );

        await clickSubcategory(page, '资源', '学习');
        const resourceRows = await pollUntil(
            () => readVisibleBookmarks(page),
            (rows) => {
                const titles = sortedTitles(rows);
                return titles.length === 2
                    && titles.includes(BOOKMARK_TITLES.spec)
                    && titles.includes(BOOKMARK_TITLES.react);
            },
            10000,
            'resource learning filter after switching template',
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        const reloadedTemplateName = await pollUntil(
            () => readActiveTemplateName(page),
            (name) => name === TEMPLATE_B_NAME,
            10000,
            'template B to persist after reload',
        );
        const reloadedTemplateNavOrder = await pollUntil(
            () => readNavOrder(page),
            (order) => order.length === TEMPLATE_B.length
                && order.every((name, index) => name === TEMPLATE_B[index].name),
            10000,
            'template B navigation after reload',
        );
        await page.getByTestId('category-nav-all-tab').click();
        const reloadedTemplateRows = await pollUntil(
            () => readVisibleBookmarks(page),
            (rows) => bookmarkMap(rows)[BOOKMARK_TITLES.movie] === '归档/已处理',
            10000,
            'template B bookmark assignments after reload',
        );

        const results: ValidationResult = {
            initialManagerOrder,
            initialNavOrder,
            reorderedManagerOrder,
            reorderedNavOrder,
            reorderedSelectOrder,
            deletedCategory: {
                navOrder: deletedNavOrder,
                selectOrder: deletedSelectOrder,
                allTabSelected: deletedAllTabSelected,
                visibleTitlesAfterReset: sortedTitles(deletedRows),
                bookmarkCategories: bookmarkMap(deletedRows),
            },
            movedCategory: {
                workSubcategories: movedWorkSubcategories.slice().sort((a, b) => a.localeCompare(b, 'zh-CN')),
                selectOrder: movedSelectOrder,
            },
            singleMove: {
                emptySourceTitles: sortedTitles(emptySourceRows),
                targetTitles: sortedTitles(singleMoveRows),
                bookmarkCategories: bookmarkMap(singleMoveRows),
            },
            batchMove: {
                projectTitles: sortedTitles(projectRowsAfterBatchMove),
                bookmarkCategories: bookmarkMap(batchMoveRows),
            },
            templateSwitch: {
                activeTemplate: templateBActiveName,
                navOrder: templateBNavOrder,
                selectOrder: templateBSelectOrder,
                bookmarkCategories: bookmarkMap(templateBRows),
                resourceTitles: sortedTitles(resourceRows),
                reloadedTemplate: reloadedTemplateName,
                reloadedNavOrder: reloadedTemplateNavOrder,
                reloadedBookmarkCategories: bookmarkMap(reloadedTemplateRows),
            },
        };

        console.log(JSON.stringify({
            issueId: 'R4-QA-02',
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
