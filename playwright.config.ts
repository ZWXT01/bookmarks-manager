import path from 'path';
import { defineConfig } from '@playwright/test';

import { resolveE2ETestEnv } from './e2e/auth.setup';

const runId = process.env.PLAYWRIGHT_RUN_ID ?? `${Date.now()}-${process.pid}`;
process.env.PLAYWRIGHT_RUN_ID = runId;

const env = resolveE2ETestEnv();
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
    testDir: './e2e',
    testMatch: ['**/*.spec.ts'],
    fullyParallel: true,
    globalSetup: './e2e/global.setup.ts',
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 2 : undefined,
    outputDir: path.join(env.tempRoot, 'test-results'),
    snapshotPathTemplate: path.join(env.tempRoot, 'snapshots', '{projectName}', '{testFilePath}', '{arg}{ext}'),
    use: {
        baseURL: env.baseURL,
        storageState: env.storageStatePath,
        trace: 'retain-on-failure',
        testIdAttribute: 'data-testid',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
            },
        },
    ],
    webServer: useExternalServer ? undefined : {
        command: 'tsx src/index.ts',
        url: env.baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            ...process.env,
            ENV_FILE_PATH: env.envFilePath,
            PORT: String(env.port),
            DB_PATH: env.dbPath,
            BACKUP_DIR: env.backupDir,
            SNAPSHOTS_DIR: env.snapshotsDir,
            AUTH_USERNAME: env.username,
            AUTH_PASSWORD: env.password,
            SESSION_SECRET: env.sessionSecret,
            API_TOKEN: env.apiToken,
        },
    },
});
