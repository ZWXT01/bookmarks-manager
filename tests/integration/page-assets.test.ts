import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestAppContext } from '../helpers/app';
import { createSessionHeaders } from '../helpers/auth';
import { seedJob } from '../helpers/factories';

const staticCssHref = '/public/tailwind.generated.css';
const runtimeTailwindHref = '/public/lib/tailwind.js';
const runtimeWarningText = 'cdn.tailwindcss.com should not be used in production';

describe('integration: page assets', () => {
    let ctx: TestAppContext;

    beforeEach(async () => {
        ctx = await createTestApp();
    }, 30000);

    afterEach(async () => {
        if (ctx) await ctx.cleanup();
    }, 30000);

    it('serves the login page with the static tailwind asset only', async () => {
        const response = await ctx.app.inject({
            method: 'GET',
            url: '/login',
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain(staticCssHref);
        expect(response.body).not.toContain(runtimeTailwindHref);
        expect(response.body).not.toContain(runtimeWarningText);
    });

    it('serves authenticated pages with the static tailwind asset only', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);

        for (const pageUrl of ['/', '/settings', '/jobs', '/snapshots']) {
            const response = await ctx.app.inject({
                method: 'GET',
                url: pageUrl,
                headers,
            });

            expect(response.statusCode, `unexpected status for ${pageUrl}`).toBe(200);
            expect(response.body, `missing static css on ${pageUrl}`).toContain(staticCssHref);
            expect(response.body, `runtime tailwind leaked back on ${pageUrl}`).not.toContain(runtimeTailwindHref);
            expect(response.body, `runtime tailwind warning shim leaked back on ${pageUrl}`).not.toContain(runtimeWarningText);
        }
    });

    it('renders the settings page with the ai diagnostic shell and selectors', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);

        const response = await ctx.app.inject({
            method: 'GET',
            url: '/settings',
            headers,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('data-testid="ai-test-btn"');
        expect(response.body).toContain('data-testid="ai-test-result"');
        expect(response.body).toContain('data-testid="ai-base-url-input"');
        expect(response.body).toContain('data-testid="ai-api-key-input"');
        expect(response.body).toContain('data-testid="ai-model-input"');
        expect(response.body).toContain('基础连通正常，聊天补全未通过');
        expect(response.body).toContain('https://grok2api.1018666.xyz/v1');
        expect(response.body).not.toContain('grop2api.1018666.xyz');
    });

    it('serves the generated tailwind asset as a static file', async () => {
        const response = await ctx.app.inject({
            method: 'GET',
            url: staticCssHref,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('.bg-slate-50');
        expect(response.body).toContain('.max-w-screen-2xl');
    });

    it('renders template modal shells with stable selectors and explicit viewport height bounds', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);

        const response = await ctx.app.inject({
            method: 'GET',
            url: '/',
            headers,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('data-testid="template-select-modal"');
        expect(response.body).toContain('data-testid="template-select-panel"');
        expect(response.body).toContain('data-testid="template-tab-custom"');
        expect(response.body).toContain('data-testid="template-tab-preset"');
        expect(response.body).toContain('data-testid="preset-template-card"');
        expect(response.body).toContain('data-testid="copy-preset-template-button"');
        expect(response.body).toContain('data-testid="use-preset-template-button"');
        expect(response.body).toContain('data-testid="template-edit-modal"');
        expect(response.body).toContain('data-testid="template-edit-panel"');
        expect(response.body).toContain('data-testid="template-edit-body"');
        expect(response.body).toContain('data-testid="template-edit-footer"');
        expect(response.body).toContain('data-testid="template-edit-save"');
        expect(response.body).toContain('data-testid="template-edit-cancel"');
        expect(response.body).toContain('data-testid="template-edit-name-input"');
        expect(response.body).toContain('style="max-height: calc(100vh - 2rem);"');
        expect(response.body).not.toContain('max-h-[80vh]');
        expect(response.body).not.toContain('max-h-[85vh]');
    });

    it('renders the ai organize modal shell with stable selectors for browser regression', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);

        const response = await ctx.app.inject({
            method: 'GET',
            url: '/',
            headers,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('data-testid="open-ai-organize"');
        expect(response.body).toContain('data-testid="ai-organize-modal"');
        expect(response.body).toContain('data-testid="ai-organize-panel"');
        expect(response.body).toContain('data-testid="organize-phase-idle"');
        expect(response.body).toContain('data-testid="organize-start"');
        expect(response.body).toContain('data-testid="organize-assigning-cancel"');
        expect(response.body).toContain("organizePhase === 'error' ? 'organize-phase-error' : 'organize-phase-failed'");
        expect(response.body).toContain("organizePhase === 'error' ? 'organize-error-cancel' : 'organize-failed-cancel'");
        expect(response.body).toContain("organizePhase === 'error' ? 'organize-error-retry' : 'organize-failed-retry'");
        expect(response.body).toContain("organizePhase === 'applied' ? 'organize-phase-applied' : 'organize-phase-preview'");
        expect(response.body).toContain('data-testid="organize-progress-summary"');
        expect(response.body).toContain('data-testid="organize-open-job"');
    });

    it('renders import and export shells with stable selectors for browser regression', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);

        const response = await ctx.app.inject({
            method: 'GET',
            url: '/',
            headers,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('data-testid="import-form"');
        expect(response.body).toContain('data-testid="import-file-input"');
        expect(response.body).toContain('data-testid="import-override-category"');
        expect(response.body).toContain('data-testid="import-default-category"');
        expect(response.body).toContain('data-testid="import-skip-duplicates"');
        expect(response.body).toContain('data-testid="import-submit"');
        expect(response.body).toContain('data-testid="import-progress-modal"');
        expect(response.body).toContain('data-testid="import-progress-panel"');
        expect(response.body).toContain('data-testid="import-progress-value"');
        expect(response.body).toContain('data-testid="import-progress-bar"');
        expect(response.body).toContain('data-testid="import-progress-fill"');
        expect(response.body).toContain('data-testid="import-progress-summary"');
        expect(response.body).toContain('data-testid="import-progress-cancel"');
        expect(response.body).toContain('data-testid="open-export-modal"');
        expect(response.body).toContain('data-testid="export-modal"');
        expect(response.body).toContain('data-testid="export-panel"');
        expect(response.body).toContain('data-testid="export-scope-select"');
        expect(response.body).toContain('data-testid="export-format-select"');
        expect(response.body).toContain('data-testid="export-cancel"');
        expect(response.body).toContain('data-testid="export-download"');
    });

    it('renders backup modal shells and job detail selectors for browser regression', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);
        const job = seedJob(ctx.db, {
            type: 'check',
            status: 'running',
            total: 4,
            processed: 1,
            inserted: 0,
            skipped: 0,
            failed: 0,
            message: '检查中：示例任务',
        });

        const indexResponse = await ctx.app.inject({
            method: 'GET',
            url: '/',
            headers,
        });

        expect(indexResponse.statusCode).toBe(200);
        expect(indexResponse.body).toContain('data-testid="open-backup-modal"');
        expect(indexResponse.body).toContain('data-testid="backup-modal"');
        expect(indexResponse.body).toContain('data-testid="backup-panel"');
        expect(indexResponse.body).toContain('data-testid="backup-run-now"');
        expect(indexResponse.body).toContain('data-testid="manual-backup-row"');
        expect(indexResponse.body).toContain('data-testid="backup-restore-button"');
        expect(indexResponse.body).toContain('data-testid="backup-delete-button"');
        expect(indexResponse.body).toContain('data-testid="backup-upload-form"');
        expect(indexResponse.body).toContain('data-testid="backup-upload-input"');
        expect(indexResponse.body).toContain('data-testid="backup-upload-submit"');

        const jobResponse = await ctx.app.inject({
            method: 'GET',
            url: `/jobs/${job.id}`,
            headers,
        });

        expect(jobResponse.statusCode).toBe(200);
        expect(jobResponse.body).toContain('data-testid="job-detail-page"');
        expect(jobResponse.body).toContain('data-testid="job-status"');
        expect(jobResponse.body).toContain('data-testid="job-message"');
        expect(jobResponse.body).toContain('data-testid="job-updated"');
        expect(jobResponse.body).toContain('data-testid="job-bar"');
        expect(jobResponse.body).toContain('data-testid="job-current-item"');
        expect(jobResponse.body).toContain('data-testid="job-progress-summary"');
        expect(jobResponse.body).toContain('data-testid="job-progress"');
        expect(jobResponse.body).toContain('data-testid="job-total"');
        expect(jobResponse.body).toContain('data-testid="job-inserted"');
        expect(jobResponse.body).toContain('data-testid="job-skipped"');
        expect(jobResponse.body).toContain('data-testid="job-failed"');
        expect(jobResponse.body).toContain('data-testid="cancel-job-btn"');
    });

    it('renders jobs list and snapshots destructive-action selectors for browser regression', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);
        const emptyJobsResponse = await ctx.app.inject({
            method: 'GET',
            url: '/jobs',
            headers,
        });

        expect(emptyJobsResponse.statusCode).toBe(200);
        expect(emptyJobsResponse.body).toContain('data-testid="jobs-page"');
        expect(emptyJobsResponse.body).toContain('data-testid="jobs-clear-completed"');
        expect(emptyJobsResponse.body).toContain('data-testid="jobs-clear-all"');
        expect(emptyJobsResponse.body).toContain('data-testid="jobs-table"');
        expect(emptyJobsResponse.body).toContain('data-testid="jobs-table-body"');
        expect(emptyJobsResponse.body).toContain('data-testid="jobs-empty-state"');

        seedJob(ctx.db, {
            type: 'check',
            status: 'done',
            total: 1,
            processed: 1,
            inserted: 1,
            skipped: 0,
            failed: 0,
            message: 'jobs page selector seed',
        });

        const jobsResponse = await ctx.app.inject({
            method: 'GET',
            url: '/jobs',
            headers,
        });

        expect(jobsResponse.statusCode).toBe(200);
        expect(jobsResponse.body).toContain('data-testid="jobs-row"');
        expect(jobsResponse.body).toContain('data-testid="jobs-row-link"');

        const snapshotsResponse = await ctx.app.inject({
            method: 'GET',
            url: '/snapshots',
            headers,
        });

        expect(snapshotsResponse.statusCode).toBe(200);
        expect(snapshotsResponse.body).toContain('data-testid="snapshots-page"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-search-input"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-date-filter"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-clear-filter"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshots-select-all"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshots-batch-delete"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-list"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshots-empty-state"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-row"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-checkbox"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-title"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-view-link"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-download-link"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-delete-button"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-delete-modal"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-delete-cancel"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-delete-confirm"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-batch-delete-modal"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-batch-delete-confirm"');
    });
});
