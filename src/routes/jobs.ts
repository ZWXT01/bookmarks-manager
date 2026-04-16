/**
 * Jobs Routes - 任务管理路由
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getJob, jobQueue, pruneJobsToRecent, subscribeJob, subscribeJobEvent, updateJob } from '../jobs';
import { toInt } from '../utils/helpers';

export interface JobsRoutesOptions {
    db: Database;
}

export const jobsRoutes: FastifyPluginCallback<JobsRoutesOptions> = (app, opts, done) => {
    const { db } = opts;

    // GET /api/jobs/current - 获取当前运行的任务
    app.get('/api/jobs/current', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            const row = db.prepare(`
        SELECT id, type, status, total, processed, inserted, skipped, failed, message, created_at, updated_at
        FROM jobs
        WHERE status IN ('running', 'pending', 'queued')
        ORDER BY created_at DESC
        LIMIT 1
      `).get() as any;

            if (row) {
                return reply.send({ job: row });
            }
            return reply.send({ job: null });
        } catch (e: any) {
            return reply.send({ job: null });
        }
    });

    // GET /api/jobs/:id - 获取单个任务
    app.get('/api/jobs/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const jobId = req.params.id;
        if (!jobId) {
            return reply.code(400).send({ error: 'Operation failed' });
        }

        try {
            const job = getJob(db, jobId);
            if (!job) {
                return reply.code(404).send({ error: 'Operation failed' });
            }
            return reply.send({ job });
        } catch (e: any) {
            req.log.error({ err: e, jobId }, 'get job failed');
            return reply.code(500).send({ error: 'Operation failed' });
        }
    });

    // GET /api/jobs/:id/failures - 获取任务失败项（支持 page/page_size 分页）
    app.get('/api/jobs/:id/failures', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const jobId = req.params.id;
        const q: any = (req as any).query || {};
        const page = Math.max(1, toInt(q.page) || 1);
        const pageSize = Math.min(200, Math.max(1, toInt(q.page_size) || toInt(q.limit) || 20));

        try {
            const totalRow = db.prepare('SELECT COUNT(*) as count FROM job_failures WHERE job_id = ?').get(jobId) as { count: number };
            const total = totalRow?.count || 0;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const pageClamped = Math.min(page, totalPages);
            const offset = (pageClamped - 1) * pageSize;

            const failures = db.prepare('SELECT * FROM job_failures WHERE job_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(jobId, pageSize, offset) as Array<{ id: number; job_id: string; input: string; reason: string }>;
            return reply.send({ failures, total, page: pageClamped, totalPages, pageSize });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // GET /jobs/:id/events - SSE 实时任务状态
    app.get('/jobs/:id/events', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const jobId = req.params.id;
        const job = getJob(db, jobId);
        if (!job) {
            return reply.code(404).type('text/plain').send('not found');
        }

        req.log.info({ jobId }, 'sse connected');

        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');

        reply.raw.write('data: ' + JSON.stringify(job) + '\n\n');

        const unsubscribe = subscribeJob(jobId, (next) => {
            reply.raw.write('data: ' + JSON.stringify(next) + '\n\n');
        });

        const unsubEvent = subscribeJobEvent(jobId, (eventName, data) => {
            reply.raw.write('event: ' + eventName + '\ndata: ' + JSON.stringify(data) + '\n\n');
        });

        req.raw.on('close', () => {
            unsubscribe();
            unsubEvent();
            req.log.info({ jobId }, 'sse disconnected');
            reply.raw.end();
        });
    });

    // POST /api/jobs/:id/cancel - 取消任务
    app.post('/api/jobs/:id/cancel', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const jobId = req.params.id;
        if (!jobId) {
            return reply.code(400).send({ error: 'Operation failed' });
        }

        try {
            const job = getJob(db, jobId);
            if (!job) {
                return reply.code(404).send({ error: 'Operation failed' });
            }

            if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
                return reply.send({ success: true, status: job.status });
            }

            jobQueue.cancelJob(jobId);
            const next = updateJob(db, jobId, { status: 'canceled', message: '任务已取消' });
            return reply.send({ success: true, status: next.status });
        } catch (e: any) {
            req.log.error({ err: e, jobId }, 'cancel job failed');
            return reply.code(500).send({ error: 'Operation failed' });
        }
    });

    // POST /api/jobs/clear-completed - 清理已完成任务
    app.post('/api/jobs/clear-completed', async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const result = db.prepare(`
        DELETE FROM jobs WHERE status IN ('done', 'failed', 'canceled', 'cancelled')
      `).run();
            db.prepare('DELETE FROM job_failures WHERE job_id NOT IN (SELECT id FROM jobs)').run();
            req.log.info({ deleted: result.changes }, 'cleared completed jobs');
            return reply.send({ success: true, deleted: result.changes });
        } catch (e: any) {
            req.log.error({ err: e }, 'clear completed jobs failed');
            return reply.code(500).send({ error: e.message || '清理失败' });
        }
    });

    // POST /api/jobs/clear-all - 清理所有任务
    app.post('/api/jobs/clear-all', async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const result = db.prepare('DELETE FROM jobs').run();
            db.prepare('DELETE FROM job_failures').run();
            req.log.info({ deleted: result.changes }, 'cleared all jobs');
            return reply.send({ success: true, deleted: result.changes });
        } catch (e: any) {
            req.log.error({ err: e }, 'clear all jobs failed');
            return reply.code(500).send({ error: e.message || '清理失败' });
        }
    });

    // 定义 JobListRow 类型
    type JobListRow = {
        id: string;
        type: string;
        status: string;
        total: number;
        processed: number;
        inserted: number;
        skipped: number;
        failed: number;
        message: string | null;
        created_at: string;
        updated_at: string;
    };

    // GET /jobs - 任务列表页面
    app.get('/jobs', async (req: FastifyRequest<{ Querystring: { page?: string } }>, reply: FastifyReply) => {
        try {
            // 保留所有运行中任务 + 最近10个已结束任务
            pruneJobsToRecent(db, 10);
            db.prepare('DELETE FROM job_failures WHERE job_id NOT IN (SELECT id FROM jobs)').run();
        } catch (e) {
            req.log.warn({ err: e }, 'prune jobs failed');
        }

        const pageParam = typeof req.query.page === 'string' ? req.query.page : '';
        const pageParsed = Number(pageParam);
        const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;
        const pageSize = 10;

        const total = (db.prepare('SELECT COUNT(1) AS cnt FROM jobs').get() as { cnt: number }).cnt;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const pageClamped = Math.min(Math.max(1, page), totalPages);
        const offset = (pageClamped - 1) * pageSize;

        const jobs = db
            .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?')
            .all(pageSize, offset) as JobListRow[];

        return reply.view('jobs.ejs', { jobs, page: pageClamped, totalPages, total, pageSize, pageUrlPrefix: '/jobs?page=' });
    });

    // GET /api/jobs - 任务列表 API
    app.get('/api/jobs', async (req: FastifyRequest<{ Querystring: { page?: string } }>, reply: FastifyReply) => {
        const pageParam = typeof req.query.page === 'string' ? req.query.page : '';
        const pageParsed = Number(pageParam);
        const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;
        const pageSize = 10;

        const total = (db.prepare('SELECT COUNT(1) AS cnt FROM jobs').get() as { cnt: number }).cnt;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const pageClamped = Math.min(Math.max(1, page), totalPages);
        const offset = (pageClamped - 1) * pageSize;

        const jobs = db
            .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?')
            .all(pageSize, offset) as JobListRow[];

        return reply.send({ jobs, page: pageClamped, totalPages, total, pageSize });
    });

    done();
};
