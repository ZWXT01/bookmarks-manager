import fs from 'fs';
import http from 'http';
import path from 'path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { createTestApp } from '../tests/helpers/app';
import { seedCategoryTree } from '../tests/helpers/factories';

interface PopupHarnessState {
    initialServerUrl: string;
    initialApiToken: string;
    targetUrl: string;
    targetTitle: string;
    pageData: {
        content: string;
        title: string;
        method: 'native' | 'singlefile';
        elapsed: number;
    };
}

interface PopupHarnessSession {
    context: BrowserContext;
    page: Page;
}

interface StaticServerHandle {
    baseUrl: string;
    close: () => Promise<void>;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function contentTypeFor(filePath: string): string {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.svg')) return 'image/svg+xml';
    if (filePath.endsWith('.png')) return 'image/png';
    return 'application/octet-stream';
}

async function createStaticServer(rootDir: string): Promise<StaticServerHandle> {
    const server = http.createServer((req, res) => {
        const rawUrl = req.url ?? '/';
        const pathname = decodeURIComponent(rawUrl.split('?')[0] || '/');
        const relativePath = pathname === '/' ? '/popup.html' : pathname;
        const resolvedPath = path.resolve(rootDir, `.${relativePath}`);

        if (!resolvedPath.startsWith(rootDir)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('forbidden');
            return;
        }

        if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
        }

        res.writeHead(200, { 'Content-Type': contentTypeFor(resolvedPath) });
        fs.createReadStream(resolvedPath).pipe(res);
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    assert(address && typeof address === 'object', 'popup static server failed to bind');

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        },
    };
}

async function capturePageData(browser: Browser, url: string): Promise<PopupHarnessState['pageData'] & { url: string }> {
    const page = await browser.newPage();
    try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        assert(response, `failed to load target page: ${url}`);

        return {
            url: page.url(),
            title: await page.title(),
            content: await page.content(),
            method: 'native',
            elapsed: 120,
        };
    } finally {
        await page.close();
    }
}

function buildPopupInitScript(state: PopupHarnessState): string {
    return `
(() => {
    const popupState = ${JSON.stringify(state)};
    const syncStore = {
        serverUrl: popupState.initialServerUrl,
        apiToken: popupState.initialApiToken,
    };
    const localStore = {};
    const runtimeState = { lastError: null };
    const targetTab = {
        id: 1,
        title: popupState.targetTitle,
        url: popupState.targetUrl,
    };
    const openedTabs = [];

    function clone(value) {
        return value === undefined ? value : JSON.parse(JSON.stringify(value));
    }

    function pickStorageValues(store, keys) {
        if (keys == null) return clone(store);

        if (Array.isArray(keys)) {
            const result = {};
            for (const key of keys) {
                if (store[key] !== undefined) result[key] = clone(store[key]);
            }
            return result;
        }

        if (typeof keys === 'string') {
            return { [keys]: clone(store[keys]) };
        }

        const result = {};
        for (const [key, fallback] of Object.entries(keys)) {
            result[key] = store[key] !== undefined ? clone(store[key]) : fallback;
        }
        return result;
    }

    function queueCallback(callback, value) {
        if (typeof callback !== 'function') return;
        queueMicrotask(() => callback(value));
    }

    const chromeMock = {
        storage: {
            sync: {
                get(keys, callback) {
                    queueCallback(callback, pickStorageValues(syncStore, keys));
                },
                set(items, callback) {
                    Object.assign(syncStore, clone(items));
                    queueCallback(callback, undefined);
                },
            },
            local: {
                get(keys, callback) {
                    queueCallback(callback, pickStorageValues(localStore, keys));
                },
                set(items, callback) {
                    Object.assign(localStore, clone(items));
                    queueCallback(callback, undefined);
                },
            },
        },
        tabs: {
            async query() {
                return [clone(targetTab)];
            },
            sendMessage(_tabId, _message, callback) {
                runtimeState.lastError = null;
                queueMicrotask(() => {
                    if (typeof callback === 'function') {
                        callback({
                            success: true,
                            data: clone(popupState.pageData),
                        });
                    }
                });
            },
            async create(details) {
                if (details && details.url) openedTabs.push(details.url);
                return { id: openedTabs.length + 100, url: details && details.url ? details.url : '' };
            },
        },
        scripting: {
            async executeScript() {
                return [];
            },
        },
        runtime: {},
    };

    Object.defineProperty(chromeMock.runtime, 'lastError', {
        configurable: true,
        enumerable: true,
        get() {
            return runtimeState.lastError;
        },
    });

    try {
        window.chrome = chromeMock;
    } catch (_error) {
        Object.assign(window.chrome || {}, chromeMock);
    }

    Object.defineProperty(window, '__popupHarness', {
        configurable: true,
        value: {
            syncStore,
            localStore,
            openedTabs,
            targetTab,
        },
    });
})();
`;
}

async function openPopupHarness(browser: Browser, popupBaseUrl: string, state: PopupHarnessState): Promise<PopupHarnessSession> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const debugPopup = process.env.DEBUG_EXTENSION_HARNESS === '1';

    if (debugPopup) {
        page.on('console', (message) => {
            console.log(`[popup console][${message.type()}] ${message.text()}`);
        });
        page.on('pageerror', (error) => {
            console.log(`[popup pageerror] ${error.message}`);
        });
        page.on('requestfailed', (request) => {
            console.log(`[popup requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
        });
    }

    await page.addInitScript({ content: buildPopupInitScript(state) });

    await page.goto(`${popupBaseUrl}/popup.html`, { waitUntil: 'domcontentloaded' });

    return { context, page };
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

async function waitForOption(page: Page, label: string, timeout = 5000): Promise<void> {
    await pollUntil(
        async () => page.locator('#category option').evaluateAll((options) => options.map((option) => option.textContent || '')),
        (labels) => labels.includes(label),
        timeout,
        `#category options to include ${label}`,
    );
}

async function main() {
    const ctx = await createTestApp({
        tempPrefix: 'bookmarks-extension-roundtrip-',
        backupEnabled: false,
        periodicCheckEnabled: false,
    });

    let browser: Browser | null = null;
    let popupServer: StaticServerHandle | null = null;
    const rootDir = ctx.paths.rootDir;

    try {
        const baseUrl = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

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

        popupServer = await createStaticServer(path.join(process.cwd(), 'extension-new'));
        browser = await chromium.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true,
        });

        const capturedPage = await capturePageData(browser, `${baseUrl}/login`);
        const bookmarkPage = {
            ...capturedPage,
            url: `${baseUrl}/extension-fixture/bookmark`,
        };
        const saveAllPage = {
            ...capturedPage,
            url: `${baseUrl}/extension-fixture/save-all`,
        };

        const bookmarkSession = await openPopupHarness(browser, popupServer.baseUrl, {
            initialServerUrl: '',
            initialApiToken: '',
            targetUrl: bookmarkPage.url,
            targetTitle: bookmarkPage.title,
            pageData: bookmarkPage,
        });

        try {
            await waitForText(bookmarkSession.page, '#connection-text', '请配置 Token');
            const settingsExpanded = await bookmarkSession.page.evaluate(() => {
                const settings = document.getElementById('settings-content');
                return !!settings && !settings.classList.contains('hidden');
            });
            assert(settingsExpanded, 'settings should expand automatically when token is missing');

            await bookmarkSession.page.fill('#server-url', baseUrl);
            await bookmarkSession.page.fill('#api-token', ctx.auth.apiToken);
            await bookmarkSession.page.click('#save-settings-btn');

            await waitForText(bookmarkSession.page, '#connection-text', '已连接');
            await waitForOption(bookmarkSession.page, '扩展验收/收藏');

            await bookmarkSession.page.selectOption('#category', { label: '扩展验收/收藏' });
            await bookmarkSession.page.click('#save-btn');
            await waitForText(bookmarkSession.page, '#status', '书签保存成功');

            const bookmark = ctx.db.prepare(`
                SELECT b.id, b.url, b.title, b.category_id
                FROM bookmarks b
                WHERE b.url = ?
            `).get(bookmarkPage.url) as { id: number; url: string; title: string; category_id: number | null } | undefined;

            assert(bookmark, 'bookmark save did not persist a row');
            assert(bookmark.category_id === collectCategory.id, `bookmark category mismatch: ${bookmark.category_id}`);

            await bookmarkSession.page.click('#snapshot-btn');
            await waitForText(bookmarkSession.page, '#status', '快照已保存', 10000);

            const snapshot = ctx.db.prepare(`
                SELECT id, bookmark_id, filename
                FROM snapshots
                WHERE url = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(bookmarkPage.url) as { id: number; bookmark_id: number | null; filename: string } | undefined;

            assert(snapshot, 'snapshot save did not persist a row');
            assert(snapshot.bookmark_id === bookmark.id, `snapshot bookmark link mismatch: ${snapshot.bookmark_id}`);
            assert(fs.existsSync(path.join(ctx.paths.snapshotsDir, snapshot.filename)), 'snapshot file was not created');
        } finally {
            await bookmarkSession.context.close();
        }

        const saveAllSession = await openPopupHarness(browser, popupServer.baseUrl, {
            initialServerUrl: baseUrl,
            initialApiToken: ctx.auth.apiToken,
            targetUrl: saveAllPage.url,
            targetTitle: saveAllPage.title,
            pageData: saveAllPage,
        });

        try {
            await waitForText(saveAllSession.page, '#connection-text', '已连接');
            await waitForOption(saveAllSession.page, '扩展验收/同时保存');

            await saveAllSession.page.selectOption('#category', { label: '扩展验收/同时保存' });
            await saveAllSession.page.click('#save-all-btn');
            await waitForText(saveAllSession.page, '#status', '快照已保存', 10000);

            const bookmark = ctx.db.prepare(`
                SELECT b.id, b.url, b.title, b.category_id
                FROM bookmarks b
                WHERE b.url = ?
            `).get(saveAllPage.url) as { id: number; url: string; title: string; category_id: number | null } | undefined;

            assert(bookmark, 'save-all did not persist a bookmark row');
            assert(bookmark.category_id === saveAllCategory.id, `save-all bookmark category mismatch: ${bookmark.category_id}`);

            const snapshot = ctx.db.prepare(`
                SELECT id, bookmark_id, filename
                FROM snapshots
                WHERE url = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(saveAllPage.url) as { id: number; bookmark_id: number | null; filename: string } | undefined;

            assert(snapshot, 'save-all did not persist a snapshot row');
            assert(snapshot.bookmark_id === bookmark.id, `save-all snapshot bookmark link mismatch: ${snapshot.bookmark_id}`);
            assert(fs.existsSync(path.join(ctx.paths.snapshotsDir, snapshot.filename)), 'save-all snapshot file was not created');
        } finally {
            await saveAllSession.context.close();
        }

        const failureSession = await openPopupHarness(browser, popupServer.baseUrl, {
            initialServerUrl: baseUrl,
            initialApiToken: 'invalid-token',
            targetUrl: bookmarkPage.url,
            targetTitle: bookmarkPage.title,
            pageData: bookmarkPage,
        });

        try {
            await waitForText(failureSession.page, '#connection-text', '未连接');
            await failureSession.page.click('#save-btn');
            await waitForText(failureSession.page, '#status', '未连接到服务器');
        } finally {
            await failureSession.context.close();
        }

        const bookmarkCount = (ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count;
        const snapshotCount = (ctx.db.prepare('SELECT COUNT(*) AS count FROM snapshots').get() as { count: number }).count;

        console.log(JSON.stringify({
            issueId: 'R2-EXT-02',
            mode: 'popup-harness',
            baseUrl,
            popupBaseUrl: popupServer.baseUrl,
            seededCategories: ['扩展验收/收藏', '扩展验收/同时保存'],
            results: {
                tokenConfigured: true,
                bookmarkSaved: true,
                snapshotSaved: true,
                saveAllSaved: true,
                failurePromptVerified: true,
                bookmarkCount,
                snapshotCount,
            },
        }, null, 2));
    } finally {
        if (browser) await browser.close();
        if (popupServer) await popupServer.close();
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
