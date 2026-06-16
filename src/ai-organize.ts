import type { Db } from './db';
import type { Assignment, CategoryNode, PlanRow } from './ai-organize-plan';
import { updatePlan, transitionStatus, getPlan, buildPlanSourceSnapshot, getPlanScopeBookmarkIds } from './ai-organize-plan';
import { updateJob, jobQueue, publishJobEvent } from './jobs';
import { getCategoryPathMap, getCategoryTree } from './category-service';
import { createOpenAIClient, extractAICompletionText, type AIClientFactory } from './ai-client';
import { selectSingleClassifyCategory } from './ai-classify-guardrail';

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface RetryConfig {
  timeout?: number;       // per-call timeout ms, default 300000
  maxRetries?: number;    // per-batch retries, default 2
  failThreshold?: number; // consecutive failures → failed, default 5
}

export const VALID_BATCH_SIZES = [10, 20, 30] as const;
export type BatchSize = typeof VALID_BATCH_SIZES[number];

// ==================== Batch Assignment ====================

const casefold = (value: string) => value.toLowerCase().trim();

function normalizePath(path: string): string {
  return path.split('/').map(segment => segment.trim()).filter(Boolean).slice(0, 2).join('/');
}

function parseTargetTree(rawTree: string | null): CategoryNode[] {
  if (!rawTree) return [];
  try {
    const value = JSON.parse(rawTree) as CategoryNode[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error.trim() ? error : 'assignment failed';
}

export function failPlanExecution(db: Db, planId: string, error: unknown, reason = 'assignment_failed'): void {
  const plan = getPlan(db, planId);
  if (!plan || plan.status !== 'assigning') return;

  const nextPlan = transitionStatus(db, planId, 'error', reason);
  if (nextPlan.job_id) {
    updateJob(db, nextPlan.job_id, { status: 'failed', message: getErrorMessage(error) });
  }
}

function buildLiveCategoryTreeSnapshot(db: Db): CategoryNode[] {
  return getCategoryTree(db).map(node => ({
    name: node.name,
    children: (node.children ?? []).map(child => ({ name: child.displayName || child.name })),
  }));
}

function resolvePlanTargetTree(db: Db, plan: Pick<PlanRow, 'target_tree'>): CategoryNode[] {
  const snapshottedTree = parseTargetTree(plan.target_tree);
  if (snapshottedTree.length > 0) return snapshottedTree;
  return buildLiveCategoryTreeSnapshot(db);
}

function flattenTargetTreePaths(tree: CategoryNode[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const node of tree) {
    const top = normalizePath(node.name);
    if (top) {
      const key = casefold(top);
      if (!seen.has(key)) {
        seen.add(key);
        paths.push(top);
      }
    }

    for (const child of node.children ?? []) {
      const childPath = normalizePath(`${node.name}/${child.name}`);
      if (!childPath) continue;
      const key = casefold(childPath);
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push(childPath);
    }
  }

  return paths;
}

export function validateAssignment(categoryPath: string, validPaths: Set<string>): boolean {
  return validPaths.has(casefold(normalizePath(categoryPath)));
}

interface BookmarkBatch { id: number; url: string; title: string; current_category: string | null; description: string | null }

function buildValidPathsFromTree(tree: CategoryNode[]): Set<string> {
  return new Set(flattenTargetTreePaths(tree).map(path => casefold(path)));
}

function buildCategoryListFromTree(tree: CategoryNode[]): string[] {
  return flattenTargetTreePaths(tree);
}

function isPlanExecutionCanceled(db: Db, planId: string, jobId: string | null): boolean {
  if (jobId && jobQueue.isCanceled(jobId)) return true;
  const currentPlan = getPlan(db, planId);
  return !currentPlan || currentPlan.status === 'canceled';
}

function truncatePromptText(value: string | null | undefined, maxLength: number): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 1).trimEnd() + '…';
}

function parseUrlSignals(rawUrl: string): { hostname: string; path: string } {
  try {
    const parsed = new URL(rawUrl);
    const path = decodeURIComponent(`${parsed.pathname}${parsed.search}`)
      .replace(/[/?#=&._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      hostname: parsed.hostname.toLowerCase(),
      path: truncatePromptText(path, 140),
    };
  } catch {
    return { hostname: '', path: '' };
  }
}

function hasCategoryPath(categoryList: string[], path: string): boolean {
  const key = casefold(normalizePath(path));
  return categoryList.some(category => casefold(normalizePath(category)) === key);
}

function buildOrganizeCategoryGuide(categoryList: string[]): string {
  const guide: string[] = [
    '分类判定原则：',
    '1. 优先按网页“核心内容/主要用途”分类，不按保存时间、个人偏好或是否常用分类。',
    '2. 优先选择最具体的二级分类；只有没有合适子分类时才选择一级分类。',
    '3. 当前分类只是参考：当前分类已具体且明显匹配时可保留；当前为“待处理/常用入口”等流程桶时，不要仅因当前分类而保留。',
    '4. 如果只能猜测、多个分类同样合理，返回空字符串交给人工审核；不要为了填满而强行选择。',
    '5. 模型无法实际联网时，基于标题、域名、URL路径、描述和当前分类综合判断。',
  ];

  const boundaryRules: string[] = [];
  if (hasCategoryPath(categoryList, '常用入口')) {
    boundaryRules.push('常用入口：只放真正的入口页/控制台首页/个人常用起始页/临时置顶；不要把所有高频网站或普通内容页都放到这里。');
  }
  if (hasCategoryPath(categoryList, '待处理')) {
    boundaryRules.push('待处理：只放“稍后阅读、待下载、待购买、待注册、待整理、可能删除”等需要后续动作的书签；已经能判断内容主题时优先放内容分类。');
  }
  if (hasCategoryPath(categoryList, '搜索导航')) {
    boundaryRules.push('搜索导航：搜索引擎、垂直搜索、网址导航、翻译词典、地图位置、问答入口；不要把普通资源站、社区或文章放入搜索导航。');
  }
  if (hasCategoryPath(categoryList, '账号后台')) {
    boundaryRules.push('账号后台：云服务控制台、域名/DNS、服务器面板、应用/商家后台、账单发票、个人资料等登录后管理入口。');
  }
  if (hasCategoryPath(categoryList, '在线工具')) {
    boundaryRules.push('在线工具：网页内直接完成文本/图片/PDF/转换/计算/文件处理的工具；软件下载页归下载资源，开发 API/文档归开发者或资料文档。');
  }
  if (hasCategoryPath(categoryList, '开发者')) {
    boundaryRules.push('开发者：代码托管、官方/API文档、包/镜像、前后端、数据库缓存、部署运维、监控日志、报错排查、代码片段和技术文章。GitHub 仓库通常是代码托管，docs/reference/API 页面优先放官方文档或API文档。');
  }
  if (hasCategoryPath(categoryList, 'AI工具')) {
    boundaryRules.push('AI工具：AI产品、模型平台、AI搜索/编程/写作/图片/视频/音频、提示词库、数据集评测；普通 AI 新闻/文章不要放这里，放资讯订阅或资料文档。');
  }
  if (hasCategoryPath(categoryList, '设计素材')) {
    boundaryRules.push('设计素材：设计工具、灵感、UI组件、图标字体、图库、插画、配色、模板样机；图片压缩/转换等操作型网页优先放在线工具/图片工具。');
  }
  if (hasCategoryPath(categoryList, '资料文档')) {
    boundaryRules.push('资料文档：教程指南、官方手册、参考资料、课程、论文报告、Wiki知识库、收藏文章；开发专用文档/API优先放开发者。');
  }
  if (hasCategoryPath(categoryList, '资讯订阅')) {
    boundaryRules.push('资讯订阅：新闻、科技/财经/行业动态、Newsletter、RSS、榜单热榜；论坛问答和个人博客优先放社区论坛。');
  }
  if (hasCategoryPath(categoryList, '社区论坛')) {
    boundaryRules.push('社区论坛：社交平台、论坛、问答社区、博客个人站、群组频道、活动Meetup 等用户生成内容或交流入口。');
  }
  if (hasCategoryPath(categoryList, '影音娱乐')) {
    boundaryRules.push('影音娱乐：视频、音乐、播客、直播、游戏站点、动漫漫画、影视资源；成人内容优先放 NSFW。');
  }
  if (hasCategoryPath(categoryList, '下载资源')) {
    boundaryRules.push('下载资源：软件下载、系统镜像、开源发布、网盘分享、素材/字体/壁纸下载、备用链接；在线使用的工具不要放这里。');
  }
  if (hasCategoryPath(categoryList, '购物消费')) {
    boundaryRules.push('购物消费：电商、比价优惠、品牌官网、数码硬件、快递物流、票务活动、愿望清单。');
  }
  if (hasCategoryPath(categoryList, '生活出行')) {
    boundaryRules.push('生活出行：本地生活、餐饮外卖、旅行酒店、交通、天气、医疗、家庭宠物。');
  }
  if (hasCategoryPath(categoryList, '金融支付')) {
    boundaryRules.push('金融支付：银行支付、投资行情、股票基金、加密资产、记账预算、税务保险、收款结算。');
  }
  if (hasCategoryPath(categoryList, '安全隐私')) {
    boundaryRules.push('安全隐私：密码、二步验证、隐私邮箱、代理网络、安全检测、备份恢复、反诈风控。');
  }
  if (hasCategoryPath(categoryList, 'NSFW')) {
    boundaryRules.push('NSFW：明确成人内容、成人社区、写真擦边、成人游戏/漫画、情趣购物、私密订阅等必须归入 NSFW；不要归入普通影音娱乐、社区或下载资源。');
  }

  if (boundaryRules.length) {
    guide.push('', '重点分类边界：', ...boundaryRules.map((line, index) => `${index + 1}. ${line}`));
  }

  return guide.join('\n');
}

function buildOrganizeSystemPrompt(categoryList: string[]): string {
  const categoriesText = categoryList.join('\n');
  return `你是书签分类助手。你的目标是提升分类准确率，而不是平均分配或强行移动。
只能从以下分类列表中选择最匹配的分类，不能创建新分类，输出必须与候选分类路径完全一致。
如果没有合适的分类，返回空字符串。

${buildOrganizeCategoryGuide(categoryList)}

可选分类:
${categoriesText}

严格返回 JSON: {"assignments":[{"index":1,"category":"分类路径"}]}`;
}

function buildBookmarkBatchPrompt(batch: BookmarkBatch[]): string {
  const batchList = batch.map((bookmark, index) => {
    const signals = parseUrlSignals(bookmark.url);
    const lines = [
      `${index + 1}. 标题: ${truncatePromptText(bookmark.title, 160) || '(无标题)'}`,
      `   URL: ${truncatePromptText(bookmark.url, 260)}`,
      `   域名: ${signals.hostname || '(未知)'}`,
      `   路径关键词: ${signals.path || '(无)'}`,
      `   当前分类: ${bookmark.current_category || '未分类'}`,
    ];
    const description = truncatePromptText(bookmark.description, 220);
    if (description) lines.push(`   描述: ${description}`);
    return lines.join('\n');
  }).join('\n');

  return `请为以下每个书签选择最合适的分类。请优先使用标题、域名、URL路径、描述和当前分类判断；如果可联网，可访问URL核实内容；如果不能联网，不要声称已访问，直接基于这些线索分类。\n${batchList}`;
}

function resolveBatchAssignmentCategory(rawCategory: unknown, bookmark: BookmarkBatch, categoryList: string[], validPaths: Set<string>): string | null {
  const raw = typeof rawCategory === 'string' ? rawCategory.trim() : '';
  if (!raw) return null;
  const resolved = selectSingleClassifyCategory({
    rawCategory: raw,
    allowedPaths: categoryList,
    title: bookmark.title,
    url: bookmark.url,
    description: bookmark.description,
  });
  if (resolved && validateAssignment(resolved, validPaths)) return resolved;
  if (validateAssignment(raw, validPaths)) return normalizePath(raw);
  return null;
}

export async function assignBookmarks(
  db: Db,
  planId: string,
  config: AIConfig,
  retryConfig: RetryConfig = {},
  batchSize: BatchSize = 20,
  aiClientFactory: AIClientFactory = createOpenAIClient,
): Promise<void> {
  const timeout = retryConfig.timeout ?? 300000;
  const maxRetries = retryConfig.maxRetries ?? 2;
  const failThreshold = retryConfig.failThreshold ?? 5;

  const plan = getPlan(db, planId);
  if (!plan) throw new Error('plan not found');

  const targetTree = resolvePlanTargetTree(db, plan);
  const serializedTargetTree = targetTree.length > 0 ? JSON.stringify(targetTree) : null;
  if (serializedTargetTree && serializedTargetTree !== plan.target_tree) {
    updatePlan(db, planId, { target_tree: serializedTargetTree });
  }
  const planSnapshot: PlanRow = serializedTargetTree && serializedTargetTree !== plan.target_tree
    ? { ...plan, target_tree: serializedTargetTree }
    : plan;
  const validPaths = buildValidPathsFromTree(targetTree);
  const categoryList = buildCategoryListFromTree(targetTree);

  const scopeBookmarkIds = getPlanScopeBookmarkIds(db, planSnapshot);
  const categoryPathMap = getCategoryPathMap(db);
  const bookmarks = scopeBookmarkIds.length > 0
    ? db.prepare(`
      SELECT b.id, b.url, b.title, b.category_id, b.description
      FROM bookmarks b
      WHERE b.id IN (${scopeBookmarkIds.map(() => '?').join(',')})
      ORDER BY b.id
    `).all(...scopeBookmarkIds).map((row: any) => {
      return {
        id: row.id,
        url: row.url,
        title: row.title,
        current_category: row.category_id != null ? (categoryPathMap.get(row.category_id) ?? null) : null,
        description: typeof row.description === 'string' ? row.description : null,
      };
    }) as BookmarkBatch[]
    : [];

  const fetchedBookmarkIds = new Set(bookmarks.map(bookmark => bookmark.id));
  if (fetchedBookmarkIds.size !== scopeBookmarkIds.length) {
    failPlanExecution(db, planId, 'plan is stale: scope bookmarks changed', 'scope_stale');
    return;
  }

  const batches: BookmarkBatch[][] = [];
  for (let i = 0; i < bookmarks.length; i += batchSize) batches.push(bookmarks.slice(i, i + batchSize));

  updatePlan(db, planId, { batches_total: batches.length, batches_done: 0 });

  if (plan.job_id) {
    updateJob(db, plan.job_id, { total: bookmarks.length });
  }

  const allAssignments: Assignment[] = [];
  let consecutiveFails = 0;
  let needsReviewCount = 0;
  const failedBatchIds: number[] = [];

  const systemPrompt = buildOrganizeSystemPrompt(categoryList);
  const aiClient = aiClientFactory({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout,
  });

  for (let bi = 0; bi < batches.length; bi++) {
    if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;

    const batch = batches[bi];
    let success = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;
      try {
        const completion = await aiClient.createChatCompletion({
          model: config.model,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            { role: 'user', content: buildBookmarkBatchPrompt(batch) },
          ],
          temperature: 0.1,
        });

        const raw = extractAICompletionText(completion);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('no JSON in response');

        const parsed = JSON.parse(jsonMatch[0]) as { assignments: { index: number; category: string }[] };
        const assignMap = new Map<number, string>();
        for (const a of (parsed.assignments ?? [])) assignMap.set(a.index, a.category);
        if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;

        for (let i = 0; i < batch.length; i++) {
          const cat = assignMap.get(i + 1);
          const resolvedCategory = resolveBatchAssignmentCategory(cat, batch[i], categoryList, validPaths);
          if (resolvedCategory) {
            allAssignments.push({ bookmark_id: batch[i].id, category_path: resolvedCategory, status: 'assigned' });
          } else {
            allAssignments.push({ bookmark_id: batch[i].id, category_path: '', status: 'needs_review' });
            needsReviewCount++;
          }
        }

        success = true;
        consecutiveFails = 0;
        break;
      } catch (e) {
        if (attempt === maxRetries) break;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    if (!success) {
      consecutiveFails++;
      failedBatchIds.push(bi);
      for (const b of batch) {
        allAssignments.push({ bookmark_id: b.id, category_path: '', status: 'needs_review' });
        needsReviewCount++;
      }

      if (consecutiveFails >= failThreshold) {
        if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;
        updatePlan(db, planId, {
          assignments: JSON.stringify(allAssignments),
          failed_batch_ids: JSON.stringify(failedBatchIds),
          needs_review_count: needsReviewCount,
          batches_done: bi + 1,
        });
        if (plan.job_id) {
          updateJob(db, plan.job_id, {
            total: bookmarks.length,
            processed: allAssignments.length,
            inserted: allAssignments.filter(a => a.status === 'assigned').length,
            skipped: needsReviewCount,
          });
        }
        transitionStatus(db, planId, 'failed');
        return;
      }
    }

    // Collect this batch's assignments for SSE push
    const batchAssignments = allAssignments.slice(allAssignments.length - batch.length);
    const bmMap = new Map(batch.map(b => [b.id, { title: b.title, url: b.url }]));
    const enriched = batchAssignments.map(a => ({
      ...a,
      title: bmMap.get(a.bookmark_id)?.title ?? '',
      url: bmMap.get(a.bookmark_id)?.url ?? '',
    }));

    if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;
    updatePlan(db, planId, { batches_done: bi + 1, needs_review_count: needsReviewCount, assignments: JSON.stringify(allAssignments) });
    if (plan.job_id) {
      updateJob(db, plan.job_id, {
        processed: allAssignments.length,
        inserted: allAssignments.length - needsReviewCount,
        skipped: needsReviewCount,
      });
      publishJobEvent(plan.job_id, 'batch_assignments', enriched);
    }
  }

  if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;
  updatePlan(db, planId, {
    target_tree: serializedTargetTree,
    assignments: JSON.stringify(allAssignments),
    failed_batch_ids: failedBatchIds.length ? JSON.stringify(failedBatchIds) : null,
    needs_review_count: needsReviewCount,
    source_snapshot: JSON.stringify(buildPlanSourceSnapshot(db, planSnapshot, allAssignments)),
  });

  if (plan.job_id) {
    const assignedCount = allAssignments.filter(a => a.status === 'assigned').length;
    updateJob(db, plan.job_id, {
      processed: allAssignments.length,
      inserted: assignedCount,
      skipped: needsReviewCount,
    });
  }

  if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;
  transitionStatus(db, planId, 'preview');
}
