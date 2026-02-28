/**
 * Pages Routes - 页面渲染路由
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getJob, countJobFailures, listJobFailuresPaged } from '../jobs';
import { toIntClamp } from '../utils/helpers';

export interface PagesRoutesOptions {
    db: Database;
    toIntClamp: (val: any, min: number, max: number, fallback: number) => number;
}

export const pagesRoutes: FastifyPluginCallback<PagesRoutesOptions> = (app, opts, done) => {
    const { db, toIntClamp: clamp } = opts;

    // GET /jobs/:id - 任务详情页面
    app.get('/jobs/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const jobId = req.params.id;
        const job = getJob(db, jobId);
        if (!job) {
            return reply.code(404).type('text/plain').send('not found');
        }

        const q: any = (req as any).query || {};
        const failPage = clamp(q.fail_page, 1, 10_000, 1);
        const failPageSize = clamp(q.fail_page_size, 10, 200, 20);
        const failureTotal = countJobFailures(db, jobId);
        const failTotalPages = Math.max(1, Math.ceil(failureTotal / failPageSize));
        const failPageClamped = Math.min(Math.max(1, failPage), failTotalPages);
        const failOffset = (failPageClamped - 1) * failPageSize;

        const failures = listJobFailuresPaged(db, jobId, failPageSize, failOffset);
        const failPageUrlPrefix = '/jobs/' + jobId + '?fail_page_size=' + failPageSize + '&fail_page=';

        // Legacy suggestion vars (tables removed)
        let suggestions: any[] = [];
        let suggestionTotal = 0;
        let suggestionPage = 1;
        let suggestionTotalPages = 1;
        let suggestionPageSize = clamp(q.sug_page_size, 10, 100, 20);
        let simplifySuggestions: any[] = [];

        return reply.view('job.ejs', {
            job,
            failures,
            failureTotal,
            failPage: failPageClamped,
            failTotalPages,
            failPageSize,
            failPageUrlPrefix,
            suggestions,
            suggestionTotal,
            suggestionPage,
            suggestionTotalPages,
            suggestionPageSize,
            simplifySuggestions,
        });
    });

    done();
};
