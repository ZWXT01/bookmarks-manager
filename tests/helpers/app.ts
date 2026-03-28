import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FastifyInstance } from 'fastify';

import { buildApp, type BuildAppOptions } from '../../src/app';
import type { Db } from '../../src/db';
import { loginWithSession, type LoginSessionOptions, type SessionAuthResult } from './auth';

export interface TestAppPaths {
    rootDir: string;
    dbPath: string;
    backupDir: string;
    snapshotsDir: string;
    envFilePath: string;
}

export interface TestAppAuth {
    username: string;
    password: string;
    apiToken: string;
    baseUrl: string;
    origin: string;
    referer: string;
}

export interface CreateTestAppOptions extends Omit<BuildAppOptions, 'db' | 'dbPath' | 'envFilePath' | 'backupDir' | 'snapshotsDir' | 'staticApiToken' | 'sessionSecret'> {
    username?: string;
    password?: string;
    apiToken?: string;
    sessionSecret?: string;
    baseUrl?: string;
    tempPrefix?: string;
}

export interface TestAppContext {
    app: FastifyInstance;
    db: Db;
    paths: TestAppPaths;
    auth: TestAppAuth;
    login: (overrides?: Partial<Pick<LoginSessionOptions, 'username' | 'password' | 'remember'>>) => Promise<SessionAuthResult>;
    cleanup: () => Promise<void>;
}

const testTempDirs = new Set<string>();

function writeEnvFile(envFilePath: string, values: Record<string, string>): void {
    fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
    const body = Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
        .concat('\n');
    fs.writeFileSync(envFilePath, body, 'utf8');
}

function applyEnv(values: Record<string, string>): () => void {
    const previous = new Map<string, string | undefined>();

    for (const [key, value] of Object.entries(values)) {
        previous.set(key, process.env[key]);
        process.env[key] = value;
    }

    return () => {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };
}

export function createTestTempDir(prefix: string = 'bookmarks-manager-test-'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    testTempDirs.add(dir);
    return dir;
}

export function cleanupTestTempDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
    testTempDirs.delete(dir);
}

export function cleanupTestTempDirs(): void {
    for (const dir of [...testTempDirs]) {
        cleanupTestTempDir(dir);
    }
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestAppContext> {
    const rootDir = createTestTempDir(options.tempPrefix ?? 'bookmarks-manager-test-');
    const dbPath = path.join(rootDir, 'data', 'app.db');
    const backupDir = path.join(rootDir, 'data', 'backups');
    const snapshotsDir = path.join(rootDir, 'data', 'snapshots');
    const envFilePath = path.join(rootDir, '.env.test');
    const baseUrl = options.baseUrl ?? 'http://127.0.0.1';
    const base = new URL(baseUrl);

    const username = options.username ?? 'test-admin';
    const password = options.password ?? 'test-password';
    const apiToken = options.apiToken ?? 'test-api-token';
    const sessionSecret = options.sessionSecret ?? 'test-session-secret-must-be-at-least-32-characters-long';

    const envValues = {
        ENV_FILE_PATH: envFilePath,
        DB_PATH: dbPath,
        BACKUP_DIR: backupDir,
        SNAPSHOTS_DIR: snapshotsDir,
        AUTH_USERNAME: username,
        AUTH_PASSWORD: password,
        SESSION_SECRET: sessionSecret,
        API_TOKEN: apiToken,
    };

    writeEnvFile(envFilePath, envValues);
    const restoreEnv = applyEnv(envValues);

    try {
        const { app, db } = await buildApp({
            ...options,
            dbPath,
            envFilePath,
            backupDir,
            snapshotsDir,
            staticApiToken: apiToken,
            sessionSecret,
            backupEnabled: options.backupEnabled ?? false,
            periodicCheckEnabled: options.periodicCheckEnabled ?? false,
            logLevel: options.logLevel ?? 'error',
        });

        let cleaned = false;

        return {
            app,
            db,
            paths: { rootDir, dbPath, backupDir, snapshotsDir, envFilePath },
            auth: {
                username,
                password,
                apiToken,
                baseUrl,
                origin: base.origin,
                referer: `${base.origin}/`,
            },
            login: (overrides = {}) => loginWithSession(app, {
                baseUrl,
                username: overrides.username ?? username,
                password: overrides.password ?? password,
                remember: overrides.remember,
            }),
            cleanup: async () => {
                if (cleaned) return;
                cleaned = true;

                try {
                    await app.close();
                } finally {
                    restoreEnv();
                    cleanupTestTempDir(rootDir);
                }
            },
        };
    } catch (error) {
        restoreEnv();
        cleanupTestTempDir(rootDir);
        throw error;
    }
}
