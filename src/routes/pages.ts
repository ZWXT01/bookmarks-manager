/**
 * Pages Routes - 页面渲染路由
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getJob, countJobFailures, listJobFailuresPaged } from '../jobs';
import { getPlan as getOrganizePlan, computeDiff, getAssignmentApplicability, type Assignment } from '../ai-organize-plan';
import { getCategoryPathMap } from '../category-service';

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

        // ai_organize: fetch plan info for AJAX pagination
        let organizeAssignments: any[] = [];
        let organizePlanStatus: string | null = null;
        let organizePlanId: string | null = null;
        let organizeAssignmentPage = 1;
        let organizeAssignmentTotalPages = 1;
        let organizeAssignmentTotal = 0;
        let organizeDiff: any = null;
        const organizePageSize = 20;

        if (job.type === 'ai_organize') {
            const plan = db.prepare(`SELECT id, status, assignments FROM ai_organize_plans WHERE job_id = ? ORDER BY created_at DESC LIMIT 1`).get(jobId) as { id: string; status: string; assignments: string | null } | undefined;
            if (plan) {
                organizePlanId = plan.id;
                organizePlanStatus = plan.status;
                const fullPlanForPage = getOrganizePlan(db, plan.id);
                if (plan.status === 'preview' && fullPlanForPage) {
                    organizeDiff = computeDiff(db, fullPlanForPage);
                }
                const allAssignments: Assignment[] = plan.assignments ? JSON.parse(plan.assignments) : [];
                organizeAssignmentTotal = allAssignments.length;
                organizeAssignmentTotalPages = Math.max(1, Math.ceil(organizeAssignmentTotal / organizePageSize));
                organizeAssignmentPage = Math.min(Math.max(1, clamp(q.assign_page, 1, 10_000, 1)), organizeAssignmentTotalPages);
                const offset = (organizeAssignmentPage - 1) * organizePageSize;
                const pageSlice = allAssignments.slice(offset, offset + organizePageSize);

                const bmIds = pageSlice.map(a => a.bookmark_id);
                const bmMap = new Map<number, { title: string; url: string; category_id: number | null }>();
                if (bmIds.length) {
                    const rows = db.prepare(`SELECT id, title, url, category_id FROM bookmarks WHERE id IN (${bmIds.map(() => '?').join(',')})`).all(...bmIds) as Array<{ id: number; title: string; url: string; category_id: number | null }>;
                    for (const r of rows) bmMap.set(r.id, { title: r.title, url: r.url, category_id: r.category_id ?? null });
                }
                const categoryPathMap = getCategoryPathMap(db);

                organizeAssignments = pageSlice.map(a => {
                    const applicability = fullPlanForPage
                        ? getAssignmentApplicability(db, fullPlanForPage, a)
                        : { can_apply: false, invalid_reason: 'snapshot_missing', invalid_message: '计划安全快照缺失，无法应用' };
                    return {
                        bookmark_id: a.bookmark_id,
                        category_path: a.category_path,
                        status: a.status,
                        title: bmMap.get(a.bookmark_id)?.title ?? '[已删除的书签]',
                        url: bmMap.get(a.bookmark_id)?.url ?? '',
                        current_category: bmMap.get(a.bookmark_id)?.category_id != null
                            ? (categoryPathMap.get(bmMap.get(a.bookmark_id)!.category_id!) ?? null)
                            : null,
                        can_apply: applicability.can_apply,
                        default_action: applicability.can_apply ? 'apply' : 'discard',
                        invalid_reason: applicability.invalid_reason,
                        invalid_message: applicability.invalid_message,
                    };
                });
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
            organizeAssignments,
            organizePlanId,
            organizePlanStatus,
            organizeAssignmentPage,
            organizeAssignmentTotalPages,
            organizeAssignmentTotal,
            organizePageSize,
            organizeDiff,
            backUrl,
        });
    });

    done();
};
