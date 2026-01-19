/**
 * Check Routes - 书签检查路由
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getJob, updateJob, createJob, jobQueue } from '../jobs';
import { runCheckJob } from '../checker';
import { toInt } from '../utils/helpers';

export interface CheckRoutesOptions {
    db: Database;
    checkConcurrency: number;
    checkTimeoutMs: number;
    checkRetries: number;
    checkRetryDelayMs: number;
    effectiveCheckRetries: (fallback: number) => number;
    effectiveCheckRetryDelayMs: (fallback: number) => number;
    toIntClamp: (val: any, min: number, max: number, fallback: number) => number;
    safeRedirectTarget: (target: string | undefined, fallback: string) => string;
    withFlash: (url: string, key: 'msg' | 'err', value: string) => string;
}

export const checkRoutes: FastifyPluginCallback<CheckRoutesOptions> = (app, opts, done) => {
    const {
        db, checkConcurrency, checkTimeoutMs, checkRetries, checkRetryDelayMs,
        effectiveCheckRetries, effectiveCheckRetryDelayMs,
        toIntClamp, safeRedirectTarget, withFlash,
    } = opts;

    // POST /api/check/cancel - 取消检查任务
    app.post('/api/check/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : typeof body.id === 'string' ? body.id.trim() : '';
        if (!jobId) {
            return reply.code(400).send({ error: 'Operation failed' });
        }

        try {
            const job = getJob(db, jobId);
            if (!job) {
                return reply.code(404).send({ error: 'Operation failed' });
            }
            if (job.type !== 'check') {
                return reply.code(400).send({ error: 'Operation failed' });
            }
            if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
                return reply.send({ success: true, status: job.status });
            }
            const next = updateJob(db, jobId, { status: 'canceled', message: '已取消' });
            return reply.send({ success: true, status: next.status });
        } catch (e: any) {
            req.log.error({ err: e, jobId }, 'cancel check failed');
            return reply.code(500).send({ error: 'Operation failed' });
        }
    });

    // POST /api/check/start - 开始检查任务
    app.post('/api/check/start', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const scope = typeof body.scope === 'string' ? body.scope : 'all';
        const retries = toIntClamp(body.retries, 0, 5, effectiveCheckRetries(checkRetries));
        const retryDelayMs = toIntClamp(body.retry_delay_ms, 0, 10_000, effectiveCheckRetryDelayMs(checkRetryDelayMs));

        const rawCategory = body.category ?? body.category_id;
        const category = typeof rawCategory === 'string' ? rawCategory : typeof rawCategory === 'number' ? String(rawCategory) : '';

        const rawIds = body['bookmark_ids[]'] ?? body.bookmark_ids;
        let bookmarkIds: number[] = Array.isArray(rawIds)
            ? rawIds.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
            : typeof rawIds === 'string'
                ? [toInt(rawIds)].filter((n): n is number => n !== null)
                : [];

        const rawCategoryIds = body['category_ids[]'] ?? body.category_ids;
        let categoryIds: number[] = Array.isArray(rawCategoryIds)
            ? rawCategoryIds.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
            : typeof rawCategoryIds === 'string'
                ? rawCategoryIds.split(',').map((s: string) => toInt(s.trim())).filter((n: number | null): n is number => n !== null)
                : [];

        if (bookmarkIds.length === 0) {
            let rows: Array<{ id: number }>;
            if (scope === 'selected') {
                return reply.code(400).send({ error: 'Operation failed' });
            } else if (scope === 'categories' && categoryIds.length > 0) {
                const placeholders = categoryIds.map(() => '?').join(',');
                rows = db.prepare(`SELECT id FROM bookmarks WHERE category_id IN (${placeholders}) AND skip_check = 0 ORDER BY id`).all(...categoryIds) as Array<{ id: number }>;
            } else if (scope === 'category') {
                if (!category) {
                    return reply.code(400).send({ error: 'Operation failed' });
                }
                if (category === 'uncategorized') {
                    rows = db.prepare('SELECT id FROM bookmarks WHERE category_id IS NULL AND skip_check = 0 ORDER BY id').all() as Array<{ id: number }>;
                } else {
                    const catId = toInt(category);
                    if (catId === null) {
                        return reply.code(400).send({ error: 'Operation failed' });
                    }
                    rows = db.prepare('SELECT id FROM bookmarks WHERE category_id = ? AND skip_check = 0 ORDER BY id').all(catId) as Array<{ id: number }>;
                }
            } else if (scope === 'not_checked') {
                rows = db.prepare("SELECT id FROM bookmarks WHERE check_status = 'not_checked' AND skip_check = 0 ORDER BY id").all() as Array<{ id: number }>;
            } else if (scope === 'failed') {
                rows = db.prepare("SELECT id FROM bookmarks WHERE check_status = 'fail' AND skip_check = 0 ORDER BY id").all() as Array<{ id: number }>;
            } else {
                rows = db.prepare('SELECT id FROM bookmarks WHERE skip_check = 0 ORDER BY id').all() as Array<{ id: number }>;
            }
            bookmarkIds = rows.map((x) => x.id);
        }

        if (bookmarkIds.length === 0) {
            return reply.code(400).send({ error: 'Operation failed' });
        }

        const job = createJob(db, 'check', '等待检查');
        req.log.info({ jobId: job.id }, 'check job queued via API');
        jobQueue.enqueue(job.id, async () => {
            const log = app.log.child({ jobId: job.id, jobType: 'check' });
            const startedAt = Date.now();
            try {
                log.info({ bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check job started');
                await runCheckJob(db, job.id, bookmarkIds, {
                    concurrency: checkConcurrency,
                    timeoutMs: checkTimeoutMs,
                    retries,
                    retryDelayMs,
                    logger: log,
                });
                log.info({ durationMs: Date.now() - startedAt }, 'check job done');
            } catch (err) {
                log.error({ err, durationMs: Date.now() - startedAt }, 'check job failed');
                updateJob(db, job.id, { status: 'failed', message: '检查失败' });
            }
        });

        return reply.send({ success: true, jobId: job.id });
    });

    // POST /check/all - 检查所有书签（表单提交）
    app.post('/check/all', async (req: FastifyRequest<{ Body: { redirect?: string; scope?: string; retries?: string; retry_delay_ms?: string } }>, reply: FastifyReply) => {
        const body: any = (req as any).body || {};
        const redirectTo = safeRedirectTarget(body.redirect, '/');

        const scope = typeof body.scope === 'string' ? body.scope : 'all';
        const retries = toIntClamp(body.retries, 0, 5, effectiveCheckRetries(checkRetries));
        const retryDelayMs = toIntClamp(body.retry_delay_ms, 0, 10_000, effectiveCheckRetryDelayMs(checkRetryDelayMs));

        let ids: Array<{ id: number }>;
        if (scope === 'not_checked') {
            ids = db.prepare("SELECT id FROM bookmarks WHERE check_status = 'not_checked' AND skip_check = 0 ORDER BY id").all() as Array<{ id: number }>;
        } else if (scope === 'failed') {
            ids = db.prepare("SELECT id FROM bookmarks WHERE check_status = 'fail' AND skip_check = 0 ORDER BY id").all() as Array<{ id: number }>;
        } else {
            ids = db.prepare('SELECT id FROM bookmarks WHERE skip_check = 0 ORDER BY id').all() as Array<{ id: number }>;
        }
        const bookmarkIds = ids.map((x) => x.id);

        req.log.info({ scope, bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check all requested');

        if (bookmarkIds.length === 0) {
            const msg = scope === 'failed' ? '暂无失败书签可重试' : scope === 'not_checked' ? '暂无未检查书签' : '暂无可检查书签';
            return reply.redirect(withFlash(redirectTo, 'msg', msg));
        }

        const job = createJob(db, 'check', '等待检查');
        req.log.info({ jobId: job.id }, 'check job queued');
        jobQueue.enqueue(job.id, async () => {
            const log = app.log.child({ jobId: job.id, jobType: 'check' });
            const startedAt = Date.now();
            try {
                log.info({ bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check job started');
                await runCheckJob(db, job.id, bookmarkIds, {
                    concurrency: checkConcurrency,
                    timeoutMs: checkTimeoutMs,
                    retries,
                    retryDelayMs,
                    logger: log,
                });
                log.info({ durationMs: Date.now() - startedAt }, 'check job done');
            } catch (err) {
                log.error({ err, durationMs: Date.now() - startedAt }, 'check job failed');
                updateJob(db, job.id, { status: 'failed', message: '检查失败' });
            }
        });

        return reply.redirect('/jobs/' + job.id);
    });

    // POST /check - 检查选中书签（表单提交）
    app.post('/check', async (req: FastifyRequest<{ Body: { bookmark_ids?: string | string[]; redirect?: string; retries?: string; retry_delay_ms?: string } }>, reply: FastifyReply) => {
        const body = req.body || {};
        const raw = body.bookmark_ids;
        const redirectTo = safeRedirectTarget((body as any).redirect, '/');

        const retries = toIntClamp((body as any).retries, 0, 5, effectiveCheckRetries(checkRetries));
        const retryDelayMs = toIntClamp((body as any).retry_delay_ms, 0, 10_000, effectiveCheckRetryDelayMs(checkRetryDelayMs));

        const bookmarkIds: number[] = Array.isArray(raw)
            ? raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
            : typeof raw === 'string'
                ? [Number(raw)].filter((n) => Number.isInteger(n) && n > 0)
                : [];

        req.log.info({ bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check requested');

        if (bookmarkIds.length === 0) {
            return reply.redirect(withFlash(redirectTo, 'msg', '请选择要检查的书签'));
        }

        const job = createJob(db, 'check', '等待检查');
        req.log.info({ jobId: job.id }, 'check job queued');
        jobQueue.enqueue(job.id, async () => {
            const log = app.log.child({ jobId: job.id, jobType: 'check' });
            const startedAt = Date.now();
            try {
                log.info({ bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check job started');
                await runCheckJob(db, job.id, bookmarkIds, {
                    concurrency: checkConcurrency,
                    timeoutMs: checkTimeoutMs,
                    retries,
                    retryDelayMs,
                    logger: log,
                });
                log.info({ durationMs: Date.now() - startedAt }, 'check job done');
            } catch (err) {
                log.error({ err, durationMs: Date.now() - startedAt }, 'check job failed');
                updateJob(db, job.id, { status: 'failed', message: '检查失败' });
            }
        });

        return reply.redirect('/jobs/' + job.id);
    });

    done();
};
