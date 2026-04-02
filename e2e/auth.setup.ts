import fs from 'fs';
import os from 'os';
import path from 'path';
import { request } from '@playwright/test';

export interface E2ETestEnv {
    runId: string;
    port: number;
    baseURL: string;
    tempRoot: string;
    dbPath: string;
    backupDir: string;
    snapshotsDir: string;
    envFilePath: string;
    storageRoot: string;
    storageStatePath: string;
    username: string;
    password: string;
    sessionSecret: string;
    apiToken: string;
}

function serializeEnv(values: Record<string, string>): string {
    return Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
        .concat('\n');
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveE2ETestEnv(): E2ETestEnv {
    const runId = process.env.PLAYWRIGHT_RUN_ID ?? 'default';
    const port = Number(process.env.PLAYWRIGHT_PORT || 4217);
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
    const tempRootBase = process.env.PLAYWRIGHT_TEMP_DIR ?? path.join(os.tmpdir(), 'bookmarks-manager-playwright');
    const tempRoot = path.join(tempRootBase, runId);

    return {
        runId,
        port,
        baseURL,
        tempRoot,
        dbPath: path.join(tempRoot, 'data', 'app.db'),
        backupDir: path.join(tempRoot, 'data', 'backups'),
        snapshotsDir: path.join(tempRoot, 'data', 'snapshots'),
        envFilePath: path.join(tempRoot, '.env.e2e'),
        storageRoot: path.join(tempRoot, 'storage'),
        storageStatePath: path.join(tempRoot, 'storage', 'auth.json'),
        username: process.env.AUTH_USERNAME ?? 'playwright',
        password: process.env.AUTH_PASSWORD ?? 'playwright-password',
        sessionSecret: process.env.SESSION_SECRET ?? 'playwright-session-secret-must-be-at-least-32-characters',
        apiToken: process.env.API_TOKEN ?? 'playwright-api-token',
    };
}

export function ensureE2ETestEnv(): E2ETestEnv {
    const env = resolveE2ETestEnv();

    fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
    fs.mkdirSync(env.storageRoot, { recursive: true });

    fs.writeFileSync(env.envFilePath, serializeEnv({
        DB_PATH: env.dbPath,
        BACKUP_DIR: env.backupDir,
        SNAPSHOTS_DIR: env.snapshotsDir,
        AUTH_USERNAME: env.username,
        AUTH_PASSWORD: env.password,
        SESSION_SECRET: env.sessionSecret,
        API_TOKEN: env.apiToken,
    }), 'utf8');

    return env;
}

export function getAuthCredentials(): Pick<E2ETestEnv, 'username' | 'password' | 'apiToken'> {
    const env = resolveE2ETestEnv();
    return { username: env.username, password: env.password, apiToken: env.apiToken };
}

export function createCsrfHeaders(baseURL: string): Record<string, string> {
    const url = new URL(baseURL);
    return {
        host: url.host,
        origin: url.origin,
        referer: `${url.origin}/`,
    };
}

export function createBearerHeaders(token: string, baseURL: string): Record<string, string> {
    return { ...createCsrfHeaders(baseURL), authorization: `Bearer ${token}` };
}

async function waitForServer(baseURL: string, timeoutMs: number = 60_000): Promise<void> {
    const ctx = await request.newContext({ baseURL });
    const startedAt = Date.now();

    try {
        while (Date.now() - startedAt < timeoutMs) {
            try {
                const response = await ctx.get('/login');
                if (response.ok()) return;
            } catch {
            }
            await wait(500);
        }
    } finally {
        await ctx.dispose();
    }

    throw new Error(`Timed out waiting for test server at ${baseURL}`);
}

export async function loginAndSaveStorageState(): Promise<string> {
    const env = ensureE2ETestEnv();
    await waitForServer(env.baseURL);

    const ctx = await request.newContext({
        baseURL: env.baseURL,
        extraHTTPHeaders: createCsrfHeaders(env.baseURL),
    });

    try {
        await ctx.post('/login', {
            form: {
                username: env.username,
                password: env.password,
            },
        });

        const authCheck = await ctx.get('/api/user-info');
        if (!authCheck.ok()) {
            throw new Error(`Authentication bootstrap failed with status ${authCheck.status()}`);
        }

        await ctx.storageState({ path: env.storageStatePath });
        return env.storageStatePath;
    } finally {
        await ctx.dispose();
    }
}
