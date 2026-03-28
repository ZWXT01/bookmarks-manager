import { beforeEach, afterEach } from 'vitest';

import { resetAuthStateForTests } from '../../src/auth';
import { resetJobRuntimeForTests } from '../../src/jobs';
import { cleanupTestTempDirs } from './app';

async function resetTestGlobals(): Promise<void> {
    await resetJobRuntimeForTests();
    resetAuthStateForTests();
    cleanupTestTempDirs();
}

beforeEach(async () => {
    await resetTestGlobals();
});

afterEach(async () => {
    await resetTestGlobals();
});
