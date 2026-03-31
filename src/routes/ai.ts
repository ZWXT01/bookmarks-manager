import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { createOpenAIClient, extractAICompletionText, type AIClientFactory } from '../ai-client';
import {
    getSingleClassifyAllowedPaths,
    normalizeClassifyPath,
    selectDeterministicSingleClassifyCategory,
    selectSingleClassifyCategory,
} from '../ai-classify-guardrail';
import { getConfiguredAiBatchSize, parseAiBatchSize } from '../ai-batch-size';

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

function getAIConfig(getSetting: (key: string) => string | null) {
    const baseUrl = (getSetting('ai_base_url') ?? '').trim();
    const apiKey = (getSetting('ai_api_key') ?? '').trim();
    const model = (getSetting('ai_model') ?? '').trim();
    if (!baseUrl || !apiKey || !model) return null;
    return { baseUrl, apiKey, model };
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
        const candidateHint = allowedPaths.length > 0
            ? '\n候选分类（必须原样选择其一，禁止输出候选之外的分类）：\n- ' + allowedPaths.join('\n- ')
            : '\n标准一级分类：技术开发、学习资源、工具软件、购物电商、娱乐影音、社交媒体、新闻资讯、设计素材、生活服务、游戏、成人内容、其他';

        const prompt = '你是书签分类助手。通过联网访问网页了解内容后分类。\n' +
            '规则：1.分类最多2级(如:技术/编程)，禁止3级！2.如果提供了候选分类，必须从候选分类中精确选择一个最合适的结果并原样输出\n' +
            candidateHint + '\n只输出分类路径，不要解释。\n' +
            (title ? '标题: ' + title + '\n' : '') +
            (url ? '网址: ' + url + '\n' : '') +
            (description ? '描述: ' + description + '\n' : '');

        try {
            const aiClient = createAIClient(config, 60000);
            const completion = await aiClient.createChatCompletion({
                model: config.model,
                messages: [{
                    role: 'system',
                    content: allowedPaths.length > 0
                        ? '你只能从用户提供的候选分类中选择一个最合适的分类路径，并原样输出；不要解释。'
                        : '只输出分类路径（最多2级），不要解释。',
                }, { role: 'user', content: prompt }],
                temperature: 0.2,
            });
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
        if (!baseUrl || !apiKey || !model) return reply.code(400).send({ error: '请填写完整的 AI 配置' });

        try {
            const aiClient = createAIClient({ apiKey, baseUrl }, 30000);
            let lastError: unknown = null;
            for (let attempt = 1; attempt <= 2; attempt += 1) {
                try {
                    await aiClient.createChatCompletion({
                        model,
                        messages: [{ role: 'user', content: '你好，请回复"OK"' }],
                        max_tokens: 10,
                    });
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
        const templateId = typeof body.template_id === 'number' ? body.template_id : null;

        if (!Array.isArray(rawIds) || rawIds.length === 0) {
            return reply.code(400).send({ error: '请提供书签 ID 列表' });
        }
        const ids = [...new Set(rawIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0))];
        if (ids.length === 0) return reply.code(400).send({ error: '无有效的书签 ID' });

        if (!batchSize) {
            return reply.code(400).send({ error: 'batch_size 必须为 10、20 或 30' });
        }

        const config = getAIConfig(getSetting);
        if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });

        try {
            const { getActiveTemplate, getTemplate } = await import('../template-service');

            let targetTemplateId = templateId;
            if (targetTemplateId !== null) {
                const template = getTemplate(db, targetTemplateId);
                if (!template) return reply.code(400).send({ error: '指定的模板不存在' });
            } else {
                const activeTemplate = getActiveTemplate(db);
                if (!activeTemplate) return reply.code(400).send({ error: '请先应用一个分类模板' });
                targetTemplateId = activeTemplate.id;
            }

            const { createPlan, updatePlan } = await import('../ai-organize-plan');
            const { assignBookmarks } = await import('../ai-organize');
            const { createJob, jobQueue, updateJob } = await import('../jobs');

            const plan = createPlan(db, 'ids:' + ids.join(','), targetTemplateId);
            const job = createJob(db, 'ai_organize', `AI 批量分类 (${ids.length} 个书签)`, ids.length);
            updatePlan(db, plan.id, { job_id: job.id });

            jobQueue.enqueue(job.id, async () => {
                try {
                    await assignBookmarks(db, plan.id, config, {}, batchSize, aiClientFactory);
                } catch (e: any) {
                    updateJob(db, job.id, { status: 'failed', message: e.message });
                }
            });

            return reply.send({ success: true, planId: plan.id, jobId: job.id });
        } catch (e: any) {
            req.log.error({ err: e }, 'classify-batch failed');
            const resp: Record<string, unknown> = { error: e.message };
            if (e.statusCode === 409 && e.activePlanId) resp.activePlanId = e.activePlanId;
            return reply.code(e.statusCode || 500).send(resp);
        }
    });

    // ==================== AI Organize Routes ====================

    // POST /api/ai/organize - 启动整理（直接进入 assigning）
    app.post('/api/ai/organize', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const scope = typeof body.scope === 'string' ? body.scope.trim() : 'all';
        const batchSize = resolveBatchSize(body.batch_size);
        const templateId = typeof body.template_id === 'number' ? body.template_id : null;
        const config = getAIConfig(getSetting);
        if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });

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

        try {
            const { getActiveTemplate, getTemplate } = await import('../template-service');
            const activeTemplate = getActiveTemplate(db);
            if (!activeTemplate) return reply.code(400).send({ error: '请先应用一个分类模板' });

            // Validate template_id if provided
            let targetTemplateId = templateId;
            if (targetTemplateId !== null) {
                const template = getTemplate(db, targetTemplateId);
                if (!template) {
                    return reply.code(400).send({ error: '指定的模板不存在' });
                }
            } else {
                // Use active template if not specified
                targetTemplateId = activeTemplate.id;
            }

            const { createPlan, updatePlan } = await import('../ai-organize-plan');
            const { assignBookmarks } = await import('../ai-organize');
            const { createJob, jobQueue, updateJob } = await import('../jobs');

            const plan = createPlan(db, scope, targetTemplateId);
            const job = createJob(db, 'ai_organize', `AI 整理 (${scope})`, 0);
            updatePlan(db, plan.id, { job_id: job.id });

            jobQueue.enqueue(job.id, async () => {
                try {
                    await assignBookmarks(db, plan.id, config, {}, batchSize, aiClientFactory);
                } catch (e: any) {
                    updateJob(db, job.id, { status: 'failed', message: e.message });
                }
            });

            return reply.send({ success: true, planId: plan.id, jobId: job.id });
        } catch (e: any) {
            req.log.error({ err: e }, 'organize start failed');
            const resp: Record<string, unknown> = { error: e.message };
            if (e.statusCode === 409 && e.activePlanId) resp.activePlanId = e.activePlanId;
            return reply.code(e.statusCode || 500).send(resp);
        }
    });

    // GET /api/ai/organize/active - 仅返回 assigning 状态的 Plan
    app.get('/api/ai/organize/active', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            const { getActivePlan } = await import('../ai-organize-plan');
            const plan = getActivePlan(db);
            if (!plan) return reply.send({ active: null });

            const result: any = { ...plan };
            if (plan.assignments) result.assignments = JSON.parse(plan.assignments);
            if (plan.failed_batch_ids) result.failed_batch_ids = JSON.parse(plan.failed_batch_ids);
            delete result.backup_snapshot;
            delete result.source_snapshot;

            return reply.send(result);
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // GET /api/ai/organize/pending - 返回所有 preview 状态的 Plan
    app.get('/api/ai/organize/pending', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            const rows = db.prepare(`SELECT * FROM ai_organize_plans WHERE status = 'preview' ORDER BY created_at DESC`).all() as any[];
            const plans = rows.map(p => {
                const r: any = { ...p };
                if (p.assignments) r.assignments = JSON.parse(p.assignments);
                if (p.failed_batch_ids) r.failed_batch_ids = JSON.parse(p.failed_batch_ids);
                delete r.backup_snapshot;
                delete r.source_snapshot;
                return r;
            });
            return reply.send({ plans });
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

            const result: any = { ...plan };
            if (plan.target_tree) result.target_tree = JSON.parse(plan.target_tree);
            if (plan.assignments) result.assignments = JSON.parse(plan.assignments);
            if (plan.failed_batch_ids) result.failed_batch_ids = JSON.parse(plan.failed_batch_ids);
            delete result.backup_snapshot; // don't send snapshot to client
            delete result.source_snapshot;

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

            const all: { bookmark_id: number; category_path: string; status: string }[] = plan.assignments ? JSON.parse(plan.assignments) : [];
            const total = all.length;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const pageClamped = Math.min(page, totalPages);
            const offset = (pageClamped - 1) * pageSize;
            const slice = all.slice(offset, offset + pageSize);

            const bmIds = slice.map(a => a.bookmark_id);
            const bmMap = new Map<number, { title: string; url: string }>();
            if (bmIds.length) {
                const rows = db.prepare(`SELECT id, title, url FROM bookmarks WHERE id IN (${bmIds.map(() => '?').join(',')})`).all(...bmIds) as { id: number; title: string; url: string }[];
                for (const r of rows) bmMap.set(r.id, { title: r.title, url: r.url });
            }

            const assignments = slice.map(a => ({
                bookmark_id: a.bookmark_id,
                category_path: a.category_path,
                status: a.status,
                title: bmMap.get(a.bookmark_id)?.title ?? '[已删除的书签]',
                url: bmMap.get(a.bookmark_id)?.url ?? '',
            }));

            return reply.send({ assignments, total, page: pageClamped, totalPages, pageSize });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // POST /api/ai/organize/:planId/apply - 原子应用（空分类检测）
    app.post('/api/ai/organize/:planId/apply', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        try {
            const { applyPlan, getPlan, transitionStatus } = await import('../ai-organize-plan');
            const result = applyPlan(db, planId);
            const needsConfirm = result.conflicts.length > 0 || result.empty_categories.length > 0;
            if (!needsConfirm) transitionStatus(db, planId, 'applied');
            let template_name: string | null = null;
            const plan = getPlan(db, planId);
            if (plan?.template_id) {
                const { getTemplate } = await import('../template-service');
                const tpl = getTemplate(db, plan.template_id);
                if (tpl) template_name = tpl.name;
            }
            return reply.send({ success: true, needs_confirm: needsConfirm, template_name, ...result });
        } catch (e: any) {
            return reply.code(e.statusCode || 500).send({ error: e.message });
        }
    });

    // POST /api/ai/organize/:planId/apply/resolve - 冲突解决后最终应用
    app.post('/api/ai/organize/:planId/apply/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        const body: any = req.body || {};
        try {
            const { resolveAndApply } = await import('../ai-organize-plan');
            const result = resolveAndApply(db, planId, {
                conflicts: body.conflicts,
                empty_categories: body.empty_categories,
            });
            return reply.send({ success: true, ...result });
        } catch (e: any) {
            return reply.code(e.statusCode || 500).send({ error: e.message });
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
            return reply.code(e.statusCode || 500).send({ error: e.message });
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
            const config = getAIConfig(getSetting);
            if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });

            const { transitionStatus } = await import('../ai-organize-plan');
            const plan = transitionStatus(db, planId, 'assigning');

            // restart assignment job
            if (plan.status === 'assigning' && plan.job_id) {
                const { assignBookmarks } = await import('../ai-organize');
                const { jobQueue, updateJob } = await import('../jobs');
                const batchSize = getDefaultBatchSize();
                jobQueue.enqueue(plan.job_id, async () => {
                    try {
                        await assignBookmarks(db, planId, config, {}, batchSize, aiClientFactory);
                    } catch (e: any) {
                        updateJob(db, plan.job_id!, { status: 'failed', message: e.message });
                    }
                });
            }

            return reply.send({ success: true, status: plan.status });
        } catch (e: any) {
            const resp: Record<string, unknown> = { error: e.message };
            if (e.statusCode === 409 && e.activePlanId) resp.activePlanId = e.activePlanId;
            return reply.code(e.statusCode || 500).send(resp);
        }
    });

    done();
};
