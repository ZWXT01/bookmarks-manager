import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

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

interface RemoteChromeHandle {
    browser: Browser;
    context: BrowserContext;
    cdp: RawCdpClient;
    userDataDir: string;
    chromeProcess: ChildProcess;
    close: () => Promise<void>;
}

interface CdpTargetInfo {
    targetId: string;
    type: string;
    url: string;
    title: string;
}

interface AttachedTargetHandle {
    target: CdpTargetInfo;
    sessionId: string;
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
      <p>action-popup-validation</p>
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

async function waitForFile(filePath: string, timeout = 10000): Promise<string> {
    return await pollUntil(
        async () => {
            try {
                return await fs.promises.readFile(filePath, 'utf8');
            } catch (error) {
                if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
                    return '';
                }
                throw error;
            }
        },
        (value) => value.length > 0,
        timeout,
        filePath,
    );
}

class RawCdpClient {
    private socket: WebSocket;
    private nextId = 1;
    private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

    constructor(wsUrl: string) {
        this.socket = new WebSocket(wsUrl);
    }

    async open(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.socket.addEventListener('open', () => resolve(), { once: true });
            this.socket.addEventListener('error', (event) => reject(event.error ?? new Error('websocket error')), { once: true });
        });

        this.socket.addEventListener('message', (event) => {
            const payload = JSON.parse(String(event.data)) as { id?: number; result?: any; error?: { message?: string } };
            if (!payload.id) return;

            const pending = this.pending.get(payload.id);
            if (!pending) return;
            this.pending.delete(payload.id);

            if (payload.error) pending.reject(new Error(payload.error.message ?? JSON.stringify(payload.error)));
            else pending.resolve(payload.result);
        });
    }

    async send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
        const id = this.nextId++;
        const message: { id: number; method: string; params: Record<string, unknown>; sessionId?: string } = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        this.socket.send(JSON.stringify(message));

        return await new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
    }

    close(): void {
        this.socket.close();
    }
}

async function launchRemoteChrome(extensionDir: string): Promise<RemoteChromeHandle> {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-extension-action-popup-'));
    const executablePath = chromium.executablePath();
    const chromeProcess = spawn(executablePath, [
        `--user-data-dir=${userDataDir}`,
        '--remote-debugging-port=0',
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        'about:blank',
    ], {
        stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    chromeProcess.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    const activePort = await waitForFile(path.join(userDataDir, 'DevToolsActivePort'));
    const [port, browserPath] = activePort.trim().split('\n');
    assert(port && browserPath, 'DevToolsActivePort is malformed');

    const cdp = new RawCdpClient(`ws://127.0.0.1:${port}${browserPath}`);
    await cdp.open();

    try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const context = browser.contexts()[0];
        assert(context, 'connectOverCDP did not expose a default browser context');

        return {
            browser,
            context,
            cdp,
            userDataDir,
            chromeProcess,
            close: async () => {
                cdp.close();
                try {
                    await browser.close();
                } finally {
                    chromeProcess.kill('SIGKILL');
                    fs.rmSync(userDataDir, { recursive: true, force: true });
                }
            },
        };
    } catch (error) {
        cdp.close();
        chromeProcess.kill('SIGKILL');
        fs.rmSync(userDataDir, { recursive: true, force: true });
        throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ''}`);
    }
}

async function getExtensionId(context: BrowserContext): Promise<string> {
    const page = context.pages()[0] || await context.newPage();
    await page.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });

    return await pollUntil(
        async () => {
            return await page.evaluate(() => {
                const manager = document.querySelector('extensions-manager');
                const managerRoot = manager && manager.shadowRoot;
                const itemList = managerRoot && managerRoot.querySelector('extensions-item-list');
                const listRoot = itemList && itemList.shadowRoot;
                const item = listRoot && listRoot.querySelector('extensions-item');
                return item ? item.getAttribute('id') : null;
            });
        },
        (value) => typeof value === 'string' && value.length > 0,
        5000,
        'extension id',
    );
}

async function getTargets(cdp: RawCdpClient): Promise<CdpTargetInfo[]> {
    const result = await cdp.send<{ targetInfos: CdpTargetInfo[] }>('Target.getTargets');
    return result.targetInfos;
}

async function attachToNewActionPopupTarget(
    cdp: RawCdpClient,
    popupHost: Page,
): Promise<AttachedTargetHandle> {
    const before = await getTargets(cdp);
    const beforeIds = new Set(before.map((target) => target.targetId));

    await popupHost.evaluate(async () => {
        await chrome.action.openPopup();
    });

    const popupTarget = await pollUntil(
        async () => {
            const after = await getTargets(cdp);
            return after.find((target) => !beforeIds.has(target.targetId) && target.type === 'page' && target.url.includes('/popup.html')) ?? null;
        },
        (target) => Boolean(target),
        5000,
        'action popup target',
    );

    const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
        targetId: popupTarget.targetId,
        flatten: true,
    });

    return { target: popupTarget, sessionId: attached.sessionId };
}

async function evaluateInTarget<T>(
    cdp: RawCdpClient,
    sessionId: string,
    expression: string,
    awaitPromise = false,
): Promise<T> {
    const result = await cdp.send<{
        result: {
            type: string;
            value?: T;
            description?: string;
        };
        exceptionDetails?: { text?: string };
    }>('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
    }, sessionId);

    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? `evaluation failed: ${expression}`);
    }

    return result.result.value as T;
}

async function main() {
    let fixtureServer: FixtureServerHandle | null = null;
    let remoteChrome: RemoteChromeHandle | null = null;

    try {
        fixtureServer = await createFixtureServer([
            {
                pathname: '/action-popup',
                title: 'Action Popup Fixture',
                marker: 'action-popup-marker',
                body: 'This fixture page is used to validate the real browser action popup binding.',
            },
        ]);

        remoteChrome = await launchRemoteChrome(path.join(process.cwd(), 'extension-new'));
        const extensionId = await getExtensionId(remoteChrome.context);

        const targetPage = await remoteChrome.context.newPage();
        await targetPage.goto(`${fixtureServer.baseUrl}/action-popup`, { waitUntil: 'domcontentloaded' });
        await targetPage.bringToFront();
        const targetUrl = targetPage.url();
        const targetTitle = await targetPage.title();

        const popupHost = await remoteChrome.context.newPage();
        await popupHost.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
        await targetPage.bringToFront();

        const attachedPopup = await attachToNewActionPopupTarget(remoteChrome.cdp, popupHost);
        await remoteChrome.cdp.send('Runtime.enable', {}, attachedPopup.sessionId);

        const popupState = await pollUntil(
            async () => {
                const titleValue = await evaluateInTarget<string | null>(
                    remoteChrome!.cdp,
                    attachedPopup.sessionId,
                    'document.getElementById("title") && document.getElementById("title").value',
                );
                const urlValue = await evaluateInTarget<string | null>(
                    remoteChrome!.cdp,
                    attachedPopup.sessionId,
                    'document.getElementById("url") && document.getElementById("url").value',
                );
                const activeTabs = await evaluateInTarget<Array<{ url?: string; title?: string; active?: boolean }>>(
                    remoteChrome!.cdp,
                    attachedPopup.sessionId,
                    '(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((tab) => ({ url: tab.url, title: tab.title, active: tab.active })))()',
                    true,
                );

                return { titleValue, urlValue, activeTabs };
            },
            (value) => value.titleValue === targetTitle && value.urlValue === targetUrl,
            5000,
            'action popup to bind to active target page',
        );

        const activeTargetTab = popupState.activeTabs.find((tab) => tab.url === targetUrl && tab.active === true) ?? null;
        assert(activeTargetTab, `action popup active tab mismatch: ${JSON.stringify(popupState.activeTabs)}`);

        console.log(JSON.stringify({
            issueId: 'R5-EXT-03',
            mode: 'action-popup-runtime',
            extensionId,
            popupTargetId: attachedPopup.target.targetId,
            fixtureBaseUrl: fixtureServer.baseUrl,
            targetUrl,
            targetTitle,
            results: {
                actionPopupOpened: true,
                popupBoundToActiveTargetPage: true,
                activeTabVisibleInsidePopup: true,
            },
        }, null, 2));
    } finally {
        if (remoteChrome) await remoteChrome.close();
        if (fixtureServer) await fixtureServer.close();
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
