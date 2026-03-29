import { once } from 'events';

import { getCategoryByPath } from '../src/category-service';
import { seedAISettings, createQueuedAIHarness, jsonCompletion, textCompletion } from '../tests/helpers/ai';
import { createTestApp } from '../tests/helpers/app';
import { seedBookmarks, seedCategoryTree, seedJob, seedSnapshot } from '../tests/helpers/factories';
import { applyTemplate, createTemplate, type CategoryNode } from '../src/template-service';

const PRIMARY_TEMPLATE_TREE: CategoryNode[] = [
    {
        name: '技术开发',
        children: [{ name: '前端' }, { name: '后端' }],
    },
    {
        name: '学习资源',
        children: [{ name: '文档' }, { name: '课程' }],
    },
    {
        name: '工具软件',
        children: [{ name: '效率' }, { name: 'AI' }],
    },
];

const ALTERNATE_TEMPLATE_TREE: CategoryNode[] = [
    {
        name: '工作台',
        children: [{ name: '任务' }, { name: '归档' }],
    },
    {
        name: '知识库',
        children: [{ name: '文档' }, { name: '参考' }],
    },
];

function buildAssignments(count: number) {
    return Array.from({ length: count }, (_, index) => {
        if (index === 0) return { index: index + 1, category: '技术开发/前端' };
        if (index === 1) return { index: index + 1, category: '学习资源/文档' };
        return { index: index + 1, category: '工具软件/AI' };
    });
}

async function main() {
    const harness = createQueuedAIHarness([
        textCompletion('OK'),
        jsonCompletion({ assignments: buildAssignments(3) }),
    ]);

    const ctx = await createTestApp({
        aiClientFactory: harness.aiClientFactory,
        tempPrefix: 'bookmarks-mcp-smoke-',
    });

    let shuttingDown = false;

    async function shutdown(code = 0) {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
            await ctx.cleanup();
        } finally {
            process.exit(code);
        }
    }

    process.on('SIGINT', () => { void shutdown(0); });
    process.on('SIGTERM', () => { void shutdown(0); });

    try {
        const address = await ctx.app.listen({ host: '127.0.0.1', port: 0 });

        seedAISettings(ctx.db, {
            baseUrl: 'https://mock-ai.example.test/v1',
            apiKey: 'mock-ai-key',
            model: 'mock-model',
            batchSize: 20,
        });

        const primaryTemplate = createTemplate(ctx.db, 'MCP Smoke 模板', PRIMARY_TEMPLATE_TREE);
        createTemplate(ctx.db, 'MCP 备用模板', ALTERNATE_TEMPLATE_TREE);
        applyTemplate(ctx.db, primaryTemplate.id);

        seedCategoryTree(ctx.db, [
            { name: '临时分类', children: [{ name: '收件箱' }] },
        ]);

        const frontendCategory = getCategoryByPath(ctx.db, '技术开发/前端');
        const docsCategory = getCategoryByPath(ctx.db, '学习资源/文档');
        const aiCategory = getCategoryByPath(ctx.db, '工具软件/AI');
        if (!frontendCategory || !docsCategory || !aiCategory) {
            throw new Error('failed to prepare template-backed categories');
        }

        const bookmarkIds = seedBookmarks(ctx.db, [
            { title: '本地登录页', url: `${address}/login`, categoryId: frontendCategory.id },
            { title: '本地任务页', url: `${address}/jobs`, categoryId: docsCategory.id },
            { title: '本地设置页', url: `${address}/settings`, categoryId: null },
        ]);

        seedSnapshot(ctx.db, {
            snapshotsDir: ctx.paths.snapshotsDir,
            bookmark_id: bookmarkIds[0],
            url: `${address}/login`,
            title: '登录页快照',
            content: '<!doctype html><html><body><h1>Login Snapshot</h1></body></html>',
        });

        seedJob(ctx.db, {
            type: 'import',
            status: 'done',
            total: 1,
            processed: 1,
            inserted: 1,
            message: '历史导入已完成',
        });

        console.log(JSON.stringify({
            baseUrl: address,
            username: ctx.auth.username,
            password: ctx.auth.password,
            apiToken: ctx.auth.apiToken,
            tempRoot: ctx.paths.rootDir,
            smokeData: {
                bookmarks: [
                    '本地登录页',
                    '本地任务页',
                    '本地设置页',
                ],
                activeTemplate: 'MCP Smoke 模板',
                alternateTemplate: 'MCP 备用模板',
                snapshotTitle: '登录页快照',
            },
        }, null, 2));

        await once(process, 'beforeExit');
    } catch (error) {
        console.error(error instanceof Error ? error.stack ?? error.message : String(error));
        await shutdown(1);
    }
}

void main();
