import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { chromium, type BrowserContext, type Page } from 'playwright';

import { createTestApp } from '../tests/helpers/app';
import { seedCategoryTree } from '../tests/helpers/factories';

interface FixturePageDefinition {
    pathname: string;
    title: string;
    marker: string;
    body: string;
}

interface FixtureServerHandle {
    baseUrl: string;
    close: () => Promise<void>;
}

interface RuntimePopupState {
    targetTitle: string;
    targetUrl: string;
}

interface ExtensionRuntimeHandle {
    context: BrowserContext;
    userDataDir: string;
    close: () => Promise<void>;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function buildFixtureHtml(page: FixturePageDefinition): string {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${page.title}</title>
</head>
<body>
  <main>
    <h1>${page.title}</h1>
    <p data-marker="${page.marker}">${page.body}</p>
    <article>
      <p>fixture:${page.marker}</p>
      <p>runtime-extension-validation</p>
    </article>
  </main>
</body>
</html>`;
}

async function createFixtureServer(pages: FixturePageDefinition[]): Promise<FixtureServerHandle> {
    const pageMap = new Map(pages.map((page) => [page.pathname, page]));
    const server = http.createServer((req, res) => {
        const pathname = decodeURIComponent((req.url ?? '/').split('?')[0] || '/');
        const page = pageMap.get(pathname);

        if (!page) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildFixtureHtml(page));
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    assert(address && typeof address === 'object', 'fixture server failed to bind');

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        },
    };
}

async function pollUntil<T>(
    read: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeout: number,
    label: string,
): Promise<T> {
    const startedAt = Date.now();
    let lastValue = await read();

    while (Date.now() - startedAt <= timeout) {
        if (predicate(lastValue)) return lastValue;
        await new Promise((resolve) => setTimeout(resolve, 100));
        lastValue = await read();
    }

    throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
}

async function waitForText(page: Page, selector: string, expected: string, timeout = 5000): Promise<void> {
    const locator = page.locator(selector);
    await locator.waitFor({ timeout });
    await pollUntil(
        async () => (await locator.textContent())?.trim() ?? '',
        (value) => value.includes(expected),
        timeout,
        `${selector} to contain ${expected}`,
    );
}

async function waitForInputValue(page: Page, selector: string, expected: string, timeout = 5000): Promise<void> {
    const locator = page.locator(selector);
    await locator.waitFor({ timeout });
    await pollUntil(
        async () => locator.inputValue(),
        (value) => value === expected,
        timeout,
        `${selector} value to equal ${expected}`,
    );
}

async function waitForOption(page: Page, label: string, timeout = 5000): Promise<void> {
    await pollUntil(
        async () => page.locator('#category option').evaluateAll((options) => options.map((option) => option.textContent || '')),
        (labels) => labels.includes(label),
        timeout,
        `#category options to include ${label}`,
    );
}

async function launchExtensionRuntime(extensionDir: string): Promise<ExtensionRuntimeHandle> {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-extension-runtime-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        args: [
            `--disable-extensions-except=${extensionDir}`,
            `--load-extension=${extensionDir}`,
        ],
    });

    return {
        context,
        userDataDir,
        close: async () => {
            await context.close();
            fs.rmSync(userDataDir, { recursive: true, force: true });
        },
    };
}

async function getExtensionId(context: BrowserContext): Promise<string> {
    const page = context.pages()[0] || await context.newPage();
    await page.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });

    const extensionId = await pollUntil(
        async () => page.evaluate(() => {
            const manager = document.querySelector('extensions-manager');
            const managerRoot = manager && manager.shadowRoot;
            const itemList = managerRoot && managerRoot.querySelector('extensions-item-list');
            const listRoot = itemList && itemList.shadowRoot;
            const item = listRoot && listRoot.querySelector('extensions-item');
            return item ? item.getAttribute('id') : null;
        }),
        (value) => typeof value === 'string' && value.length > 0,
        5000,
        'extension id',
    );

    return extensionId;
}

function buildRuntimePopupInitScript(state: RuntimePopupState): string {
    return `
(() => {
    Object.defineProperty(window, '__BOOKMARKS_MANAGER_RUNTIME_TEST__', {
        configurable: true,
        value: ${JSON.stringify(state)},
    });
})();
`;
}

async function openRuntimePopup(
    context: BrowserContext,
    extensionId: string,
    state: RuntimePopupState,
): Promise<Page> {
    const page = await context.newPage();
    await page.addInitScript({ content: buildRuntimePopupInitScript(state) });
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    return page;
}

async function waitForNewPage(context: BrowserContext, trigger: () => Promise<void>, label: string): Promise<Page> {
    const popupPromise = context.waitForEvent('page', { timeout: 5000 });
    await trigger();
    const page = await popupPromise;
    await page.waitForLoadState('domcontentloaded');
    return page;
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-extension-runtime-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let fixtureServer: FixtureServerHandle | null = null;
    let runtime: ExtensionRuntimeHandle | null = null;
    const rootDir = ctx.paths.rootDir;

    try {
        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
        fixtureServer = await createFixtureServer([
            {
                pathname: '/bookmark',
                title: 'Runtime Bookmark Fixture',
                marker: 'runtime-bookmark-marker',
                body: 'This fixture page is used for real extension runtime bookmark validation.',
            },
            {
                pathname: '/save-all',
                title: 'Runtime Save All Fixture',
                marker: 'runtime-save-all-marker',
                body: 'This fixture page is used for real extension runtime save-all validation.',
            },
        ]);

        const seededCategories = seedCategoryTree(ctx.db, [
            {
                name: '扩展验收',
                children: [{ name: '收藏' }, { name: '同时保存' }],
            },
        ]);
        const extensionRoot = seededCategories[0];
        assert(extensionRoot, 'failed to seed extension validation categories');
        const collectCategory = extensionRoot.children.find((child) => child.fullPath === '扩展验收/收藏');
        const saveAllCategory = extensionRoot.children.find((child) => child.fullPath === '扩展验收/同时保存');
        assert(collectCategory, 'missing seeded collect category');
        assert(saveAllCategory, 'missing seeded save-all category');

        runtime = await launchExtensionRuntime(path.join(process.cwd(), 'extension-new'));
        const extensionId = await getExtensionId(runtime.context);

        const bookmarkTarget = await runtime.context.newPage();
        await bookmarkTarget.goto(`${fixtureServer.baseUrl}/bookmark`, { waitUntil: 'domcontentloaded' });
        const bookmarkUrl = bookmarkTarget.url();
        const bookmarkTitle = await bookmarkTarget.title();

        const bookmarkPopup = await openRuntimePopup(runtime.context, extensionId, {
            targetTitle: bookmarkTitle,
            targetUrl: bookmarkUrl,
        });

        try {
            await waitForInputValue(bookmarkPopup, '#title', bookmarkTitle);
            await waitForInputValue(bookmarkPopup, '#url', bookmarkUrl);
            await waitForText(bookmarkPopup, '#connection-text', '请配置 Token');

            await bookmarkPopup.fill('#server-url', baseUrl);
            await bookmarkPopup.fill('#api-token', ctx.auth.apiToken);
            await bookmarkPopup.click('#save-settings-btn');

            await waitForText(bookmarkPopup, '#connection-text', '已连接');
            await waitForOption(bookmarkPopup, '扩展验收/收藏');

            const managerPage = await waitForNewPage(
                runtime.context,
                () => bookmarkPopup.click('#open-manager-btn'),
                'manager tab',
            );
            assert(managerPage.url().startsWith(baseUrl), `manager tab url mismatch: ${managerPage.url()}`);
            await managerPage.close();

            const settingsPage = await waitForNewPage(
                runtime.context,
                () => bookmarkPopup.click('#open-settings-link'),
                'settings tab',
            );
            assert(
                settingsPage.url() === `${baseUrl}/settings` || settingsPage.url() === `${baseUrl}/login`,
                `settings tab url mismatch: ${settingsPage.url()}`,
            );
            await settingsPage.close();

            await bookmarkPopup.selectOption('#category', { label: '扩展验收/收藏' });
            await bookmarkPopup.click('#save-btn');
            await waitForText(bookmarkPopup, '#status', '书签保存成功');

            const bookmark = ctx.db.prepare(`
                SELECT b.id, b.url, b.title, b.category_id
                FROM bookmarks b
                WHERE b.url = ?
            `).get(bookmarkUrl) as { id: number; url: string; title: string; category_id: number | null } | undefined;

            assert(bookmark, 'bookmark save did not persist a row');
            assert(bookmark.title === bookmarkTitle, `bookmark title mismatch: ${bookmark.title}`);
            assert(bookmark.category_id === collectCategory.id, `bookmark category mismatch: ${bookmark.category_id}`);

            await bookmarkPopup.click('#snapshot-btn');
            await waitForText(bookmarkPopup, '#status', '快照已保存', 15000);

            const snapshot = ctx.db.prepare(`
                SELECT id, bookmark_id, filename
                FROM snapshots
                WHERE url = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(bookmarkUrl) as { id: number; bookmark_id: number | null; filename: string } | undefined;

            assert(snapshot, 'snapshot save did not persist a row');
            assert(snapshot.bookmark_id === bookmark.id, `snapshot bookmark link mismatch: ${snapshot.bookmark_id}`);
            const snapshotPath = path.join(ctx.paths.snapshotsDir, snapshot.filename);
            assert(fs.existsSync(snapshotPath), 'snapshot file was not created');
            const snapshotHtml = fs.readFileSync(snapshotPath, 'utf8');
            assert(snapshotHtml.includes('runtime-bookmark-marker'), 'snapshot content did not capture the bookmark fixture page');
        } finally {
            await bookmarkPopup.close();
        }

        const saveAllTarget = await runtime.context.newPage();
        await saveAllTarget.goto(`${fixtureServer.baseUrl}/save-all`, { waitUntil: 'domcontentloaded' });
        const saveAllUrl = saveAllTarget.url();
        const saveAllTitle = await saveAllTarget.title();

        const saveAllPopup = await openRuntimePopup(runtime.context, extensionId, {
            targetTitle: saveAllTitle,
            targetUrl: saveAllUrl,
        });

        try {
            await waitForInputValue(saveAllPopup, '#title', saveAllTitle);
            await waitForInputValue(saveAllPopup, '#url', saveAllUrl);
            await waitForText(saveAllPopup, '#connection-text', '已连接');
            await waitForOption(saveAllPopup, '扩展验收/同时保存');

            await saveAllPopup.selectOption('#category', { label: '扩展验收/同时保存' });
            await saveAllPopup.click('#save-all-btn');
            await waitForText(saveAllPopup, '#status', '快照已保存', 15000);

            const bookmark = ctx.db.prepare(`
                SELECT b.id, b.url, b.title, b.category_id
                FROM bookmarks b
                WHERE b.url = ?
            `).get(saveAllUrl) as { id: number; url: string; title: string; category_id: number | null } | undefined;

            assert(bookmark, 'save-all did not persist a bookmark row');
            assert(bookmark.title === saveAllTitle, `save-all bookmark title mismatch: ${bookmark.title}`);
            assert(bookmark.category_id === saveAllCategory.id, `save-all bookmark category mismatch: ${bookmark.category_id}`);

            const snapshot = ctx.db.prepare(`
                SELECT id, bookmark_id, filename
                FROM snapshots
                WHERE url = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(saveAllUrl) as { id: number; bookmark_id: number | null; filename: string } | undefined;

            assert(snapshot, 'save-all did not persist a snapshot row');
            assert(snapshot.bookmark_id === bookmark.id, `save-all snapshot bookmark link mismatch: ${snapshot.bookmark_id}`);
            const snapshotPath = path.join(ctx.paths.snapshotsDir, snapshot.filename);
            assert(fs.existsSync(snapshotPath), 'save-all snapshot file was not created');
            const snapshotHtml = fs.readFileSync(snapshotPath, 'utf8');
            assert(snapshotHtml.includes('runtime-save-all-marker'), 'save-all snapshot content did not capture the fixture page');
        } finally {
            await saveAllPopup.close();
        }

        const failurePopup = await openRuntimePopup(runtime.context, extensionId, {
            targetTitle: bookmarkTitle,
            targetUrl: bookmarkUrl,
        });

        try {
            await waitForText(failurePopup, '#connection-text', '已连接');
            await failurePopup.click('#settings-toggle');
            await failurePopup.fill('#api-token', 'invalid-token');
            await failurePopup.click('#save-settings-btn');
            await waitForText(failurePopup, '#connection-text', '未连接');
            await failurePopup.click('#save-btn');
            await waitForText(failurePopup, '#status', '未连接到服务器');
        } finally {
            await failurePopup.close();
        }

        const bookmarkCount = (ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count;
        const snapshotCount = (ctx.db.prepare('SELECT COUNT(*) AS count FROM snapshots').get() as { count: number }).count;

        console.log(JSON.stringify({
            issueId: 'R5-EXT-02',
            mode: 'real-extension-runtime',
            baseUrl,
            fixtureBaseUrl: fixtureServer.baseUrl,
            extensionId,
            seededCategories: ['扩展验收/收藏', '扩展验收/同时保存'],
            results: {
                runtimeLoaded: true,
                popupBoundToTargetPage: true,
                managerLinkOpened: true,
                settingsLinkOpened: true,
                bookmarkSaved: true,
                snapshotSaved: true,
                saveAllSaved: true,
                failurePromptVerified: true,
                bookmarkCount,
                snapshotCount,
            },
        }, null, 2));
    } finally {
        if (runtime) await runtime.close();
        if (fixtureServer) await fixtureServer.close();
        await ctx.cleanup();
        console.log(JSON.stringify({
            cleanup: {
                tempRoot: rootDir,
                tempRootCleaned: !fs.existsSync(rootDir),
            },
        }, null, 2));
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
