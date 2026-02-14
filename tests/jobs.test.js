"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const db_1 = require("./helpers/db");
const jobs_1 = require("../src/jobs");
(0, vitest_1.describe)('Job CRUD', () => {
    let db;
    let cleanup;
    (0, vitest_1.beforeEach)(() => {
        const ctx = (0, db_1.createTestDb)();
        db = ctx.db;
        cleanup = ctx.cleanup;
    });
    (0, vitest_1.afterEach)(() => cleanup());
    (0, vitest_1.describe)('createJob', () => {
        (0, vitest_1.it)('should create a job with queued status', () => {
            const job = (0, jobs_1.createJob)(db, 'import', 'Importing bookmarks', 100);
            (0, vitest_1.expect)(job.id).toBeTruthy();
            (0, vitest_1.expect)(job.type).toBe('import');
            (0, vitest_1.expect)(job.status).toBe('queued');
            (0, vitest_1.expect)(job.total).toBe(100);
            (0, vitest_1.expect)(job.processed).toBe(0);
            (0, vitest_1.expect)(job.message).toBe('Importing bookmarks');
        });
        (0, vitest_1.it)('should default total to 0 when not provided', () => {
            const job = (0, jobs_1.createJob)(db, 'check', null);
            (0, vitest_1.expect)(job.total).toBe(0);
        });
    });
    (0, vitest_1.describe)('getJob', () => {
        (0, vitest_1.it)('should return the job by ID', () => {
            const created = (0, jobs_1.createJob)(db, 'import', 'test');
            const fetched = (0, jobs_1.getJob)(db, created.id);
            (0, vitest_1.expect)(fetched).not.toBeNull();
            (0, vitest_1.expect)(fetched.id).toBe(created.id);
        });
        (0, vitest_1.it)('should return null for non-existent job', () => {
            const job = (0, jobs_1.getJob)(db, 'non-existent-id');
            (0, vitest_1.expect)(job).toBeNull();
        });
    });
    (0, vitest_1.describe)('updateJob', () => {
        (0, vitest_1.it)('should update job fields', () => {
            const job = (0, jobs_1.createJob)(db, 'check', 'checking');
            const updated = (0, jobs_1.updateJob)(db, job.id, {
                status: 'running',
                processed: 50,
                total: 100,
                message: 'In progress',
            });
            (0, vitest_1.expect)(updated.status).toBe('running');
            (0, vitest_1.expect)(updated.processed).toBe(50);
            (0, vitest_1.expect)(updated.message).toBe('In progress');
        });
        (0, vitest_1.it)('should update status to done', () => {
            const job = (0, jobs_1.createJob)(db, 'import', 'test');
            const updated = (0, jobs_1.updateJob)(db, job.id, { status: 'done', message: 'Complete' });
            (0, vitest_1.expect)(updated.status).toBe('done');
        });
    });
    (0, vitest_1.describe)('Job failures', () => {
        (0, vitest_1.it)('should add and list failures', () => {
            const job = (0, jobs_1.createJob)(db, 'check', 'test');
            (0, jobs_1.addJobFailure)(db, job.id, 'https://broken.com', 'Timeout');
            (0, jobs_1.addJobFailure)(db, job.id, 'https://dead.com', 'HTTP 404');
            const failures = (0, jobs_1.listJobFailures)(db, job.id);
            (0, vitest_1.expect)(failures).toHaveLength(2);
            (0, vitest_1.expect)(failures[0].input).toBe('https://dead.com'); // DESC order
            (0, vitest_1.expect)(failures[1].input).toBe('https://broken.com');
        });
        (0, vitest_1.it)('should count failures correctly', () => {
            const job = (0, jobs_1.createJob)(db, 'check', 'test');
            (0, jobs_1.addJobFailure)(db, job.id, 'url1', 'err1');
            (0, jobs_1.addJobFailure)(db, job.id, 'url2', 'err2');
            (0, jobs_1.addJobFailure)(db, job.id, 'url3', 'err3');
            (0, vitest_1.expect)((0, jobs_1.countJobFailures)(db, job.id)).toBe(3);
        });
        (0, vitest_1.it)('should not mix failures across jobs', () => {
            const job1 = (0, jobs_1.createJob)(db, 'check', 'job1');
            const job2 = (0, jobs_1.createJob)(db, 'check', 'job2');
            (0, jobs_1.addJobFailure)(db, job1.id, 'url1', 'err1');
            (0, jobs_1.addJobFailure)(db, job2.id, 'url2', 'err2');
            (0, vitest_1.expect)((0, jobs_1.countJobFailures)(db, job1.id)).toBe(1);
            (0, vitest_1.expect)((0, jobs_1.countJobFailures)(db, job2.id)).toBe(1);
        });
    });
});
(0, vitest_1.describe)('JobQueue', () => {
    (0, vitest_1.it)('should execute tasks sequentially', async () => {
        const queue = new jobs_1.JobQueue();
        const order = [];
        queue.enqueue('job-1', async () => {
            await new Promise((r) => setTimeout(r, 50));
            order.push(1);
        });
        queue.enqueue('job-2', async () => {
            order.push(2);
        });
        // Wait for all tasks to complete
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(order).toEqual([1, 2]);
    });
    (0, vitest_1.it)('should support canceling queued tasks', async () => {
        const queue = new jobs_1.JobQueue();
        const executed = [];
        queue.enqueue('job-a', async () => {
            await new Promise((r) => setTimeout(r, 100));
            executed.push('a');
        });
        queue.enqueue('job-b', async () => {
            executed.push('b');
        });
        // Cancel job-b before it runs
        queue.cancelJob('job-b');
        await new Promise((r) => setTimeout(r, 300));
        (0, vitest_1.expect)(executed).toEqual(['a']);
    });
    (0, vitest_1.it)('should track canceled status', () => {
        const queue = new jobs_1.JobQueue();
        (0, vitest_1.expect)(queue.isCanceled('x')).toBe(false);
        queue.cancelJob('x');
        (0, vitest_1.expect)(queue.isCanceled('x')).toBe(true);
        queue.clearCanceled('x');
        (0, vitest_1.expect)(queue.isCanceled('x')).toBe(false);
    });
});
