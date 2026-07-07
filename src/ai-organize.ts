import type { Db } from './db';
import type { Assignment, CategoryNode, PlanRow } from './ai-organize-plan';
import { updatePlan, transitionStatus, getPlan, buildPlanSourceSnapshot, getPlanScopeBookmarkIds } from './ai-organize-plan';
import { updateJob, jobQueue, publishJobEvent } from './jobs';
import { getCategoryPathMap, getCategoryTree } from './category-service';
import { createOpenAIClient, extractAICompletionText, type AIClientFactory } from './ai-client';
import { selectSingleClassifyCategory } from './ai-classify-guardrail';
import { withAiReasoningEffort, type AIReasoningEffort } from './ai-reasoning-effort';

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: AIReasoningEffort | '';
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

function parseBookmarkUrl(rawUrl: string): { hostname: string; pathname: string; segments: string[] } {
  try {
    const parsed = new URL(rawUrl);
    const pathname = decodeURIComponent(parsed.pathname || '').toLowerCase();
    return {
      hostname: parsed.hostname.toLowerCase(),
      pathname,
      segments: pathname.split('/').map(part => part.trim()).filter(Boolean),
    };
  } catch {
    return { hostname: '', pathname: '', segments: [] };
  }
}

function domainMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const target = domain.toLowerCase();
  return host === target || host.endsWith(`.${target}`);
}

function domainMatchesAny(hostname: string, domains: string[]): boolean {
  return domains.some(domain => domainMatches(hostname, domain));
}

function resolveAvailableCategory(path: string, validPaths: Set<string>): string | null {
  const normalized = normalizePath(path);
  if (!normalized) return null;
  return validateAssignment(normalized, validPaths) ? normalized : null;
}

function resolveDeterministicCategory(bookmark: BookmarkBatch, validPaths: Set<string>): string | null {
  const { hostname, pathname, segments } = parseBookmarkUrl(bookmark.url);
  if (!hostname) return null;

  const target = (path: string) => resolveAvailableCategory(path, validPaths);

  // NSFW first: avoid leaking adult domains into ordinary video/community/download buckets.
  if (domainMatchesAny(hostname, ['nhentai.net', 'e-hentai.org', 'exhentai.org', 'hitomi.la', 'wnacg.com', 'asmhentai.com'])) {
    return target('NSFW/成人漫画');
  }
  if (domainMatchesAny(hostname, ['pornhub.com', 'xvideos.com', 'xnxx.com', 'javdb.com', 'javlibrary.com', 'missav.com', 'supjav.com'])) {
    return target('NSFW/成人视频');
  }

  // Resource/download platforms.
  if (domainMatches(hostname, 'pan.baidu.com') || domainMatches(hostname, 'yun.baidu.com')) {
    return target('资源下载/百度网盘');
  }
  if (domainMatchesAny(hostname, ['aliyundrive.com', 'alipan.com', 'aliyunpan.com'])) {
    return target('资源下载/阿里云盘');
  }
  if (domainMatchesAny(hostname, [
    'lanzou.com', 'lanzoui.com', 'lanzoux.com', 'lanzouw.com', '123pan.com',
    'pan.quark.cn', 'drive.google.com', 'onedrive.live.com', '1drv.ms',
    'dropbox.com', 'mega.nz', 'mediafire.com',
  ])) {
    return target('资源下载/其他网盘');
  }

  // Platform content pages: classify by platform, not by the page topic.
  if (domainMatchesAny(hostname, ['bilibili.com', 'b23.tv'])) {
    return target('影音游戏/B站视频');
  }
  if (domainMatchesAny(hostname, ['youtube.com', 'youtu.be'])) {
    return target('影音游戏/YouTube视频');
  }
  if (domainMatchesAny(hostname, ['douyin.com', 'tiktok.com', 'vimeo.com', 'dailymotion.com', 'xiaohongshu.com'])
    || hostname === 'v.qq.com') {
    return target('影音游戏/其他视频');
  }

  if (domainMatches(hostname, 'linux.do')) return target('社区社交/Linux.do');
  if (domainMatches(hostname, 'v2ex.com')) return target('社区社交/V2EX');
  if (domainMatches(hostname, 'zhihu.com')) return target('社区社交/知乎');
  if (domainMatchesAny(hostname, ['x.com', 'twitter.com'])) return target('社区社交/X推文');
  if (domainMatches(hostname, 'tieba.baidu.com')
    || domainMatchesAny(hostname, ['reddit.com', 'nodeseek.com', 'hostloc.com', 'stackoverflow.com', 'stackexchange.com', 'quora.com', 'lowendtalk.com', 'chiphell.com', '52pojie.cn'])) {
    return target('社区社交/论坛社区');
  }
  if (domainMatchesAny(hostname, ['t.me', 'telegram.org', 'discord.com', 'discord.gg', 'facebook.com', 'instagram.com', 'threads.net', 'mastodon.social'])) {
    return target('社区社交/社交平台');
  }

  // Code hosting/repositories are a platform-like bucket in the new taxonomy.
  if (domainMatchesAny(hostname, ['github.com', 'gitlab.com', 'gitee.com', 'bitbucket.org'])) {
    if (segments.length >= 2 || !pathname || pathname === '/') return target('开发与AI/代码仓库');
  }

  // Navigation/search/service entry points.
  if (domainMatchesAny(hostname, ['google.com', 'bing.com', 'duckduckgo.com', 'yandex.com', 'sogou.com', 'startpage.com'])
    || hostname === 'baidu.com' || hostname === 'www.baidu.com'
    || domainMatchesAny(hostname, ['deepl.com', 'translate.google.com', 'amap.com', 'maps.google.com', 'map.baidu.com'])) {
    return target('实用工具/搜索导航');
  }

  if (domainMatchesAny(hostname, [
    'dash.cloudflare.com', 'console.cloud.google.com', 'console.aws.amazon.com',
    'portal.azure.com', 'vercel.com', 'netlify.com',
  ]) || /\/(dashboard|console|admin|account|billing)(\/|$)/.test(pathname)) {
    return target('实用工具/账号后台');
  }

  return null;
}

function hasCategoryPath(categoryList: string[], path: string): boolean {
  const key = casefold(normalizePath(path));
  return categoryList.some(category => casefold(normalizePath(category)) === key);
}

function getAvailableChildNames(categoryList: string[], topName: string): string[] {
  const topKey = casefold(topName);
  const seen = new Set<string>();
  const children: string[] = [];
  for (const category of categoryList) {
    const [top, child] = normalizePath(category).split('/');
    if (!child || casefold(top) !== topKey) continue;
    const childKey = casefold(child);
    if (seen.has(childKey)) continue;
    seen.add(childKey);
    children.push(child);
  }
  return children;
}

function describeAvailableChildren(categoryList: string[], topName: string, fallback = '该类相关内容'): string {
  const children = getAvailableChildNames(categoryList, topName);
  return children.length ? children.join('、') : fallback;
}

function buildOrganizeCategoryGuide(categoryList: string[]): string {
  const guide: string[] = [
    '分类判定原则：',
    '1. 只能从候选分类中选择，禁止创建新一级或二级分类，输出必须与候选分类路径完全一致。',
    '2. 先判断站点类型：平台内容页按平台/入口分类；独立站点、工具、资料页再按内容主题分类。',
    '3. B站/YouTube/论坛/社交/网盘/GitHub 仓库等平台内具体内容页，不要按其内容主题细分，直接归入对应平台分类。',
    '4. 非平台型页面优先选择最具体的二级分类；只有候选中没有合适二级时才选择一级分类。',
    '5. 当前分类只是参考，不要因为旧分类而保留错误分类。',
    hasCategoryPath(categoryList, '待整理')
      ? '6. 如果只能猜测、信息不足、多个分类同样合理，选择“待整理”；不要为了填满而强行分类。'
      : '6. 如果只能猜测、信息不足、多个分类同样合理，返回空字符串；不要为了填满而强行分类。',
    '7. 你通常无法实际访问网页；不要声称已访问，只能根据标题、域名、URL 路径、描述和候选分类判断。',
  ];

  const boundaryRules: string[] = [];
  if (hasCategoryPath(categoryList, '开发与AI')) {
    boundaryRules.push(`开发与AI：${describeAvailableChildren(categoryList, '开发与AI')}。GitHub/GitLab/Gitee 仓库统一归“代码仓库”；AI 产品、模型 API、AI 搜索/写作/图片/视频工具归“AI平台工具”。`);
  }
  if (hasCategoryPath(categoryList, '实用工具')) {
    boundaryRules.push(`实用工具：${describeAvailableChildren(categoryList, '实用工具')}。只放在线可直接操作的工具、搜索导航、控制台/后台；软件下载页不要放这里。`);
  }
  if (hasCategoryPath(categoryList, '设计素材')) {
    boundaryRules.push(`设计素材：${describeAvailableChildren(categoryList, '设计素材')}。图片压缩/格式转换等操作型网页归“实用工具/图片工具”，不是设计素材。`);
  }
  if (hasCategoryPath(categoryList, '知识资料')) {
    boundaryRules.push(`知识资料：${describeAvailableChildren(categoryList, '知识资料')}。只放长期参考资料；开发专用文档优先归“开发与AI/技术资料”。`);
  }
  if (hasCategoryPath(categoryList, '影音游戏')) {
    boundaryRules.push(`影音游戏：${describeAvailableChildren(categoryList, '影音游戏')}。B站/YouTube/其他视频平台具体内容页按平台归类，不按视频主题归类；成人内容优先归 NSFW。`);
  }
  if (hasCategoryPath(categoryList, '社区社交')) {
    boundaryRules.push(`社区社交：${describeAvailableChildren(categoryList, '社区社交')}。论坛帖子、知乎内容、X 推文按平台归类，不按帖子主题归类。`);
  }
  if (hasCategoryPath(categoryList, '资源下载')) {
    boundaryRules.push(`资源下载：${describeAvailableChildren(categoryList, '资源下载')}。网盘分享按网盘平台归类；软件下载/系统镜像/其他下载资源归对应下载分类。`);
  }
  if (hasCategoryPath(categoryList, '资讯订阅')) {
    boundaryRules.push(`资讯订阅：${describeAvailableChildren(categoryList, '资讯订阅')}。媒体首页、Newsletter、热榜、资讯频道归这里；长期资料不要放资讯。`);
  }
  if (hasCategoryPath(categoryList, '生活消费')) {
    boundaryRules.push(`生活消费：${describeAvailableChildren(categoryList, '生活消费')}。`);
  }
  if (hasCategoryPath(categoryList, 'NSFW')) {
    boundaryRules.push(`NSFW：${describeAvailableChildren(categoryList, 'NSFW')}。明确成人内容必须归入 NSFW，不要归入普通影音、社区或资源下载。`);
  }
  if (hasCategoryPath(categoryList, '待整理')) {
    boundaryRules.push('待整理：低置信度、信息不足、候选分类都不合适、无法判断价值的链接统一放这里。');
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

  return `请为以下每个书签选择最合适的分类。程序只提供了标题、域名、URL路径、描述和当前分类等有限线索；不要声称已经访问网页。平台内容页优先按平台分类；信息不足时选择“待整理”或返回空字符串。\n${batchList}`;
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
    const deterministicById = new Map<number, string>();
    const aiBatch: BookmarkBatch[] = [];
    const aiBatchIndexById = new Map<number, number>();
    for (const bookmark of batch) {
      const deterministicCategory = resolveDeterministicCategory(bookmark, validPaths);
      if (deterministicCategory) {
        deterministicById.set(bookmark.id, deterministicCategory);
      } else {
        aiBatchIndexById.set(bookmark.id, aiBatch.length + 1);
        aiBatch.push(bookmark);
      }
    }
    let success = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;
      try {
        const assignMap = new Map<number, string>();
        if (aiBatch.length > 0) {
          const completion = await aiClient.createChatCompletion(withAiReasoningEffort({
            model: config.model,
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              { role: 'user', content: buildBookmarkBatchPrompt(aiBatch) },
            ],
            temperature: 0.1,
          }, config.reasoningEffort));

          const raw = extractAICompletionText(completion);
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('no JSON in response');

          const parsed = JSON.parse(jsonMatch[0]) as { assignments: { index: number; category: string }[] };
          for (const a of (parsed.assignments ?? [])) assignMap.set(a.index, a.category);
          if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;
        }

        for (let i = 0; i < batch.length; i++) {
          const deterministicCategory = deterministicById.get(batch[i].id);
          const aiIndex = aiBatchIndexById.get(batch[i].id);
          const cat = aiIndex ? assignMap.get(aiIndex) : undefined;
          const resolvedCategory = deterministicCategory ?? resolveBatchAssignmentCategory(cat, batch[i], categoryList, validPaths);
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
        const deterministicCategory = deterministicById.get(b.id);
        if (deterministicCategory) {
          allAssignments.push({ bookmark_id: b.id, category_path: deterministicCategory, status: 'assigned' });
        } else {
          allAssignments.push({ bookmark_id: b.id, category_path: '', status: 'needs_review' });
          needsReviewCount++;
        }
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
