/**
 * Jobs Routes - 任务管理路由
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getJob, subscribeJob } from '../jobs';
import { toInt } from '../utils/helpers';

export interface JobsRoutesOptions {
    db: Database;
}

export const jobsRoutes: FastifyPluginCallback<JobsRoutesOptions> = (app, opts, done) => {
    const { db } = opts;

    // GET /api/jobs/current - 获取当前运行的任务
    app.get('/api/jobs/current', async (req: FastifyRequest, reply: FastifyReply) => {
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

    // GET /api/jobs/:id/failures - 获取任务失败项
    app.get('/api/jobs/:id/failures', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const jobId = req.params.id;
        const q: any = (req as any).query || {};
        const limit = toInt(q.limit) || 20;
        const offset = toInt(q.offset) || 0;

        try {
            const failures = db.prepare('SELECT * FROM job_failures WHERE job_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(jobId, limit, offset) as Array<{ id: number; job_id: string; input: string; reason: string }>;
            const totalRow = db.prepare('SELECT COUNT(*) as count FROM job_failures WHERE job_id = ?').get(jobId) as { count: number };
            return reply.send({ failures, total: totalRow?.count || 0 });
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

        req.raw.on('close', () => {
            unsubscribe();
            req.log.info({ jobId }, 'sse disconnected');
            reply.raw.end();
        });
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
            // 保留最近10个任务
            const keepIds = db.prepare('SELECT id FROM jobs ORDER BY created_at DESC LIMIT 10').all() as { id: string }[];
            if (keepIds.length > 0) {
                const placeholders = keepIds.map(() => '?').join(',');
                db.prepare(`DELETE FROM jobs WHERE id NOT IN (${placeholders})`).run(...keepIds.map(r => r.id));
                db.prepare('DELETE FROM job_failures WHERE job_id NOT IN (SELECT id FROM jobs)').run();
            }
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

        return reply.view('jobs.ejs', { jobs, page: pageClamped, totalPages, total, pageSize });
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
