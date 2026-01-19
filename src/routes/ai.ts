/**
 * AI Classification Routes
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import OpenAI from 'openai';

export interface AIRoutesOptions {
    db: Database;
    getSetting: (key: string) => string | null;
}

export const aiRoutes: FastifyPluginCallback<AIRoutesOptions> = (app, opts, done) => {
    const { db, getSetting } = opts;

    // POST /api/ai/classify - 单个书签分类
    app.post('/api/ai/classify', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const url = typeof body.url === 'string' ? body.url.trim() : '';
        const baseUrl = (getSetting('ai_base_url') ?? '').trim();
        const apiKey = (getSetting('ai_api_key') ?? '').trim();
        const model = (getSetting('ai_model') ?? '').trim();

        if (!baseUrl || !apiKey || !model) {
            return reply.code(400).send({ error: '请先在设置页配置 AI（Base URL、API Key、Model）' });
        }

        if (!title && !url) {
            return reply.code(400).send({ error: '请提供标题或URL' });
        }

        const existingCategories = db.prepare('SELECT name FROM categories').all() as { name: string }[];
        const topLevelCategories = new Set<string>();
        existingCategories.forEach(c => {
            const first = c.name.split('/')[0];
            if (first) topLevelCategories.add(first);
        });
        const topCategoriesHint = topLevelCategories.size > 0
            ? `\n已有一级分类：${Array.from(topLevelCategories).slice(0, 15).join('、')}`
            : '';

        const prompt =
            '你是书签分类助手。通过联网访问网页了解内容后分类。\n' +
            '规则：1.分类最多2级(如:技术/编程)，禁止3级！2.优先使用已有一级分类\n' +
            '标准一级分类：技术开发、学习资源、工具软件、购物电商、娱乐影音、社交媒体、新闻资讯、设计素材、生活服务、游戏、成人内容、其他' +
            topCategoriesHint + '\n' +
            '只输出分类路径，不要解释。\n' +
            (title ? '标题: ' + title + '\n' : '') +
            (url ? '网址: ' + url + '\n' : '');

        try {
            const openai = new OpenAI({
                apiKey: apiKey,
                baseURL: baseUrl.replace(/\/+$/, ''),
                timeout: 60000,
            });

            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: '只输出分类路径（最多2级），不要解释。' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.2,
            });

            let content = completion.choices?.[0]?.message?.content?.trim() || '';
            if (!content) {
                return reply.code(502).send({ error: 'AI 未返回分类结果' });
            }

            const parts = content.split('/').filter((p: string) => p.trim());
            if (parts.length > 2) {
                content = parts.slice(0, 2).join('/');
            }

            return reply.send({ category: content });
        } catch (e: any) {
            req.log.error({ err: e }, 'ai classify failed');
            const errorMsg = e.message || 'AI 请求失败';
            return reply.code(500).send({ error: errorMsg });
        }
    });

    // POST /api/ai/test - 测试 AI 配置
    app.post('/api/ai/test', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const baseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : '';
        const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
        const model = typeof body.model === 'string' ? body.model.trim() : '';

        if (!baseUrl || !apiKey || !model) {
            return reply.code(400).send({ error: '请填写完整的 AI 配置' });
        }

        try {
            const openai = new OpenAI({
                apiKey: apiKey,
                baseURL: baseUrl.replace(/\/+$/, ''),
                timeout: 30000,
            });

            await openai.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: '你好，请回复"OK"' }],
                max_tokens: 10,
            });

            return reply.send({ success: true, message: 'AI 配置测试成功' });
        } catch (e: any) {
            req.log.error({ err: e }, 'ai test failed');
            return reply.code(500).send({ error: e.message || 'AI 测试失败' });
        }
    });

    // POST /api/ai/classify-batch - 批量分类
    app.post('/api/ai/classify-batch', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};

        // 调试日志
        req.log.info({ body, bodyType: typeof body }, 'AI classify-batch request body');

        const scope = body.scope || 'uncategorized';
        const categoryId = body.category_id || body.categoryId;
        const autoApply = body.autoApply === 'true' || body.autoApply === true || body.auto_apply === 'true' || body.auto_apply === true;
        const batchSize = parseInt(body.batchSize || body.batch_size) || 30;

        // 解析 level 参数：1 = 一级分类，2 = 二级分类
        const level = body.level === 1 || body.level === '1' ? 1 :
            body.level === 2 || body.level === '2' ? 2 : undefined;

        // 解析 bookmarkIds：支持数组或逗号分隔的字符串
        let bookmarkIds: number[] | undefined;
        const rawBookmarkIds = body.bookmarkIds || body.bookmark_ids;
        if (Array.isArray(rawBookmarkIds)) {
            bookmarkIds = rawBookmarkIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
        } else if (typeof rawBookmarkIds === 'string' && rawBookmarkIds.trim()) {
            bookmarkIds = rawBookmarkIds.split(',').map((id: string) => parseInt(id.trim())).filter((id: number) => !isNaN(id));
        }

        req.log.info({ scope, categoryId, autoApply, bookmarkIds, batchSize, level }, 'AI classify-batch parsed params');

        const baseUrl = (getSetting('ai_base_url') ?? '').trim();
        const apiKey = (getSetting('ai_api_key') ?? '').trim();
        const model = (getSetting('ai_model') ?? '').trim();

        if (!baseUrl || !apiKey || !model) {
            return reply.code(400).send({ error: '请先在设置页配置 AI（Base URL、API Key、Model）' });
        }

        // 动态导入以避免循环依赖
        const { createJob, jobQueue, updateJob } = await import('../jobs');
        const { runAIClassifyJob } = await import('../ai-classify-job');

        const levelDesc = level === 1 ? '一级分类' : level === 2 ? '二级分类' : '分类';
        const job = createJob(db, 'ai_classify', `${levelDesc} 范围: ${scope}`, 0);
        const jobId = job.id;

        jobQueue.enqueue(jobId, async () => {
            try {
                await runAIClassifyJob(db, jobId, {
                    scope,
                    categoryId,
                    autoApply,
                    bookmarkIds: bookmarkIds && bookmarkIds.length > 0 ? bookmarkIds : undefined,
                    batchSize,
                    level,
                }, { baseUrl, apiKey, model });
            } catch (e: any) {
                updateJob(db, jobId, { status: 'failed', message: e.message || 'AI分类失败' });
            }
        });

        return reply.send({ success: true, jobId: jobId });
    });

    // POST /api/ai/simplify-categories - 精简分类
    app.post('/api/ai/simplify-categories', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const autoApply = body.auto_apply === true || body.auto_apply === 'true';

        // 解析 level 参数：1 = 一级分类精简，2 = 二级分类精简
        const level = body.level === 1 || body.level === '1' ? 1 :
            body.level === 2 || body.level === '2' ? 2 : undefined;

        // 解析 parentIds（二级精简时指定哪些一级分类）
        let parentIds: number[] | undefined;
        const rawParentIds = body.parentIds || body.parent_ids;
        if (Array.isArray(rawParentIds)) {
            parentIds = rawParentIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
        } else if (typeof rawParentIds === 'string' && rawParentIds.trim()) {
            parentIds = rawParentIds.split(',').map((id: string) => parseInt(id.trim())).filter((id: number) => !isNaN(id));
        }

        const baseUrl = (getSetting('ai_base_url') ?? '').trim();
        const apiKey = (getSetting('ai_api_key') ?? '').trim();
        const model = (getSetting('ai_model') ?? '').trim();

        if (!baseUrl || !apiKey || !model) {
            return reply.code(400).send({ error: '请先在设置页配置 AI（Base URL、API Key、Model）' });
        }

        // 动态导入以避免循环依赖
        const { createJob, jobQueue, updateJob } = await import('../jobs');

        // 根据是否指定 level 使用不同的处理逻辑
        if (level === 1 || level === 2) {
            const { runLevelSimplifyJob } = await import('../ai-simplify-level');
            const levelDesc = level === 1 ? '一级分类精简' : '二级分类精简';
            const job = createJob(db, 'ai_simplify', levelDesc, 0);
            const jobId = job.id;

            jobQueue.enqueue(jobId, async () => {
                try {
                    await runLevelSimplifyJob(db, jobId, { level, parentIds, autoApply }, { baseUrl, apiKey, model });
                } catch (e: any) {
                    updateJob(db, jobId, { status: 'failed', message: e.message || 'AI精简失败' });
                }
            });

            return reply.send({ success: true, jobId: jobId });
        }

        // 原有逻辑：不指定 level 时使用旧的精简
        const { runAISimplifyJob } = await import('../ai-simplify-job');
        const job = createJob(db, 'ai_simplify', '精简分类结构', 0);
        const jobId = job.id;

        jobQueue.enqueue(jobId, async () => {
            try {
                await runAISimplifyJob(db, jobId, { autoApply }, { baseUrl, apiKey, model });
            } catch (e: any) {
                updateJob(db, jobId, { status: 'failed', message: e.message || 'AI精简失败' });
            }
        });

        return reply.send({ success: true, jobId: jobId });
    });

    // GET /api/ai/suggestions - 获取分类建议列表
    app.get('/api/ai/suggestions', async (req: FastifyRequest, reply: FastifyReply) => {
        const query: any = req.query || {};
        const jobId = query.job_id;
        const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
        const offset = Math.max(0, parseInt(query.offset) || 0);

        if (!jobId) {
            return reply.code(400).send({ error: '缺少 job_id 参数' });
        }

        try {
            // 获取总数
            const countRow = db.prepare(`
                SELECT COUNT(*) as cnt FROM ai_classification_suggestions WHERE job_id = ?
            `).get(jobId) as { cnt: number };
            const total = countRow?.cnt || 0;

            // 获取分页数据
            const suggestions = db.prepare(`
                SELECT s.id, s.bookmark_id, s.suggested_category, s.confidence, s.created_at,
                       b.title, b.url, COALESCE(s.applied, 0) as applied
                FROM ai_classification_suggestions s
                LEFT JOIN bookmarks b ON s.bookmark_id = b.id
                WHERE s.job_id = ?
                ORDER BY s.applied ASC, s.created_at DESC
                LIMIT ? OFFSET ?
            `).all(jobId, limit, offset);

            return reply.send({ success: true, suggestions, total });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || '获取建议失败' });
        }
    });

    // POST /api/ai/apply-suggestion - 应用单个分类建议
    app.post('/api/ai/apply-suggestion', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const bookmarkId = body.bookmark_id;
        const category = body.category;
        const jobId = body.job_id;

        if (!bookmarkId || !category) {
            return reply.code(400).send({ error: '缺少必要参数' });
        }

        try {
            // 获取或创建分类
            const { getOrCreateCategoryByPath } = await import('../category-service');
            const categoryId = getOrCreateCategoryByPath(db, category);

            if (!categoryId) {
                return reply.code(400).send({ error: '无法创建分类' });
            }

            // 更新书签分类
            db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?').run(categoryId, bookmarkId);

            // 标记建议为已应用
            if (jobId) {
                db.prepare('UPDATE ai_classification_suggestions SET applied = 1 WHERE bookmark_id = ? AND job_id = ?').run(bookmarkId, jobId);
            } else {
                db.prepare('UPDATE ai_classification_suggestions SET applied = 1 WHERE bookmark_id = ?').run(bookmarkId);
            }

            return reply.send({ success: true });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || '应用失败' });
        }
    });

    // POST /api/ai/apply-all-suggestions - 应用所有分类建议
    app.post('/api/ai/apply-all-suggestions', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const jobId = body.job_id;

        if (!jobId) {
            return reply.code(400).send({ error: '缺少 job_id 参数' });
        }

        try {
            const { getOrCreateCategoryByPath } = await import('../category-service');

            // 获取该任务的所有未应用建议
            const suggestions = db.prepare(`
                SELECT bookmark_id, suggested_category
                FROM ai_classification_suggestions
                WHERE job_id = ? AND (applied IS NULL OR applied = 0)
            `).all(jobId) as Array<{ bookmark_id: number; suggested_category: string }>;

            let applied = 0;
            for (const suggestion of suggestions) {
                try {
                    const categoryId = getOrCreateCategoryByPath(db, suggestion.suggested_category);
                    if (categoryId) {
                        db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?').run(categoryId, suggestion.bookmark_id);
                        db.prepare('UPDATE ai_classification_suggestions SET applied = 1 WHERE bookmark_id = ? AND job_id = ?').run(suggestion.bookmark_id, jobId);
                        applied++;
                    }
                } catch {
                    continue;
                }
            }

            return reply.send({ success: true, applied });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || '应用失败' });
        }
    });

    // POST /api/ai/cancel - 取消 AI 任务
    app.post('/api/ai/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const jobId = body.jobId || body.job_id;

        if (!jobId) {
            return reply.code(400).send({ error: '缺少 job_id 参数' });
        }

        try {
            const { jobQueue, updateJob, getJob } = await import('../jobs');

            const job = getJob(db, jobId);
            if (!job) {
                return reply.code(404).send({ error: '任务不存在' });
            }

            // 取消任务
            jobQueue.cancelJob(jobId);
            updateJob(db, jobId, { status: 'canceled', message: '任务已取消' });

            return reply.send({ success: true });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || '取消失败' });
        }
    });

    // POST /api/ai/apply-simplify - 应用单个精简建议（将一个旧分类合并到新分类）
    app.post('/api/ai/apply-simplify', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const oldCategoryId = body.old_category_id;
        const jobId = body.job_id;

        if (!oldCategoryId) {
            return reply.code(400).send({ error: '缺少 old_category_id 参数' });
        }

        try {
            // 从精简建议中查找对应的新分类
            const suggestion = db.prepare(`
                SELECT new_category_name FROM ai_simplify_suggestions 
                WHERE job_id = ? AND old_category_id = ?
            `).get(jobId, oldCategoryId) as { new_category_name: string } | undefined;

            if (!suggestion) {
                return reply.code(404).send({ error: '未找到对应的精简建议' });
            }

            const { getOrCreateCategoryByPath } = await import('../category-service');
            const newCategoryId = getOrCreateCategoryByPath(db, suggestion.new_category_name);

            if (!newCategoryId) {
                return reply.code(500).send({ error: '无法创建新分类' });
            }

            // 将旧分类下的所有书签移动到新分类
            db.prepare('UPDATE bookmarks SET category_id = ? WHERE category_id = ?').run(newCategoryId, oldCategoryId);

            // 标记该建议为已应用
            db.prepare(`
                UPDATE ai_simplify_suggestions SET applied = 1 
                WHERE job_id = ? AND old_category_id = ?
            `).run(jobId, oldCategoryId);

            return reply.send({ success: true });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || '应用失败' });
        }
    });

    // POST /api/ai/apply-all-simplify - 应用所有精简建议
    app.post('/api/ai/apply-all-simplify', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const jobId = body.jobId || body.job_id;

        if (!jobId) {
            return reply.code(400).send({ error: '缺少 job_id 参数' });
        }

        try {
            const { getOrCreateCategoryByPath } = await import('../category-service');

            // 获取该任务所有未应用的精简建议
            const suggestions = db.prepare(`
                SELECT old_category_id, new_category_name FROM ai_simplify_suggestions 
                WHERE job_id = ? AND (applied IS NULL OR applied = 0)
            `).all(jobId) as Array<{ old_category_id: number; new_category_name: string }>;

            let applied = 0;
            for (const suggestion of suggestions) {
                try {
                    const newCategoryId = getOrCreateCategoryByPath(db, suggestion.new_category_name);
                    if (newCategoryId) {
                        // 将旧分类下的所有书签移动到新分类
                        db.prepare('UPDATE bookmarks SET category_id = ? WHERE category_id = ?').run(newCategoryId, suggestion.old_category_id);
                        // 标记为已应用
                        db.prepare(`
                            UPDATE ai_simplify_suggestions SET applied = 1 
                            WHERE job_id = ? AND old_category_id = ?
                        `).run(jobId, suggestion.old_category_id);
                        applied++;
                    }
                } catch {
                    continue;
                }
            }

            return reply.send({ success: true, applied });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || '应用失败' });
        }
    });

    done();
};
