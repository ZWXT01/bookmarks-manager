import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addJobFailure } from '../../src/jobs';
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
        expect(response.body).toContain('data-testid="login-page"');
        expect(response.body).toContain('data-testid="login-form"');
        expect(response.body).toContain('data-testid="login-theme-toggle"');
        expect(response.body).toContain('data-testid="login-username-input"');
        expect(response.body).toContain('data-testid="login-password-input"');
        expect(response.body).toContain('data-testid="login-submit"');
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
        expect(response.body).toContain('data-testid="settings-page"');
        expect(response.body).toContain('data-testid="settings-overview-card"');
        expect(response.body).toContain('data-testid="settings-ai-card"');
        expect(response.body).toContain('data-testid="settings-token-card"');
        expect(response.body).toContain('data-testid="ai-test-btn"');
        expect(response.body).toContain('data-testid="ai-test-result"');
        expect(response.body).toContain('data-testid="ai-base-url-input"');
        expect(response.body).toContain('data-testid="ai-api-key-input"');
        expect(response.body).toContain('data-testid="ai-model-input"');
        expect(response.body).toContain('data-testid="ai-batch-size-input"');
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
        expect(response.body).toContain('data-testid="ai-organize-body"');
        expect(response.body).toContain('style="max-height: calc(100vh - 2rem);"');
        expect(response.body).toContain('style="max-height: min(320px, 45vh);"');
        expect(response.body).toContain('min-h-0 flex-1 overflow-y-auto');
        expect(response.body).toContain('data-testid="organize-phase-idle"');
        expect(response.body).toContain('data-testid="organize-start"');
        expect(response.body).toContain('data-testid="organize-assigning-cancel"');
        expect(response.body).toContain("organizePhase === 'error' ? 'organize-phase-error' : 'organize-phase-failed'");
        expect(response.body).toContain("organizePhase === 'error' ? 'organize-error-cancel' : 'organize-failed-cancel'");
        expect(response.body).toContain("organizePhase === 'error' ? 'organize-error-retry' : 'organize-failed-retry'");
        expect(response.body).toContain("organizePhase === 'applied' ? 'organize-phase-applied' : 'organize-phase-preview'");
        expect(response.body).toContain('data-testid="organize-preview-guard"');
        expect(response.body).toContain('x-text="getOrganizePreviewGuardTitle()"');
        expect(response.body).toContain('x-text="getOrganizePreviewGuardMessage()"');
        expect(response.body).toContain('data-testid="organize-preview-list"');
        expect(response.body).toContain('data-testid="organize-preview-mobile-list"');
        expect(response.body).toContain('data-testid="organize-preview-desktop-table"');
        expect(response.body).toContain('data-testid="organize-preview-apply-all"');
        expect(response.body).toContain('data-testid="organize-preview-prev-page"');
        expect(response.body).toContain('data-testid="organize-preview-next-page"');
        expect(response.body).toContain('data-testid="organize-preview-discard"');
        expect(response.body).toContain('data-testid="organize-preview-apply"');
        expect(response.body).toContain('data-testid="organize-progress-summary"');
        expect(response.body).toContain('data-testid="organize-open-job"');
    });

    it('serves organize modal scripts that recover pending previews without reusing the guard for current runs', async () => {
        const response = await ctx.app.inject({
            method: 'GET',
            url: '/public/app.js',
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('organizePreviewGuardActive: false,');
        expect(response.body).toContain('organizeQueuedStart: null,');
        expect(response.body).toContain('getOrganizePreviewGuardTitle() {');
        expect(response.body).toContain("return '上一次任务尚未完成';");
        expect(response.body).toContain("return '请先应用建议或放弃建议。';");
        expect(response.body).toContain('async recoverPendingPlan(planId) {');
        expect(response.body).toContain("if (res.status === 409 && data?.pendingPlanId) {");
        expect(response.body).toContain("this.showToast(previewGuardActive ? '已放弃上一次建议' : '已放弃建议', 'info');");
        expect(response.body).toContain('await this.resumeQueuedOrganizeStart();');
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
        expect(response.body).toContain('data-testid="current-job-banner"');
        expect(response.body).toContain('data-testid="current-job-progress"');
        expect(response.body).toContain('data-testid="current-job-cancel"');
        expect(response.body).toContain('data-testid="open-export-modal"');
        expect(response.body).toContain('data-testid="export-modal"');
        expect(response.body).toContain('data-testid="export-panel"');
        expect(response.body).toContain('data-testid="export-scope-select"');
        expect(response.body).toContain('data-testid="export-format-select"');
        expect(response.body).toContain('data-testid="export-cancel"');
        expect(response.body).toContain('data-testid="export-download"');
    });

    it('renders the redesigned home shell selectors for workspace navigation regression', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);

        const response = await ctx.app.inject({
            method: 'GET',
            url: '/',
            headers,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('data-testid="home-page"');
        expect(response.body).toContain('data-testid="home-topbar"');
        expect(response.body).toContain('data-testid="home-drawer-toggle"');
        expect(response.body).toContain('data-testid="home-sidebar"');
        expect(response.body).toContain('data-testid="home-overview-card"');
        expect(response.body).toContain('data-testid="home-category-nav-shell"');
        expect(response.body).toContain('data-testid="home-overview-add-bookmark"');
    });

    it('renders repo playwright smoke selectors for search, bookmark editing, and category management', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);

        const response = await ctx.app.inject({
            method: 'GET',
            url: '/',
            headers,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('data-testid="open-add-bookmark"');
        expect(response.body).toContain('data-testid="add-bookmark-modal"');
        expect(response.body).toContain('data-testid="add-bookmark-url-input"');
        expect(response.body).toContain('data-testid="add-bookmark-title-input"');
        expect(response.body).toContain('data-testid="add-bookmark-submit"');
        expect(response.body).toContain('data-testid="bookmark-search-input"');
        expect(response.body).toContain('data-testid="bookmark-search-submit"');
        expect(response.body).toContain('data-testid="advanced-search-toggle"');
        expect(response.body).toContain('data-testid="advanced-search-panel"');
        expect(response.body).toContain('data-testid="advanced-search-status"');
        expect(response.body).toContain('data-testid="advanced-search-sort"');
        expect(response.body).toContain('data-testid="advanced-search-order"');
        expect(response.body).toContain('data-testid="advanced-search-apply"');
        expect(response.body).toContain('data-testid="advanced-search-reset"');
        expect(response.body).toContain('data-testid="bookmark-view-toggle"');
        expect(response.body).toContain('data-testid="edit-bookmark-modal"');
        expect(response.body).toContain('data-testid="edit-bookmark-url-input"');
        expect(response.body).toContain('data-testid="edit-bookmark-title-input"');
        expect(response.body).toContain('data-testid="edit-bookmark-cancel"');
        expect(response.body).toContain('data-testid="edit-bookmark-save"');
        expect(response.body).toContain('@keydown.escape.window="if(showEditModal) closeEditModal()"');
        expect(response.body).toContain('@keyup.enter="saveEditBookmark()"');
        expect(response.body).toContain('data-testid="bookmark-row-edit-button"');
        expect(response.body).toContain('data-testid="bookmark-row-delete-button"');
        expect(response.body).toContain('data-testid="category-nav-uncategorized-tab"');
        expect(response.body).toContain('data-testid="category-manager-search"');
        expect(response.body).toContain('data-testid="category-manager-add-root"');
        expect(response.body).toContain('data-testid="create-category-modal"');
        expect(response.body).toContain('data-testid="create-category-name-input"');
        expect(response.body).toContain('data-testid="create-category-cancel"');
        expect(response.body).toContain('data-testid="create-category-confirm"');
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
            failed: 1,
            message: '检查中：示例任务',
        });
        addJobFailure(ctx.db, job.id, 'https://example.com/failure-shell', '示例失败');

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
        expect(jobResponse.body).toContain('data-testid="job-summary-grid"');
        expect(jobResponse.body).toContain('data-testid="job-progress-percent"');
        expect(jobResponse.body).toContain('data-testid="job-bar"');
        expect(jobResponse.body).toContain('data-testid="job-current-item"');
        expect(jobResponse.body).toContain('data-testid="job-progress-summary"');
        expect(jobResponse.body).toContain('data-testid="job-progress"');
        expect(jobResponse.body).toContain('data-testid="job-total"');
        expect(jobResponse.body).toContain('data-testid="job-inserted"');
        expect(jobResponse.body).toContain('data-testid="job-skipped"');
        expect(jobResponse.body).toContain('data-testid="job-failed"');
        expect(jobResponse.body).toContain('data-testid="cancel-job-btn"');
        expect(jobResponse.body).toContain('data-testid="failure-page-size"');
        expect(jobResponse.body).toContain('data-testid="failure-table"');
        expect(jobResponse.body).toContain('data-testid="failure-list"');
        expect(jobResponse.body).toContain('data-testid="failure-row"');
        expect(jobResponse.body).toContain('data-testid="failure-input"');
        expect(jobResponse.body).toContain('data-testid="failure-reason"');
        expect(jobResponse.body).toContain('data-testid="failure-pager"');
        expect(jobResponse.body).toContain('data-testid="failure-current-page"');
        expect(jobResponse.body).toContain('data-testid="failure-total-pages"');
        expect(jobResponse.body).toContain('data-testid="failure-prev-btn"');
        expect(jobResponse.body).toContain('data-testid="failure-next-btn"');
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
        expect(emptyJobsResponse.body).toContain('data-testid="jobs-overview-card"');
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
        expect(jobsResponse.body).toContain('data-testid="jobs-row-status-badge"');
        expect(jobsResponse.body).toContain('data-testid="jobs-row-progress-bar"');

        const snapshotsResponse = await ctx.app.inject({
            method: 'GET',
            url: '/snapshots',
            headers,
        });

        expect(snapshotsResponse.statusCode).toBe(200);
        expect(snapshotsResponse.body).toContain('data-testid="snapshots-page"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-stats-card"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-filter-bar"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-search-input"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-date-filter"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-clear-filter"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-list-header"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshots-select-all"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshots-batch-delete"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-list"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshots-empty-state"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-group-header"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-row"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-checkbox"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-title"');
        expect(snapshotsResponse.body).toContain('data-testid="snapshot-item-actions"');
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
