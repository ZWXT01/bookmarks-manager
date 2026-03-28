import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addJobFailure, getJob, publishJobEvent, updateJob } from '../../src/jobs';
import { createTestApp, type TestAppContext } from '../helpers/app';
import { seedJob } from '../helpers/factories';

describe('integration: jobs routes', () => {
    let ctx: TestAppContext;
    let authHeaders: Record<string, string>;

    beforeEach(async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        authHeaders = session.headers;
    });

    afterEach(async () => {
        if (ctx) await ctx.cleanup();
    });

    it('returns empty current-job payloads and 404 for unknown jobs', async () => {
        const current = await ctx.app.inject({
            method: 'GET',
            url: '/api/jobs/current',
            headers: authHeaders,
        });
        expect(current.statusCode).toBe(200);
        expect(current.json()).toEqual({ job: null });

        const missingJob = await ctx.app.inject({
            method: 'GET',
            url: '/api/jobs/does-not-exist',
            headers: authHeaders,
        });
        expect(missingJob.statusCode).toBe(404);
        expect(missingJob.json()).toEqual({ error: 'Operation failed' });

        const missingEvents = await ctx.app.inject({
            method: 'GET',
            url: '/jobs/does-not-exist/events',
            headers: authHeaders,
        });
        expect(missingEvents.statusCode).toBe(404);
        expect(missingEvents.body).toBe('not found');
    });

    it('returns paginated job lists, current jobs, single jobs, and paginated failures', async () => {
        const activeJob = seedJob(ctx.db, {
            id: 'job-active',
            type: 'check',
            status: 'running',
            created_at: '2026-03-18T12:00:00.000Z',
            updated_at: '2026-03-18T12:00:00.000Z',
        });
        const failureJob = seedJob(ctx.db, {
            id: 'job-failures',
            type: 'import',
            status: 'done',
            created_at: '2026-03-10T00:00:00.000Z',
            updated_at: '2026-03-10T00:00:00.000Z',
        });

        for (let index = 1; index <= 10; index += 1) {
            seedJob(ctx.db, {
                id: `job-${index}`,
                type: 'import',
                status: 'done',
                created_at: `2026-03-${String(index).padStart(2, '0')}T00:00:00.000Z`,
                updated_at: `2026-03-${String(index).padStart(2, '0')}T00:00:00.000Z`,
            });
        }

        addJobFailure(ctx.db, failureJob.id, 'https://one.example.com', 'timeout-1');
        addJobFailure(ctx.db, failureJob.id, 'https://two.example.com', 'timeout-2');
        addJobFailure(ctx.db, failureJob.id, 'https://three.example.com', 'timeout-3');

        const current = await ctx.app.inject({
            method: 'GET',
            url: '/api/jobs/current',
            headers: authHeaders,
        });
        expect(current.statusCode).toBe(200);
        expect(current.json().job.id).toBe(activeJob.id);

        const single = await ctx.app.inject({
            method: 'GET',
            url: `/api/jobs/${failureJob.id}`,
            headers: authHeaders,
        });
        expect(single.statusCode).toBe(200);
        expect(single.json().job.id).toBe(failureJob.id);

        const failures = await ctx.app.inject({
            method: 'GET',
            url: `/api/jobs/${failureJob.id}/failures?page=2&page_size=2`,
            headers: authHeaders,
        });
        expect(failures.statusCode).toBe(200);
        expect(failures.json()).toMatchObject({
            total: 3,
            page: 2,
            totalPages: 2,
            pageSize: 2,
        });
        expect(failures.json().failures).toHaveLength(1);
        expect(failures.json().failures[0].reason).toBe('timeout-1');

        const emptyFailures = await ctx.app.inject({
            method: 'GET',
            url: `/api/jobs/${activeJob.id}/failures`,
            headers: authHeaders,
        });
        expect(emptyFailures.statusCode).toBe(200);
        expect(emptyFailures.json()).toEqual({
            failures: [],
            total: 0,
            page: 1,
            totalPages: 1,
            pageSize: 20,
        });

        const list = await ctx.app.inject({
            method: 'GET',
            url: '/api/jobs?page=2',
            headers: authHeaders,
        });
        expect(list.statusCode).toBe(200);
        expect(list.json()).toMatchObject({
            total: 12,
            page: 2,
            totalPages: 2,
            pageSize: 10,
        });
        expect(list.json().jobs).toHaveLength(2);
    });

    it('cancels queued jobs idempotently and leaves terminal jobs unchanged', async () => {
        const queuedJob = seedJob(ctx.db, { id: 'job-cancel', type: 'check', status: 'queued' });
        const doneJob = seedJob(ctx.db, { id: 'job-done', type: 'check', status: 'done' });

        const firstCancel = await ctx.app.inject({
            method: 'POST',
            url: `/api/jobs/${queuedJob.id}/cancel`,
            headers: authHeaders,
        });
        expect(firstCancel.statusCode).toBe(200);
        expect(firstCancel.json()).toEqual({ success: true, status: 'canceled' });
        expect(getJob(ctx.db, queuedJob.id)?.status).toBe('canceled');

        const secondCancel = await ctx.app.inject({
            method: 'POST',
            url: `/api/jobs/${queuedJob.id}/cancel`,
            headers: authHeaders,
        });
        expect(secondCancel.statusCode).toBe(200);
        expect(secondCancel.json()).toEqual({ success: true, status: 'canceled' });

        const terminalCancel = await ctx.app.inject({
            method: 'POST',
            url: `/api/jobs/${doneJob.id}/cancel`,
            headers: authHeaders,
        });
        expect(terminalCancel.statusCode).toBe(200);
        expect(terminalCancel.json()).toEqual({ success: true, status: 'done' });
    });

    it('clears completed jobs and removes orphaned failures', async () => {
        const runningJob = seedJob(ctx.db, { id: 'job-running', type: 'import', status: 'running' });
        const doneJob = seedJob(ctx.db, { id: 'job-done-clear', type: 'import', status: 'done' });
        const failedJob = seedJob(ctx.db, { id: 'job-failed-clear', type: 'check', status: 'failed' });

        addJobFailure(ctx.db, doneJob.id, 'https://done.example.com', 'done-failure');
        addJobFailure(ctx.db, failedJob.id, 'https://failed.example.com', 'failed-failure');

        const response = await ctx.app.inject({
            method: 'POST',
            url: '/api/jobs/clear-completed',
            headers: authHeaders,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true, deleted: 2 });
        expect(getJob(ctx.db, runningJob.id)?.status).toBe('running');
        expect(getJob(ctx.db, doneJob.id)).toBeNull();
        expect(getJob(ctx.db, failedJob.id)).toBeNull();
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM job_failures').get() as { count: number }).count).toBe(0);
    });

    it('clears all jobs and all failure rows', async () => {
        const queuedJob = seedJob(ctx.db, { id: 'job-clear-all-queued', type: 'import', status: 'queued' });
        const canceledJob = seedJob(ctx.db, { id: 'job-clear-all-canceled', type: 'check', status: 'canceled' });

        addJobFailure(ctx.db, queuedJob.id, 'https://queued.example.com', 'queued-failure');
        addJobFailure(ctx.db, canceledJob.id, 'https://canceled.example.com', 'canceled-failure');

        const response = await ctx.app.inject({
            method: 'POST',
            url: '/api/jobs/clear-all',
            headers: authHeaders,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true, deleted: 2 });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count).toBe(0);
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM job_failures').get() as { count: number }).count).toBe(0);
    });

    it('streams the initial SSE frame, broadcasts later updates, and closes cleanly on disconnect', async () => {
        const job = seedJob(ctx.db, {
            id: 'job-sse',
            type: 'check',
            status: 'queued',
            total: 3,
            processed: 0,
        });

        const response = await ctx.app.inject({
            method: 'GET',
            url: `/jobs/${job.id}/events`,
            headers: authHeaders,
            payloadAsStream: true,
        });

        expect(response.statusCode).toBe(200);
        expect(String(response.headers['content-type'])).toContain('text/event-stream');

        const stream = response.stream();
        let payload = '';
        let publishedUpdate = false;
        let closed = false;

        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                stream.destroy();
                resolve();
            }, 1500);

            stream.on('data', (chunk: Buffer) => {
                payload += chunk.toString();

                if (!publishedUpdate && payload.includes(`"id":"${job.id}"`) && payload.includes('"status":"queued"')) {
                    publishedUpdate = true;
                    updateJob(ctx.db, job.id, {
                        status: 'running',
                        total: 3,
                        processed: 1,
                        message: 'running',
                    });
                    publishJobEvent(job.id, 'progress', { processed: 1 });
                    return;
                }

                if (!closed && payload.includes('"status":"running"') && payload.includes('event: progress')) {
                    closed = true;
                    clearTimeout(timer);
                    stream.destroy();
                    resolve();
                }
            });

            stream.on('error', () => {
                clearTimeout(timer);
                resolve();
            });
        });

        expect(payload).toContain(`"id":"${job.id}"`);
        expect(payload).toContain('"status":"queued"');
        expect(payload).toContain('"status":"running"');
        expect(payload).toContain('event: progress');
        expect(payload).toContain('"processed":1');

        expect(() => {
            updateJob(ctx.db, job.id, {
                status: 'done',
                total: 3,
                processed: 3,
                message: 'done',
            });
            publishJobEvent(job.id, 'progress', { processed: 3 });
        }).not.toThrow();
    });
});
