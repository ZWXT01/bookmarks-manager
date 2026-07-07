import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { createOpenAIClient, extractAICompletionText, type AIChatCompletionRequest, type AIClientFactory } from '../ai-client';
import {
    getSingleClassifyAllowedPaths,
    normalizeClassifyPath,
    selectDeterministicSingleClassifyCategory,
    selectSingleClassifyCategory,
} from '../ai-classify-guardrail';
import { getConfiguredAiBatchSize, parseAiBatchSize } from '../ai-batch-size';
import { buildCategoryDescriptionGuide } from '../ai-category-taxonomy';
import { formatAiReasoningEffort, withAiReasoningEffort } from '../ai-reasoning-effort';
import { getCategoryPathMap, getCategoryTree } from '../category-service';
import {
    getAssignmentApplicability,
    getBlockingOrganizePlan,
    type Assignment,
    type BlockingOrganizePlan,
    type PlanRow,
    type PlanStatus,
} from '../ai-organize-plan';

export interface AIRoutesOptions {
    db: Database;
    getSetting: (key: string) => string | null;
    aiClientFactory?: AIClientFactory;
}

interface ModelsProbeResult {
    ok: boolean;
    statusCode: number | null;
    modelFound: boolean | null;
    errorMessage: string | null;
}

type OrganizeAssignmentRow = Assignment;

function getAIConfig(getSetting: (key: string) => string | null) {
    const baseUrl = (getSetting('ai_base_url') ?? '').trim();
    const apiKey = (getSetting('ai_api_key') ?? '').trim();
    const model = (getSetting('ai_model') ?? '').trim();
    const reasoningEffort = formatAiReasoningEffort(getSetting('ai_reasoning_effort'));
    if (!baseUrl || !apiKey || !model) return null;
    return { baseUrl, apiKey, model, reasoningEffort };
}

function buildProviderHeaders(apiKey: string): Record<string, string> {
    return {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
    };
}

function appendProviderPath(baseUrl: string, suffix: string) {
    return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

function parseProviderBody(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function extractProviderErrorMessage(body: unknown, fallback: string | null = null): string | null {
    if (typeof body === 'string' && body.trim()) return body.trim();
    if (body && typeof body === 'object') {
        const errorValue = (body as { error?: unknown }).error;
        if (typeof errorValue === 'string' && errorValue.trim()) return errorValue.trim();
        if (errorValue && typeof errorValue === 'object') {
            const nestedMessage = (errorValue as { message?: unknown }).message;
            if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim();
        }
        const messageValue = (body as { message?: unknown }).message;
        if (typeof messageValue === 'string' && messageValue.trim()) return messageValue.trim();
    }
    return fallback;
}

export const aiRoutes: FastifyPluginCallback<AIRoutesOptions> = (app, opts, done) => {
    const { db, getSetting } = opts;
    const aiClientFactory = opts.aiClientFactory ?? createOpenAIClient;

    function createAIClient(config: { baseUrl: string; apiKey: string }, timeout: number) {
        return aiClientFactory({
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            timeout,
        });
    }

    function getDefaultBatchSize() {
        return getConfiguredAiBatchSize(getSetting('ai_batch_size'));
    }

    function resolveBatchSize(rawValue: unknown) {
        if (rawValue === undefined || rawValue === null) return getDefaultBatchSize();
        if (typeof rawValue === 'string' && rawValue.trim() === '') return getDefaultBatchSize();
        return parseAiBatchSize(rawValue);
    }

    function enrichOrganizeAssignments(plan: Pick<PlanRow, 'source_snapshot'>, rows: OrganizeAssignmentRow[]) {
        const bookmarkIds = [...new Set(rows.map((row) => row.bookmark_id).filter((id) => Number.isInteger(id) && id > 0))];
        const bookmarks = new Map<number, { title: string; url: string; category_id: number | null }>();
        if (bookmarkIds.length > 0) {
            const bookmarkRows = db.prepare(`
                SELECT id, title, url, category_id
                FROM bookmarks
                WHERE id IN (${bookmarkIds.map(() => '?').join(',')})
            `).all(...bookmarkIds) as Array<{ id: number; title: string; url: string; category_id: number | null }>;
            for (const row of bookmarkRows) {
                bookmarks.set(row.id, {
                    title: row.title,
                    url: row.url,
                    category_id: row.category_id ?? null,
                });
            }
        }

        const categoryPathMap = getCategoryPathMap(db);
        return rows.map((row) => {
            const bookmark = bookmarks.get(row.bookmark_id);
            const applicability = getAssignmentApplicability(db, plan, row);
            const canApply = applicability.can_apply;
            return {
                bookmark_id: row.bookmark_id,
                category_path: row.category_path,
                status: row.status,
                title: bookmark?.title ?? '[已删除的书签]',
                url: bookmark?.url ?? '',
                current_category: bookmark?.category_id != null ? (categoryPathMap.get(bookmark.category_id) ?? null) : null,
                can_apply: canApply,
                default_action: canApply ? 'apply' : 'discard',
                invalid_reason: applicability.invalid_reason,
                invalid_message: applicability.invalid_message,
            };
        });
    }

    function getPlanJobMessage(jobId: string | null) {
        if (!jobId) return null;
        const row = db.prepare('SELECT message FROM jobs WHERE id = ?').get(jobId) as { message: string | null } | undefined;
        return row?.message ?? null;
    }

    function getBlockingRequiredAction(status: PlanStatus) {
        if (status === 'assigning') return 'wait_or_cancel';
        if (status === 'preview') return 'apply_or_discard';
        return 'retry_or_discard';
    }

    function getBlockingUserMessage(status: PlanStatus) {
        if (status === 'assigning') {
            return '上一次 AI 整理任务仍在执行，请等待完成，或先取消该任务后再开始新的整理。';
        }
        if (status === 'preview') {
            return '上一次 AI 整理结果尚未应用或放弃，请先应用/放弃后再开始新的整理。';
        }
        if (status === 'failed') {
            return '上一次 AI 整理任务失败且尚未放弃，请先重试或放弃后再开始新的整理。';
        }
        return '上一次 AI 整理任务中断且尚未放弃，请先重试或放弃后再开始新的整理。';
    }

    function buildBlockingPlanPayload(plan: BlockingOrganizePlan) {
        const payload: Record<string, unknown> = {
            error: plan.status === 'assigning'
                ? 'active plan already exists'
                : plan.status === 'preview'
                    ? 'pending plan already exists'
                    : 'unresolved plan already exists',
            message: getBlockingUserMessage(plan.status),
            blockingPlanId: plan.id,
            blockingJobId: plan.job_id ?? null,
            blockingStatus: plan.status,
            requiredAction: getBlockingRequiredAction(plan.status),
        };
        if (plan.status === 'assigning') {
            payload.activePlanId = plan.id;
        } else if (plan.status === 'preview') {
            payload.pendingPlanId = plan.id;
            payload.pendingJobId = plan.job_id ?? null;
        } else {
            payload.unresolvedPlanId = plan.id;
            payload.unresolvedJobId = plan.job_id ?? null;
        }
        return payload;
    }

    function buildPlanErrorPayload(error: any) {
        const payload: Record<string, unknown> = {
            error: error instanceof Error ? error.message : String(error),
        };
        if (error?.activePlanId) payload.activePlanId = error.activePlanId;
        if (error?.blockingPlanId) {
            payload.blockingPlanId = error.blockingPlanId;
            payload.blockingStatus = error.blockingPlanStatus ?? null;
            payload.blockingJobId = error.blockingJobId ?? null;
            if (error.blockingPlanStatus) {
                payload.message = getBlockingUserMessage(error.blockingPlanStatus);
                payload.requiredAction = getBlockingRequiredAction(error.blockingPlanStatus);
                if (error.blockingPlanStatus === 'preview') {
                    payload.pendingPlanId = error.blockingPlanId;
                    payload.pendingJobId = error.blockingJobId ?? null;
                } else if (error.blockingPlanStatus === 'failed' || error.blockingPlanStatus === 'error') {
                    payload.unresolvedPlanId = error.blockingPlanId;
                    payload.unresolvedJobId = error.blockingJobId ?? null;
                }
            }
        }
        if (error?.discardRecommended) {
            payload.discard_recommended = true;
            payload.recommended_action = 'discard';
            if (!payload.message) payload.message = '本次 AI 整理计划无法安全应用，建议放弃后重新开始。';
        }
        return payload;
    }

    function serializePlan(plan: Record<string, any>, options: { includeTargetTree?: boolean } = {}) {
        const result: any = {
            ...plan,
            message: getPlanJobMessage(plan.job_id ?? null),
        };
        if (plan.assignments) result.assignments = JSON.parse(plan.assignments);
        if (plan.failed_batch_ids) result.failed_batch_ids = JSON.parse(plan.failed_batch_ids);
        if (options.includeTargetTree && plan.target_tree) result.target_tree = JSON.parse(plan.target_tree);
        delete result.backup_snapshot;
        delete result.source_snapshot;
        delete result['tem' + 'plate' + '_id'];
        return result;
    }

    function isRetryableProviderError(error: unknown) {
        if (!error || typeof error !== 'object') return false;
        const message = typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : '';
        const normalized = message.toLowerCase();
        return normalized.includes('timed out')
            || normalized.includes('timeout')
            || normalized.includes('etimedout')
            || normalized.includes('econn')
            || normalized.includes('enotfound')
            || normalized.includes('socket hang up')
            || normalized.includes('network')
            || normalized.includes('connection');
    }

    async function probeModelsEndpoint(baseUrl: string, apiKey: string, model: string, timeoutMs: number): Promise<ModelsProbeResult> {
        try {
            const response = await fetch(appendProviderPath(baseUrl, '/models'), {
                method: 'GET',
                headers: buildProviderHeaders(apiKey),
                signal: AbortSignal.timeout(timeoutMs),
            });
            const body = parseProviderBody(await response.text());
            const data = body && typeof body === 'object' && Array.isArray((body as { data?: unknown[] }).data)
                ? (body as { data: Array<{ id?: unknown }> }).data
                : null;
            const ids = data
                ?.map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
                .filter(Boolean) ?? [];

            return {
                ok: response.ok,
                statusCode: response.status,
                modelFound: data ? ids.includes(model) : null,
                errorMessage: response.ok ? null : extractProviderErrorMessage(body, `HTTP ${response.status}`),
            };
        } catch (error) {
            return {
                ok: false,
                statusCode: null,
                modelFound: null,
                errorMessage: error instanceof Error ? error.message : String(error),
            };
        }
    }

    // POST /api/ai/classify - 单个书签分类（保留，浏览器扩展依赖）
    app.post('/api/ai/classify', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const url = typeof body.url === 'string' ? body.url.trim() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        const config = getAIConfig(getSetting);
        if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });
        if (!title && !url && !description) return reply.code(400).send({ error: '请提供标题、URL 或描述' });

        const allowedPaths = getSingleClassifyAllowedPaths(db);
        if (allowedPaths.length === 0) {
            return reply.code(400).send({ error: '请先创建分类' });
        }
        const candidateHint = '\n候选分类（必须原样选择其一，禁止输出候选之外的分类）：\n- ' + allowedPaths.join('\n- ');
        const descriptionHint = buildCategoryDescriptionGuide(allowedPaths);

        const prompt = '你是书签分类助手。优先联网访问目标网页；如具备 Web 搜索/网页访问能力，也可搜索核实网页内容后再分类。无法联网、无法访问或工具不可用时，再根据标题、URL、描述判断；不要编造访问结果。\n' +
            '规则：1.分类最多2级，禁止3级；2.必须从候选分类中精确选择一个最合适的结果并原样输出；3.优先选择最具体的二级分类，NSFW 成人内容必须优先归入绅士领域 [NSFW]；4.重点区分在线消费、离线下载、终端应用下载、效率工具、社区资讯。\n' +
            candidateHint + (descriptionHint ? '\n\n' + descriptionHint : '') + '\n只输出分类路径，不要解释。\n' +
            (title ? '标题: ' + title + '\n' : '') +
            (url ? '网址: ' + url + '\n' : '') +
            (description ? '描述: ' + description + '\n' : '');

        try {
            const aiClient = createAIClient(config, 60000);
            const completionRequest: AIChatCompletionRequest = {
                model: config.model,
                messages: [{
                    role: 'system',
                    content: '优先联网访问目标网页或使用 Web 搜索核实内容；你只能从用户提供的候选分类中选择一个最合适的分类路径，并原样输出；禁止创建分类；不要解释。',
                }, { role: 'user', content: prompt }],
                temperature: 0.2,
            };
            const completion = await aiClient.createChatCompletion(withAiReasoningEffort(completionRequest, config.reasoningEffort));
            const rawContent = extractAICompletionText(completion);
            if (!rawContent) return reply.code(502).send({ error: 'AI 未返回分类结果' });

            const resolvedCategory = selectSingleClassifyCategory({
                rawCategory: rawContent,
                allowedPaths,
                title,
                url,
                description,
            });
            if (!resolvedCategory) {
                req.log.warn({ rawCategory: rawContent, allowedPaths, title, url }, 'ai classify returned unmapped category');
                return reply.code(502).send({ error: 'AI 返回的分类不在当前分类树中' });
            }

            const normalized = normalizeClassifyPath(resolvedCategory);
            if (!normalized) return reply.code(502).send({ error: 'AI 未返回分类结果' });
            return reply.send({ category: normalized });
        } catch (e: any) {
            if (isRetryableProviderError(e)) {
                const fallbackCategory = selectDeterministicSingleClassifyCategory({
                    allowedPaths,
                    title,
                    url,
                    description,
                });
                if (fallbackCategory) {
                    const normalized = normalizeClassifyPath(fallbackCategory);
                    if (normalized) {
                        req.log.warn({ err: e, fallbackCategory: normalized, title, url }, 'ai classify degraded to deterministic fallback');
                        return reply.send({ category: normalized });
                    }
                }
            }
            req.log.error({ err: e }, 'ai classify failed');
            return reply.code(500).send({ error: e.message || 'AI 请求失败' });
        }
    });
    // POST /api/ai/test - 测试 AI 配置（保留）
    app.post('/api/ai/test', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const baseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : '';
        const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
        const model = typeof body.model === 'string' ? body.model.trim() : '';
        const reasoningEffort = formatAiReasoningEffort(body.reasoning_effort ?? body.ai_reasoning_effort);
        if (!baseUrl || !apiKey || !model) return reply.code(400).send({ error: '请填写完整的 AI 配置' });

        try {
            const aiClient = createAIClient({ apiKey, baseUrl }, 30000);
            let lastError: unknown = null;
            for (let attempt = 1; attempt <= 2; attempt += 1) {
                try {
                    const completionRequest: AIChatCompletionRequest = {
                        model,
                        messages: [{ role: 'user', content: '你好，请回复"OK"' }],
                        max_tokens: 10,
                    };
                    await aiClient.createChatCompletion(withAiReasoningEffort(completionRequest, reasoningEffort));
                    return reply.send({ success: true, message: 'AI 配置测试成功' });
                } catch (error) {
                    lastError = error;
                    if (!isRetryableProviderError(error) || attempt >= 2) {
                        throw error;
                    }
                    req.log.warn({ err: error, attempt }, 'ai test retrying after transient provider failure');
                }
            }
            throw lastError;
        } catch (e: any) {
            if (isRetryableProviderError(e)) {
                const probe = await probeModelsEndpoint(baseUrl, apiKey, model, 10_000);
                if (probe.ok && probe.modelFound) {
                    req.log.warn({ err: e, probe }, 'ai test timed out after retries but models probe succeeded');
                    return reply.code(500).send({
                        error: 'AI 配置基础连通正常，但聊天补全接口超时',
                        diagnostic: {
                            models_ok: true,
                            model_found: true,
                            models_status: probe.statusCode,
                        },
                    });
                }
                if (probe.ok && probe.modelFound === false) {
                    req.log.warn({ err: e, probe }, 'ai test timed out after retries and configured model was not found');
                    return reply.code(500).send({
                        error: 'AI 端点可连通，但当前模型不存在或不可访问',
                        diagnostic: {
                            models_ok: true,
                            model_found: false,
                            models_status: probe.statusCode,
                        },
                    });
                }
                if (!probe.ok) {
                    req.log.warn({ err: e, probe }, 'ai test timed out after retries and models probe also failed');
                    return reply.code(500).send({
                        error: e.message || 'AI 测试失败',
                        diagnostic: {
                            models_ok: false,
                            model_found: null,
                            models_status: probe.statusCode,
                            models_error: probe.errorMessage,
                        },
                    });
                }
            }
            req.log.error({ err: e }, 'ai test failed');
            return reply.code(500).send({ error: e.message || 'AI 测试失败' });
        }
    });

    // POST /api/ai/classify-batch - 多入口批量 AI 分类
    app.post('/api/ai/classify-batch', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const rawIds = body.bookmark_ids;
        const batchSize = resolveBatchSize(body.batch_size);

        if (!Array.isArray(rawIds) || rawIds.length === 0) {
            return reply.code(400).send({ error: '请提供书签 ID 列表' });
        }
        const ids = [...new Set(rawIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0))];
        if (ids.length === 0) return reply.code(400).send({ error: '无有效的书签 ID' });

        if (!batchSize) {
            return reply.code(400).send({ error: 'batch_size 必须为 10、20 或 30' });
        }

        const blockingPlan = getBlockingOrganizePlan(db);
        if (blockingPlan) return reply.code(409).send(buildBlockingPlanPayload(blockingPlan));

        const config = getAIConfig(getSetting);
        if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });
        if (getCategoryTree(db).length === 0) return reply.code(400).send({ error: '请先创建分类' });

        try {
            const { createPlan, updatePlan } = await import('../ai-organize-plan');
            const { assignBookmarks, failPlanExecution } = await import('../ai-organize');
            const { createJob, jobQueue, updateJob } = await import('../jobs');

            const plan = createPlan(db, 'ids:' + ids.join(','));
            const job = createJob(db, 'ai_organize', `AI 批量分类 (${ids.length} 个书签)`, ids.length);
            updatePlan(db, plan.id, { job_id: job.id });

            jobQueue.enqueue(job.id, async () => {
                try {
                    await assignBookmarks(db, plan.id, config, {}, batchSize, aiClientFactory);
                } catch (e: any) {
                    failPlanExecution(db, plan.id, e);
                    updateJob(db, job.id, {
                        status: 'failed',
                        message: e instanceof Error && e.message ? e.message : String(e),
                    });
                }
            });

            return reply.send({ success: true, planId: plan.id, jobId: job.id });
        } catch (e: any) {
            req.log.error({ err: e }, 'classify-batch failed');
            return reply.code(e.statusCode || 500).send(buildPlanErrorPayload(e));
        }
    });

    // ==================== AI Organize Routes ====================

    // POST /api/ai/organize - 启动整理（直接进入 assigning）
    app.post('/api/ai/organize', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const scope = typeof body.scope === 'string' ? body.scope.trim() : 'all';
        const batchSize = resolveBatchSize(body.batch_size);

        if (!batchSize) {
            return reply.code(400).send({ error: 'batch_size 必须为 10、20 或 30' });
        }

        // Validate scope parameter
        const validScopes = ['all', 'uncategorized'];
        const isCategoryScope = scope.startsWith('category:');
        const isIdsScope = scope.startsWith('ids:');
        if (!validScopes.includes(scope) && !isCategoryScope && !isIdsScope) {
            return reply.code(400).send({ error: 'scope 参数无效，必须为 all、uncategorized、category:N 或 ids:N,N,N' });
        }

        const blockingPlan = getBlockingOrganizePlan(db);
        if (blockingPlan) return reply.code(409).send(buildBlockingPlanPayload(blockingPlan));

        const config = getAIConfig(getSetting);
        if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });
        if (getCategoryTree(db).length === 0) return reply.code(400).send({ error: '请先创建分类' });

        try {
            const { createPlan, updatePlan } = await import('../ai-organize-plan');
            const { assignBookmarks, failPlanExecution } = await import('../ai-organize');
            const { createJob, jobQueue, updateJob } = await import('../jobs');

            const plan = createPlan(db, scope);
            const job = createJob(db, 'ai_organize', `AI 整理 (${scope})`, 0);
            updatePlan(db, plan.id, { job_id: job.id });

            jobQueue.enqueue(job.id, async () => {
                try {
                    await assignBookmarks(db, plan.id, config, {}, batchSize, aiClientFactory);
                } catch (e: any) {
                    failPlanExecution(db, plan.id, e);
                    updateJob(db, job.id, {
                        status: 'failed',
                        message: e instanceof Error && e.message ? e.message : String(e),
                    });
                }
            });

            return reply.send({ success: true, planId: plan.id, jobId: job.id });
        } catch (e: any) {
            req.log.error({ err: e }, 'organize start failed');
            return reply.code(e.statusCode || 500).send(buildPlanErrorPayload(e));
        }
    });

    // GET /api/ai/organize/active - 仅返回 assigning 状态的 Plan
    app.get('/api/ai/organize/active', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            const { getActivePlan } = await import('../ai-organize-plan');
            const plan = getActivePlan(db);
            if (!plan) return reply.send({ active: null });

            return reply.send(serializePlan(plan));
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // GET /api/ai/organize/pending - 返回所有 preview 状态的 Plan
    app.get('/api/ai/organize/pending', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            const rows = db.prepare(`SELECT * FROM ai_organize_plans WHERE status = 'preview' ORDER BY created_at DESC`).all() as any[];
            const plans = rows.map((p) => serializePlan(p));
            return reply.send({ plans });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // GET /api/ai/organize/blocking - 返回会阻止下一次 AI 整理的残留计划
    app.get('/api/ai/organize/blocking', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            const blocking = getBlockingOrganizePlan(db);
            if (!blocking) return reply.send({ blocking: null });

            const row = db.prepare('SELECT * FROM ai_organize_plans WHERE id = ?').get(blocking.id) as any | undefined;
            return reply.send({
                blocking: row ? serializePlan(row, { includeTargetTree: true }) : null,
                ...buildBlockingPlanPayload(blocking),
            });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // GET /api/ai/organize/:planId - 获取 Plan 详情
    app.get('/api/ai/organize/:planId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        try {
            const { getPlan, computeDiff } = await import('../ai-organize-plan');
            const plan = getPlan(db, planId);
            if (!plan) return reply.code(404).send({ error: 'Plan 不存在' });

            const result: any = serializePlan(plan, { includeTargetTree: true });

            if ((plan.status === 'preview' || plan.status === 'assigning') && plan.assignments) {
                result.diff = computeDiff(db, plan);
            }

            return reply.send(result);
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // GET /api/ai/organize/:planId/assignments - 分页获取 enriched assignments
    app.get('/api/ai/organize/:planId/assignments', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        const q: any = (req as any).query || {};
        const page = Math.max(1, parseInt(q.page, 10) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(q.page_size, 10) || 20));

        try {
            const { getPlan } = await import('../ai-organize-plan');
            const plan = getPlan(db, planId);
            if (!plan) return reply.code(404).send({ error: 'Plan 不存在' });

            const all: OrganizeAssignmentRow[] = plan.assignments ? JSON.parse(plan.assignments) : [];
            const total = all.length;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const pageClamped = Math.min(page, totalPages);
            const offset = (pageClamped - 1) * pageSize;
            const slice = all.slice(offset, offset + pageSize);
            const assignments = enrichOrganizeAssignments(plan, slice);

            return reply.send({ assignments, total, page: pageClamped, totalPages, pageSize });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // POST /api/ai/organize/:planId/apply - 原子应用（空分类检测）
    app.post('/api/ai/organize/:planId/apply', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        const body: any = req.body || {};
        try {
            const { applyPlan, transitionStatus } = await import('../ai-organize-plan');
            const result = applyPlan(db, planId, body.decisions);
            const needsConfirm = result.conflicts.length > 0 || result.empty_categories.length > 0;
            if (!needsConfirm) transitionStatus(db, planId, 'applied');
            return reply.send({ success: true, needs_confirm: needsConfirm, ...result });
        } catch (e: any) {
            return reply.code(e.statusCode || 500).send(buildPlanErrorPayload(e));
        }
    });

    // POST /api/ai/organize/:planId/apply/resolve - 冲突解决后最终应用
    app.post('/api/ai/organize/:planId/apply/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        const body: any = req.body || {};
        try {
            const { resolveAndApply } = await import('../ai-organize-plan');
            const result = resolveAndApply(db, planId, {
                decisions: body.decisions,
                conflicts: body.conflicts,
                empty_categories: body.empty_categories,
            });
            return reply.send({ success: true, ...result });
        } catch (e: any) {
            return reply.code(e.statusCode || 500).send(buildPlanErrorPayload(e));
        }
    });

    // POST /api/ai/organize/:planId/apply/confirm-empty - 空分类确认
    app.post('/api/ai/organize/:planId/apply/confirm-empty', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        const body: any = req.body || {};
        const decisions = body.decisions;
        if (!Array.isArray(decisions)) return reply.code(400).send({ error: '请提供 decisions 数组' });
        try {
            const { confirmEmpty } = await import('../ai-organize-plan');
            const result = confirmEmpty(db, planId, decisions);
            return reply.send({ success: true, ...result });
        } catch (e: any) {
            return reply.code(e.statusCode || 500).send(buildPlanErrorPayload(e));
        }
    });

    // POST /api/ai/organize/:planId/rollback - 回滚
    app.post('/api/ai/organize/:planId/rollback', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        try {
            const { rollbackPlan } = await import('../ai-organize-plan');
            const result = rollbackPlan(db, planId);
            return reply.send({ success: true, ...result });
        } catch (e: any) {
            return reply.code(e.statusCode || 500).send({ error: e.message });
        }
    });

    // POST /api/ai/organize/:planId/cancel - 取消
    app.post('/api/ai/organize/:planId/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        try {
            const { transitionStatus } = await import('../ai-organize-plan');
            const plan = transitionStatus(db, planId, 'canceled');
            return reply.send({ success: true, status: plan.status });
        } catch (e: any) {
            return reply.code(e.statusCode || 500).send({ error: e.message });
        }
    });

    // POST /api/ai/organize/:planId/retry - 从 failed 恢复
    app.post('/api/ai/organize/:planId/retry', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        try {
            const { getPlan, transitionStatus } = await import('../ai-organize-plan');
            const currentPlan = getPlan(db, planId);
            if (!currentPlan) return reply.code(404).send({ error: 'plan not found' });
            if (currentPlan.status !== 'failed' && currentPlan.status !== 'error') {
                return reply.code(409).send({ error: `invalid transition: ${currentPlan.status} → assigning` });
            }

            const blockingPlan = getBlockingOrganizePlan(db, planId);
            if (blockingPlan) return reply.code(409).send(buildBlockingPlanPayload(blockingPlan));

            const config = getAIConfig(getSetting);
            if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });
            if (getCategoryTree(db).length === 0) return reply.code(400).send({ error: '请先创建分类' });

            const plan = transitionStatus(db, planId, 'assigning');

            // restart assignment job
            if (plan.status === 'assigning' && plan.job_id) {
                const { assignBookmarks, failPlanExecution } = await import('../ai-organize');
                const { jobQueue, updateJob } = await import('../jobs');
                const batchSize = getDefaultBatchSize();
                jobQueue.enqueue(plan.job_id, async () => {
                    try {
                        await assignBookmarks(db, planId, config, {}, batchSize, aiClientFactory);
                    } catch (e: any) {
                        failPlanExecution(db, planId, e);
                        updateJob(db, plan.job_id!, {
                            status: 'failed',
                            message: e instanceof Error && e.message ? e.message : String(e),
                        });
                    }
                });
            }

            return reply.send({ success: true, status: plan.status });
        } catch (e: any) {
            return reply.code(e.statusCode || 500).send(buildPlanErrorPayload(e));
        }
    });

    done();
};
