import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './helpers/db.ts';
import type { Db } from '../src/db';
import {
    createJob,
    getJob,
    updateJob,
    addJobFailure,
    listJobFailures,
    countJobFailures,
    JobQueue,
    pruneJobsToRecent,
} from '../src/jobs';

describe('Job CRUD', () => {
    let db: Db;
    let cleanup: () => void;

    beforeEach(() => {
        const ctx = createTestDb();
        db = ctx.db;
        cleanup = ctx.cleanup;
    });

    afterEach(() => cleanup());

    describe('createJob', () => {
        it('should create a job with queued status', () => {
            const job = createJob(db, 'import', 'Importing bookmarks', 100);
            expect(job.id).toBeTruthy();
            expect(job.type).toBe('import');
            expect(job.status).toBe('queued');
            expect(job.total).toBe(100);
            expect(job.processed).toBe(0);
            expect(job.message).toBe('Importing bookmarks');
        });

        it('should default total to 0 when not provided', () => {
            const job = createJob(db, 'check', null);
            expect(job.total).toBe(0);
        });
    });

    describe('getJob', () => {
        it('should return the job by ID', () => {
            const created = createJob(db, 'import', 'test');
            const fetched = getJob(db, created.id);
            expect(fetched).not.toBeNull();
            expect(fetched!.id).toBe(created.id);
        });

        it('should return null for non-existent job', () => {
            const job = getJob(db, 'non-existent-id');
            expect(job).toBeNull();
        });
    });

    describe('updateJob', () => {
        it('should update job fields', () => {
            const job = createJob(db, 'check', 'checking');
            const updated = updateJob(db, job.id, {
                status: 'running',
                processed: 50,
                total: 100,
                message: 'In progress',
            });
            expect(updated.status).toBe('running');
            expect(updated.processed).toBe(50);
            expect(updated.message).toBe('In progress');
        });

        it('should update status to done', () => {
            const job = createJob(db, 'import', 'test');
            const updated = updateJob(db, job.id, { status: 'done', message: 'Complete' });
            expect(updated.status).toBe('done');
        });
    });

    describe('Job failures', () => {
        it('should add and list failures', () => {
            const job = createJob(db, 'check', 'test');
            addJobFailure(db, job.id, 'https://broken.com', 'Timeout');
            addJobFailure(db, job.id, 'https://dead.com', 'HTTP 404');

            const failures = listJobFailures(db, job.id);
            expect(failures).toHaveLength(2);
            expect(failures[0].input).toBe('https://dead.com'); // DESC order
            expect(failures[1].input).toBe('https://broken.com');
        });

        it('should count failures correctly', () => {
            const job = createJob(db, 'check', 'test');
            addJobFailure(db, job.id, 'url1', 'err1');
            addJobFailure(db, job.id, 'url2', 'err2');
            addJobFailure(db, job.id, 'url3', 'err3');

            expect(countJobFailures(db, job.id)).toBe(3);
        });

        it('should not mix failures across jobs', () => {
            const job1 = createJob(db, 'check', 'job1');
            const job2 = createJob(db, 'check', 'job2');
            addJobFailure(db, job1.id, 'url1', 'err1');
            addJobFailure(db, job2.id, 'url2', 'err2');

            expect(countJobFailures(db, job1.id)).toBe(1);
            expect(countJobFailures(db, job2.id)).toBe(1);
        });
    });

    describe('pruneJobsToRecent', () => {
        it('should keep running jobs and only keep latest finished jobs', () => {
            const running = createJob(db, 'check', 'running');
            updateJob(db, running.id, { status: 'running' });

            for (let i = 0; i < 15; i += 1) {
                const job = createJob(db, 'import', `done-${i}`);
                db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(job.id);
            }

            pruneJobsToRecent(db, 10);

            const runningAfter = getJob(db, running.id);
            expect(runningAfter).not.toBeNull();
            expect(runningAfter!.status).toBe('running');

            const finishedCount = (
                db.prepare("SELECT COUNT(*) as cnt FROM jobs WHERE status IN ('done', 'failed', 'canceled')").get() as { cnt: number }
            ).cnt;
            expect(finishedCount).toBe(10);
        });
    });
});

describe('JobQueue', () => {
    it('should execute tasks sequentially', async () => {
        const queue = new JobQueue();
        const order: number[] = [];

        queue.enqueue('job-1', async () => {
            await new Promise((r) => setTimeout(r, 50));
            order.push(1);
        });
        queue.enqueue('job-2', async () => {
            order.push(2);
        });

        // Wait for all tasks to complete
        await new Promise((r) => setTimeout(r, 200));
        expect(order).toEqual([1, 2]);
    });

    it('should support canceling queued tasks', async () => {
        const queue = new JobQueue();
        const executed: string[] = [];

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
        expect(executed).toEqual(['a']);
    });

    it('should track canceled status', () => {
        const queue = new JobQueue();
        expect(queue.isCanceled('x')).toBe(false);
        queue.cancelJob('x');
        expect(queue.isCanceled('x')).toBe(true);
        queue.clearCanceled('x');
        expect(queue.isCanceled('x')).toBe(false);
    });
});
