import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright';

interface CommandResult {
    command: string[];
    durationMs: number;
    stdout: string;
    stderr: string;
}

interface SmokeResult {
    projectName: string;
    containerName: string;
    baseUrl: string;
    dataDir: string;
    createdBookmarkTitle: string;
    dbPath: string;
    dbSizeBytes: number;
    checkedPages: string[];
    restartVerified: boolean;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticCssHref = '/public/tailwind.generated.css';
const runtimeTailwindHref = '/public/lib/tailwind.js';
const runtimeWarningText = 'cdn.tailwindcss.com should not be used in production';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeName(value: string): string {
    return value.replace(/[^a-z0-9-]/g, '-');
}

async function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('failed to allocate free port')));
                return;
            }
            const port = address.port;
            server.close((error) => {
                if (error) reject(error);
                else resolve(port);
            });
        });
    });
}

function tailText(value: string, maxChars = 1200): string {
    const trimmed = value.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return trimmed.slice(trimmed.length - maxChars);
}

async function runCommand(
    command: string,
    args: string[],
    options: {
        allowFailure?: boolean;
    } = {},
): Promise<CommandResult> {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: repoRoot,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(text);
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(text);
        });

        child.on('error', reject);
        child.on('close', (code) => {
            const result: CommandResult = {
                command: [command, ...args],
                durationMs: Date.now() - startedAt,
                stdout,
                stderr,
            };

            if (code !== 0 && !options.allowFailure) {
                reject(new Error(`${result.command.join(' ')} failed with code ${code}\n${tailText(stderr || stdout)}`));
                return;
            }

            resolve(result);
        });
    });
}

async function waitForHttpReady(url: string, timeoutMs: number): Promise<string> {
    const startedAt = Date.now();
    let lastError: unknown = null;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url, { redirect: 'manual' });
            if (response.status === 200) {
                return await response.text();
            }
            lastError = new Error(`unexpected status ${response.status}`);
        } catch (error) {
            lastError = error;
        }

        await sleep(1000);
    }

    throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function buildComposeArgs(composeFilePath: string, projectName: string, extraArgs: string[]): string[] {
    return ['compose', '-p', projectName, '-f', composeFilePath, ...extraArgs];
}

function writeComposeFile(composeFilePath: string, options: {
    containerName: string;
    dataDir: string;
    port: number;
    username: string;
    password: string;
    sessionSecret: string;
    apiToken: string;
}) {
    const composeBody = [
        'services:',
        '  app:',
        `    build: ${JSON.stringify(repoRoot)}`,
        `    container_name: ${JSON.stringify(options.containerName)}`,
        '    restart: "no"',
        '    environment:',
        '      PORT: "8080"',
        '      DB_PATH: "/data/app.db"',
        '      CHECK_CONCURRENCY: "10"',
        '      CHECK_TIMEOUT_MS: "8000"',
        '      CHECK_RETRIES: "0"',
        '      CHECK_RETRY_DELAY_MS: "0"',
        `      AUTH_USERNAME: ${JSON.stringify(options.username)}`,
        `      AUTH_PASSWORD: ${JSON.stringify(options.password)}`,
        `      SESSION_SECRET: ${JSON.stringify(options.sessionSecret)}`,
        `      API_TOKEN: ${JSON.stringify(options.apiToken)}`,
        '    volumes:',
        `      - ${JSON.stringify(`${options.dataDir}:/data`)}`,
        '    ports:',
        `      - ${JSON.stringify(`127.0.0.1:${options.port}:8080`)}`,
        '',
    ].join('\n');

    fs.writeFileSync(composeFilePath, composeBody, 'utf8');
}

async function login(page: Page, baseUrl: string, username: string, password: string) {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: '请输入用户名' }).fill(username);
    await page.getByRole('textbox', { name: '请输入密码' }).fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(`${baseUrl}/`);
}

async function waitForBookmark(page: Page, title: string, timeoutMs: number) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const titles = (await page.getByTestId('bookmark-row-title').allTextContents()).map((value) => value.trim());
        if (titles.includes(title)) return;
        await sleep(200);
    }

    throw new Error(`Timed out waiting for bookmark ${title}`);
}

async function collectComposeLogs(composeFilePath: string, projectName: string): Promise<string> {
    const result = await runCommand('docker', buildComposeArgs(composeFilePath, projectName, ['logs', '--no-color']), {
        allowFailure: true,
    });
    return tailText([result.stdout, result.stderr].filter(Boolean).join('\n'), 4000);
}

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-compose-smoke-'));
    const dataDir = path.join(tempRoot, 'data');
    const composeFilePath = path.join(tempRoot, 'docker-compose.smoke.yml');
    const projectName = sanitizeName(`bookmarks-delivery-smoke-${Date.now()}`);
    const containerName = `${projectName}-app`;
    const port = await getFreePort();
    const username = 'smoke-admin';
    const password = 'smoke-password';
    const sessionSecret = 'smoke-session-secret-must-be-at-least-32-characters';
    const apiToken = 'smoke-api-token';
    const baseUrl = `http://127.0.0.1:${port}`;
    const dbPath = path.join(dataDir, 'app.db');

    fs.mkdirSync(dataDir, { recursive: true });
    writeComposeFile(composeFilePath, {
        containerName,
        dataDir,
        port,
        username,
        password,
        sessionSecret,
        apiToken,
    });

    let browser: Browser | null = null;
    let checkedPages = ['login'];

    try {
        await runCommand('docker', buildComposeArgs(composeFilePath, projectName, ['up', '-d', '--build']));

        const loginHtml = await waitForHttpReady(`${baseUrl}/login`, 180000);
        assert(loginHtml.includes(staticCssHref), 'login page is missing static tailwind asset');
        assert(!loginHtml.includes(runtimeTailwindHref), 'login page regressed to runtime tailwind asset');
        assert(!loginHtml.includes(runtimeWarningText), 'login page regressed to runtime tailwind warning');

        const cssResponse = await fetch(`${baseUrl}${staticCssHref}`);
        assert.equal(cssResponse.status, 200, 'static tailwind asset is not reachable in compose smoke');

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

        await login(page, baseUrl, username, password);

        const createdBookmarkTitle = `Compose Smoke Bookmark ${Date.now()}`;
        await page.getByTestId('open-add-bookmark').click();
        await page.getByTestId('add-bookmark-modal').waitFor({ state: 'visible' });
        await page.getByTestId('add-bookmark-url-input').fill('https://example.com/compose-smoke');
        await page.getByTestId('add-bookmark-title-input').fill(createdBookmarkTitle);
        await page.getByTestId('add-bookmark-submit').click();
        await waitForBookmark(page, createdBookmarkTitle, 10000);

        await page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('ai-test-btn').waitFor({ state: 'visible' });
        checkedPages.push('settings');

        await page.goto(`${baseUrl}/jobs`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('jobs-page').waitFor({ state: 'visible' });
        checkedPages.push('jobs');

        await page.goto(`${baseUrl}/snapshots`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('snapshots-page').waitFor({ state: 'visible' });
        checkedPages.push('snapshots');

        await runCommand('docker', buildComposeArgs(composeFilePath, projectName, ['restart', 'app']));
        await waitForHttpReady(`${baseUrl}/login`, 120000);

        const postRestartPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await login(postRestartPage, baseUrl, username, password);
        await waitForBookmark(postRestartPage, createdBookmarkTitle, 10000);
        checkedPages.push('post-restart-home');
        await postRestartPage.close();

        assert(fs.existsSync(dbPath), `compose smoke DB file missing at ${dbPath}`);
        const dbStat = fs.statSync(dbPath);
        assert(dbStat.size > 0, 'compose smoke DB file is empty');

        console.log(JSON.stringify({
            projectName,
            containerName,
            baseUrl,
            dataDir,
            createdBookmarkTitle,
            dbPath,
            dbSizeBytes: dbStat.size,
            checkedPages,
            restartVerified: true,
        } satisfies SmokeResult, null, 2));
    } catch (error) {
        const logs = await collectComposeLogs(composeFilePath, projectName).catch(() => '');
        const details = error instanceof Error ? error.stack ?? error.message : String(error);
        throw new Error(logs ? `${details}\n\nDocker logs tail:\n${logs}` : details);
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }

        await runCommand('docker', buildComposeArgs(composeFilePath, projectName, ['down', '--remove-orphans', '--rmi', 'local']), {
            allowFailure: true,
        }).catch(() => {});

        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
