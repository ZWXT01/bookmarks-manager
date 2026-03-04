import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import OpenAI from 'openai';

export interface AIRoutesOptions {
    db: Database;
    getSetting: (key: string) => string | null;
}

function getAIConfig(getSetting: (key: string) => string | null) {
    const baseUrl = (getSetting('ai_base_url') ?? '').trim();
    const apiKey = (getSetting('ai_api_key') ?? '').trim();
    const model = (getSetting('ai_model') ?? '').trim();
    if (!baseUrl || !apiKey || !model) return null;
    return { baseUrl, apiKey, model };
}

export const aiRoutes: FastifyPluginCallback<AIRoutesOptions> = (app, opts, done) => {
    const { db, getSetting } = opts;

    // POST /api/ai/classify - 单个书签分类（保留，浏览器扩展依赖）
    app.post('/api/ai/classify', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const url = typeof body.url === 'string' ? body.url.trim() : '';
        const config = getAIConfig(getSetting);
        if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });
        if (!title && !url) return reply.code(400).send({ error: '请提供标题或URL' });

        const cats = db.prepare('SELECT name FROM categories').all() as { name: string }[];
        const topCats = [...new Set(cats.map(c => c.name.split('/')[0]).filter(Boolean))].slice(0, 15);
        const hint = topCats.length ? `\n已有一级分类：${topCats.join('、')}` : '';

        const prompt = '你是书签分类助手。通过联网访问网页了解内容后分类。\n' +
            '规则：1.分类最多2级(如:技术/编程)，禁止3级！2.优先使用已有一级分类\n' +
            '标准一级分类：技术开发、学习资源、工具软件、购物电商、娱乐影音、社交媒体、新闻资讯、设计素材、生活服务、游戏、成人内容、其他' +
            hint + '\n只输出分类路径，不要解释。\n' +
            (title ? '标题: ' + title + '\n' : '') + (url ? '网址: ' + url + '\n' : '');

        try {
            const openai = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl.replace(/\/+$/, ''), timeout: 60000, defaultHeaders: { 'User-Agent': 'bookmarks-manager/1.0' } });
            const completion = await openai.chat.completions.create({
                model: config.model,
                messages: [{ role: 'system', content: '只输出分类路径（最多2级），不要解释。' }, { role: 'user', content: prompt }],
                temperature: 0.2,
            });
            let content = completion.choices?.[0]?.message?.content?.trim() || '';
            if (!content) return reply.code(502).send({ error: 'AI 未返回分类结果' });
            const parts = content.split('/').filter((p: string) => p.trim());
            if (parts.length > 2) content = parts.slice(0, 2).join('/');
            return reply.send({ category: content });
        } catch (e: any) {
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
            const openai = new OpenAI({ apiKey, baseURL: baseUrl.replace(/\/+$/, ''), timeout: 30000, defaultHeaders: { 'User-Agent': 'bookmarks-manager/1.0' } });
            await openai.chat.completions.create({ model, messages: [{ role: 'user', content: '你好，请回复"OK"' }], max_tokens: 10 });
            return reply.send({ success: true, message: 'AI 配置测试成功' });
        } catch (e: any) {
            req.log.error({ err: e }, 'ai test failed');
            return reply.code(500).send({ error: e.message || 'AI 测试失败' });
        }
    });

    // ==================== AI Organize Routes ====================

    // POST /api/ai/organize - 启动整理
    app.post('/api/ai/organize', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const scope = typeof body.scope === 'string' ? body.scope.trim() : 'all';
        const config = getAIConfig(getSetting);
        if (!config) return reply.code(400).send({ error: '请先在设置页配置 AI' });

        try {
            const { createPlan } = await import('../ai-organize-plan');
            const { designCategoryTree, assignBookmarks } = await import('../ai-organize');
            const { jobQueue, updateJob } = await import('../jobs');

            const plan = createPlan(db, scope);

            // auto mode: AI designs tree, then starts assignment
            const { getPlan, updatePlan, updatePlanTree, transitionStatus } = await import('../ai-organize-plan');

            try {
                const tree = await designCategoryTree(db, config, scope);
                updatePlan(db, plan.id, { target_tree: JSON.stringify(tree) });
            } catch (e: any) {
                req.log.error({ err: e }, 'ai design category tree failed');
                return reply.send({ success: true, planId: plan.id, treeReady: false, message: e.message });
            }

            return reply.send({ success: true, planId: plan.id, treeReady: true });
        } catch (e: any) {
            req.log.error({ err: e }, 'organize start failed');
            const body: Record<string, unknown> = { error: e.message };
            if (e.statusCode === 409 && e.activePlanId) body.activePlanId = e.activePlanId;
            return reply.code(e.statusCode || 500).send(body);
        }
    });

    // GET /api/ai/organize/active - 获取当前活跃 Plan
    app.get('/api/ai/organize/active', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            const { getActivePlan, computeDiff } = await import('../ai-organize-plan');
            const plan = getActivePlan(db);
            if (!plan) return reply.send({ active: null });

            const result: any = { ...plan };
            if (plan.target_tree) result.target_tree = JSON.parse(plan.target_tree);
            if (plan.assignments) result.assignments = JSON.parse(plan.assignments);
            if (plan.failed_batch_ids) result.failed_batch_ids = JSON.parse(plan.failed_batch_ids);
            delete result.backup_snapshot;

            if (plan.status === 'preview' && plan.assignments) {
                result.diff = computeDiff(db, plan);
            }

            return reply.send(result);
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

            if (plan.status === 'preview' && plan.assignments) {
                result.diff = computeDiff(db, plan);
            }

            return reply.send(result);
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // PUT /api/ai/organize/:planId/tree - 编辑分类树
    app.put('/api/ai/organize/:planId/tree', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        const body: any = req.body || {};
        const tree = body.tree;
        const confirm = body.confirm === true;

        if (!Array.isArray(tree)) return reply.code(400).send({ error: '请提供分类树数组' });

        try {
            const { updatePlanTree, getPlan } = await import('../ai-organize-plan');
            const plan = updatePlanTree(db, planId, tree, confirm);

            // if confirmed, start assignment job
            if (confirm && plan.status === 'assigning' && plan.job_id) {
                const config = getAIConfig(getSetting);
                if (config) {
                    const { assignBookmarks } = await import('../ai-organize');
                    const { jobQueue, updateJob } = await import('../jobs');
                    jobQueue.enqueue(plan.job_id, async () => {
                        try {
                            await assignBookmarks(db, planId, config, body.retryConfig);
                        } catch (e: any) {
                            updateJob(db, plan.job_id!, { status: 'failed', message: e.message });
                        }
                    });
                }
            }

            return reply.send({ success: true, plan: { ...plan, backup_snapshot: undefined } });
        } catch (e: any) {
            return reply.code(400).send({ error: e.message });
        }
    });

    // POST /api/ai/organize/:planId/apply - 原子应用
    app.post('/api/ai/organize/:planId/apply', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        try {
            const { applyPlan } = await import('../ai-organize-plan');
            const result = applyPlan(db, planId);
            return reply.send({ success: true, ...result });
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
            return reply.code(500).send({ error: e.message });
        }
    });

    // POST /api/ai/organize/:planId/retry - 从 failed 恢复
    app.post('/api/ai/organize/:planId/retry', async (req: FastifyRequest, reply: FastifyReply) => {
        const { planId } = req.params as { planId: string };
        try {
            const { transitionStatus, getPlan } = await import('../ai-organize-plan');
            const plan = transitionStatus(db, planId, 'assigning');

            // restart assignment job
            if (plan.status === 'assigning' && plan.job_id) {
                const config = getAIConfig(getSetting);
                if (config) {
                    const { assignBookmarks } = await import('../ai-organize');
                    const { jobQueue, updateJob } = await import('../jobs');
                    jobQueue.enqueue(plan.job_id, async () => {
                        try {
                            await assignBookmarks(db, planId, config);
                        } catch (e: any) {
                            updateJob(db, plan.job_id!, { status: 'failed', message: e.message });
                        }
                    });
                }
            }

            return reply.send({ success: true, status: plan.status });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    done();
};
