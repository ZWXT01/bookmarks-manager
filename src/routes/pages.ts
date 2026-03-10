/**
 * Pages Routes - 页面渲染路由
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getJob, countJobFailures, listJobFailuresPaged } from '../jobs';
import { getPlan as getOrganizePlan, computeDiff } from '../ai-organize-plan';
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

        // ai_organize: fetch plan info for AJAX pagination
        let organizeAssignments: any[] = [];
        let organizePlanStatus: string | null = null;
        let organizePlanId: string | null = null;
        let organizePlanTemplateName: string | null = null;
        let organizeAssignmentPage = 1;
        let organizeAssignmentTotalPages = 1;
        let organizeAssignmentTotal = 0;
        let organizeDiff: any = null;
        const organizePageSize = 20;

        if (job.type === 'ai_organize') {
            const plan = db.prepare(`SELECT id, status, assignments, template_id FROM ai_organize_plans WHERE job_id = ? ORDER BY created_at DESC LIMIT 1`).get(jobId) as { id: string; status: string; assignments: string | null; template_id: number | null } | undefined;
            if (plan) {
                organizePlanId = plan.id;
                if (plan.template_id) {
                    const tpl = db.prepare('SELECT name FROM category_templates WHERE id = ?').get(plan.template_id) as { name: string } | undefined;
                    if (tpl) organizePlanTemplateName = tpl.name;
                }
                organizePlanStatus = plan.status;
                if (plan.status === 'preview') {
                    const fullPlan = getOrganizePlan(db, plan.id);
                    if (fullPlan) organizeDiff = computeDiff(db, fullPlan);
                }
                const allAssignments: { bookmark_id: number; category_path: string; status: string }[] = plan.assignments ? JSON.parse(plan.assignments) : [];
                organizeAssignmentTotal = allAssignments.length;
                organizeAssignmentTotalPages = Math.max(1, Math.ceil(organizeAssignmentTotal / organizePageSize));
                organizeAssignmentPage = Math.min(Math.max(1, clamp(q.assign_page, 1, 10_000, 1)), organizeAssignmentTotalPages);
                const offset = (organizeAssignmentPage - 1) * organizePageSize;
                const pageSlice = allAssignments.slice(offset, offset + organizePageSize);

                const bmIds = pageSlice.map(a => a.bookmark_id);
                const bmMap = new Map<number, { title: string; url: string }>();
                if (bmIds.length) {
                    const rows = db.prepare(`SELECT id, title, url FROM bookmarks WHERE id IN (${bmIds.map(() => '?').join(',')})`).all(...bmIds) as { id: number; title: string; url: string }[];
                    for (const r of rows) bmMap.set(r.id, { title: r.title, url: r.url });
                }

                organizeAssignments = pageSlice.map(a => ({
                    bookmark_id: a.bookmark_id,
                    category_path: a.category_path,
                    status: a.status,
                    title: bmMap.get(a.bookmark_id)?.title ?? '[已删除的书签]',
                    url: bmMap.get(a.bookmark_id)?.url ?? '',
                }));
            }
        }

        const referer = req.headers.referer ?? '';
        const backUrl = referer.includes('/jobs') ? '/jobs' : '/';

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
            organizeAssignments,
            organizePlanId,
            organizePlanStatus,
            organizeAssignmentPage,
            organizeAssignmentTotalPages,
            organizeAssignmentTotal,
            organizePageSize,
            organizePlanTemplateName,
            organizeDiff,
            backUrl,
        });
    });

    done();
};
