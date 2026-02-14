/**
 * Pages Routes - 页面渲染路由
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getJob, countJobFailures, listJobFailuresPaged } from '../jobs';
import { getSimplifyMappingsByJobId } from '../ai-simplify-job';
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

        // AI 分类建议
        let suggestions: any[] = [];
        let suggestionTotal = 0;
        let suggestionPage = 1;
        let suggestionTotalPages = 1;
        let suggestionPageSize = clamp(q.sug_page_size, 10, 100, 20);

        if (job.type === 'ai_classify') {
            try {
                suggestionPage = clamp(q.sug_page, 1, 10_000, 1);
                const countRow = db.prepare('SELECT COUNT(*) as cnt FROM ai_classification_suggestions WHERE job_id = ?').get(jobId) as { cnt: number };
                suggestionTotal = countRow.cnt;
                suggestionTotalPages = Math.max(1, Math.ceil(suggestionTotal / suggestionPageSize));
                const suggestionPageClamped = Math.min(Math.max(1, suggestionPage), suggestionTotalPages);
                const suggestionOffset = (suggestionPageClamped - 1) * suggestionPageSize;
                suggestionPage = suggestionPageClamped;

                suggestions = db.prepare(`
          SELECT s.id, s.bookmark_id, s.suggested_category, s.confidence, s.created_at,
                 b.title, b.url, COALESCE(s.applied, 0) as applied
          FROM ai_classification_suggestions s
          JOIN bookmarks b ON b.id = s.bookmark_id
          WHERE s.job_id = ?
          ORDER BY s.applied ASC, s.created_at DESC
          LIMIT ? OFFSET ?
        `).all(jobId, suggestionPageSize, suggestionOffset) as any[];
            } catch { }
        }

        // AI 类型精简建议
        let simplifySuggestions: any[] = [];
        if (job.type === 'ai_simplify') {
            try {
                const mappings = getSimplifyMappingsByJobId(db, jobId);
                const grouped: Record<string, Array<{ oldCategoryId: number; oldCategoryName: string; bookmarkCount: number; applied: boolean }>> = {};
                for (const m of mappings) {
                    if (!grouped[m.newCategoryName]) {
                        grouped[m.newCategoryName] = [];
                    }
                    grouped[m.newCategoryName].push({
                        oldCategoryId: m.oldCategoryId,
                        oldCategoryName: m.oldCategoryName,
                        bookmarkCount: m.bookmarkCount,
                        applied: m.applied || false,
                    });
                }
                simplifySuggestions = Object.entries(grouped).map(([newCategory, oldCategories]) => ({
                    newCategory,
                    oldCategories,
                    totalBookmarks: oldCategories.reduce((sum, c) => sum + c.bookmarkCount, 0),
                    allApplied: oldCategories.every(c => c.applied),
                }));
            } catch { }
        }

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
