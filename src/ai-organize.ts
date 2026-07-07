import type { Db } from './db';
import type { Assignment, CategoryNode, PlanRow } from './ai-organize-plan';
import { updatePlan, transitionStatus, getPlan, buildPlanSourceSnapshot, getPlanScopeBookmarkIds } from './ai-organize-plan';
import { updateJob, jobQueue, publishJobEvent } from './jobs';
import { getCategoryPathMap, getCategoryTree } from './category-service';
import { createOpenAIClient, extractAICompletionText, type AIChatCompletionRequest, type AIClientFactory } from './ai-client';
import { selectSingleClassifyCategory } from './ai-classify-guardrail';
import { buildCategoryDescriptionGuide } from './ai-category-taxonomy';
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
  const { hostname, pathname } = parseBookmarkUrl(bookmark.url);
  if (!hostname) return null;

  const target = (path: string) => resolveAvailableCategory(path, validPaths);

  // NSFW first: avoid leaking adult domains into ordinary video/community/download buckets.
  if (domainMatchesAny(hostname, ['nhentai.net', 'e-hentai.org', 'exhentai.org', 'hitomi.la', 'wnacg.com', 'asmhentai.com', 'kemono.su'])) {
    return target('绅士领域 [NSFW]/二次元本子');
  }
  if (domainMatchesAny(hostname, ['sukebei.nyaa.si', 'javdb.com', 'javlibrary.com', 'supjav.com'])) {
    return target('绅士领域 [NSFW]/视频与BT下载');
  }
  if (domainMatchesAny(hostname, ['pornhub.com', 'xvideos.com', 'xnxx.com', 'missav.com', 'thisav.com', 'hanime.tv'])) {
    return target('绅士领域 [NSFW]/视频流媒体');
  }

  // Network disks and cloud/share tooling.
  if (domainMatches(hostname, 'pan.baidu.com') || domainMatches(hostname, 'yun.baidu.com')) {
    return target('效率与日常工具/网络与网盘');
  }
  if (domainMatchesAny(hostname, ['aliyundrive.com', 'alipan.com', 'aliyunpan.com'])) {
    return target('效率与日常工具/网络与网盘');
  }
  if (domainMatchesAny(hostname, [
    'lanzou.com', 'lanzoui.com', 'lanzoux.com', 'lanzouw.com', '123pan.com',
    'pan.quark.cn', 'drive.google.com', 'onedrive.live.com', '1drv.ms',
    'dropbox.com', 'mega.nz', 'mediafire.com',
  ])) {
    return target('效率与日常工具/网络与网盘');
  }

  // Online video/audio/read platforms.
  if (domainMatchesAny(hostname, ['iqiyi.com', 'youku.com', 'mgtv.com', '1905.com', 'netflix.com', 'hulu.com', 'disneyplus.com'])
    || hostname === 'v.qq.com') {
    return target('在线影音/在线影视');
  }
  if (domainMatchesAny(hostname, ['bilibili.com', 'b23.tv', 'youtube.com', 'youtu.be', 'douyin.com', 'tiktok.com', 'vimeo.com', 'dailymotion.com', 'xiaohongshu.com', 'twitch.tv', 'huya.com', 'douyu.com'])) {
    return target('在线影音/短视频与直播');
  }
  if (domainMatchesAny(hostname, ['music.163.com', 'y.qq.com', 'spotify.com', 'soundcloud.com', 'podcasts.apple.com', 'ximalaya.com', 'qingting.fm'])) {
    return target('在线影音/音乐电台');
  }
  if (domainMatchesAny(hostname, ['qidian.com', 'jjwxc.net', 'fanqienovel.com', 'zongheng.com', '69shu.com', 'biquge.com'])) {
    return target('图文阅读/网络小说');
  }
  if (domainMatchesAny(hostname, ['manhuagui.com', 'mangabz.com', 'dmzj.com', 'webtoons.com', 'kuaikanmanhua.com'])) {
    return target('图文阅读/在线漫画');
  }
  if (domainMatchesAny(hostname, ['z-library.sk', 'z-lib.is', 'singlelogin.re', 'annas-archive.org', 'libgen.is', 'libgen.rs'])) {
    return target('图文阅读/电子书库');
  }

  // Community and information streams.
  if (domainMatchesAny(hostname, ['tophub.today', 'rebang.today', 'hot.imsyy.top', 'trends.google.com'])) {
    return target('社区与资讯/热榜聚合');
  }
  if (domainMatches(hostname, 'linux.do')) return target('社区与资讯/讨论社区');
  if (domainMatches(hostname, 'v2ex.com')) return target('社区与资讯/讨论社区');
  if (domainMatches(hostname, 'zhihu.com')) return target('社区与资讯/讨论社区');
  if (domainMatchesAny(hostname, ['x.com', 'twitter.com'])) return target('社区与资讯/讨论社区');
  if (domainMatches(hostname, 'tieba.baidu.com')
    || domainMatchesAny(hostname, ['reddit.com', 'nodeseek.com', 'hostloc.com', 'stackoverflow.com', 'stackexchange.com', 'quora.com', 'lowendtalk.com', 'chiphell.com', '52pojie.cn'])) {
    return target('社区与资讯/讨论社区');
  }
  if (domainMatchesAny(hostname, ['t.me', 'telegram.org', 'discord.com', 'discord.gg', 'facebook.com', 'instagram.com', 'threads.net', 'mastodon.social'])) {
    return target('社区与资讯/讨论社区');
  }

  // App/game/download domains.
  if (domainMatchesAny(hostname, ['store.steampowered.com', 'epicgames.com', 'gog.com', 'itch.io', '3dmgame.com', 'ali213.net'])) {
    return target('游戏专区/游戏下载');
  }
  if (domainMatchesAny(hostname, ['nexusmods.com', 'moddb.com', 'flingtrainer.com', 'wemod.com'])) {
    return target('游戏专区/游戏辅助工具');
  }
  if (domainMatchesAny(hostname, ['apkpure.com', 'apkcombo.com', 'apkmirror.com', 'coolapk.com'])) {
    return target('终端应用下载/软件 - Android');
  }
  if (domainMatchesAny(hostname, ['macwk.com', 'xclient.info', 'macbed.com'])) {
    return target('终端应用下载/软件 - macOS');
  }
  if (domainMatchesAny(hostname, ['msdn.itellyou.cn', 'next.itellyou.cn'])) {
    return target('终端应用下载/软件 - Windows');
  }
  if (domainMatchesAny(hostname, ['nyaa.si', 'rarbg.to', 'thepiratebay.org', '1337x.to', 'm-team.cc', 'hdsky.me'])) {
    return target('媒体与素材下载/影视下载');
  }
  if (domainMatchesAny(hostname, ['unsplash.com', 'pexels.com', 'pixabay.com', 'iconfont.cn', 'wallhaven.cc'])) {
    return target('媒体与素材下载/平面与视觉');
  }

  // Daily utility entry points.
  if (domainMatchesAny(hostname, ['google.com', 'bing.com', 'duckduckgo.com', 'yandex.com', 'sogou.com', 'startpage.com'])
    || hostname === 'baidu.com' || hostname === 'www.baidu.com'
    || domainMatchesAny(hostname, ['deepl.com', 'translate.google.com', 'amap.com', 'maps.google.com', 'map.baidu.com'])) {
    return target('效率与日常工具/网络与网盘');
  }

  if (domainMatchesAny(hostname, [
    'dash.cloudflare.com', 'console.cloud.google.com', 'console.aws.amazon.com',
    'portal.azure.com', 'vercel.com', 'netlify.com',
  ]) || /\/(dashboard|console|admin|account|billing)(\/|$)/.test(pathname)) {
    return target('效率与日常工具/网络与网盘');
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
    '2. 优先选择最具体的二级分类；只有一级明显匹配但没有合适二级时才选择一级分类。',
    '3. 先判断内容形态：在线直接看/读/听，与离线下载、终端应用下载、工具服务、社区资讯要严格区分。',
    '4. 在线影视/番剧/短视频/音乐电台归“在线影音”；小说/漫画/电子书在线阅读归“图文阅读”。',
    '5. PC/手机/TV/系统 App 安装包归“终端应用下载”；影视/音乐/图片字体等媒体素材离线资源归“媒体与素材下载”。',
    '6. 游戏本体下载和游戏客户端归“游戏专区/游戏下载”；MOD、修改器、汉化补丁、存档归“游戏专区/游戏辅助工具”。',
    '7. 接码、临时邮箱、格式转换、OCR、网盘搜索/解析、速度测试、AI 工具归“效率与日常工具”。',
    '8. 热榜、科技数码资讯、泛娱乐资讯、论坛/贴吧/社交网络归“社区与资讯”；不要把论坛帖子按帖子主题强行塞到下载或工具类。',
    '9. NSFW 成人内容必须优先归“绅士领域 [NSFW]”，并按视频、BT下载、本子、写真、游戏、小说细分，不要归入普通影音/图文/下载类。',
    '10. 如果只能猜测、信息不足、多个分类同样合理，返回空字符串；不要为了填满而强行分类。',
    '11. 如果模型环境具备网页访问或 Web 搜索能力，优先核实网页内容；如果没有页面正文，只能根据标题、域名、URL 路径、描述和候选分类判断；不要编造访问结果。',
  ];

  const boundaryRules: string[] = [];
  if (hasCategoryPath(categoryList, '社区与资讯')) {
    boundaryRules.push(`社区与资讯：${describeAvailableChildren(categoryList, '社区与资讯')}。热榜是纯趋势信息流；讨论社区是用户发帖交流平台；科技数码与娱乐游戏综合是资讯站或媒体站。`);
  }
  if (hasCategoryPath(categoryList, '在线影音')) {
    boundaryRules.push(`在线影音：${describeAvailableChildren(categoryList, '在线影音')}。核心是免下载直接观看/收听；离线片源、BT、PT、字幕组不要放这里。`);
  }
  if (hasCategoryPath(categoryList, '图文阅读')) {
    boundaryRules.push(`图文阅读：${describeAvailableChildren(categoryList, '图文阅读')}。核心是在线阅读小说/漫画/电子书库；成人小说和 R18 本子归 NSFW。`);
  }
  if (hasCategoryPath(categoryList, '游戏专区')) {
    boundaryRules.push(`游戏专区：${describeAvailableChildren(categoryList, '游戏专区')}。游戏本体/客户端下载和游戏辅助工具分开；成人游戏归 NSFW/绅士游戏。`);
  }
  if (hasCategoryPath(categoryList, '终端应用下载')) {
    boundaryRules.push(`终端应用下载：${describeAvailableChildren(categoryList, '终端应用下载')}。按 Windows/macOS/Android/iOS 平台区分安装包、破解版、绿色版、侧载源。`);
  }
  if (hasCategoryPath(categoryList, '媒体与素材下载')) {
    boundaryRules.push(`媒体与素材下载：${describeAvailableChildren(categoryList, '媒体与素材下载')}。核心是离线下载的影视、音频和平面视觉素材；在线直接看/听不要放这里。`);
  }
  if (hasCategoryPath(categoryList, '效率与日常工具')) {
    boundaryRules.push(`效率与日常工具：${describeAvailableChildren(categoryList, '效率与日常工具')}。核心是在线完成操作、临时隐私、网盘/网络工具、AI 辅助。`);
  }
  if (hasCategoryPath(categoryList, '绅士领域 [NSFW]')) {
    boundaryRules.push(`绅士领域 [NSFW]：${describeAvailableChildren(categoryList, '绅士领域 [NSFW]')}。成人内容强制进入该类，并优先按内容形态细分。`);
  }

  if (boundaryRules.length) {
    guide.push('', '重点分类边界：', ...boundaryRules.map((line, index) => `${index + 1}. ${line}`));
  }

  return guide.join('\n');
}

function buildOrganizeSystemPrompt(categoryList: string[]): string {
  const categoriesText = categoryList.join('\n');
  const descriptionGuide = buildCategoryDescriptionGuide(categoryList);
  return `你是书签分类助手。你的目标是提升分类准确率，而不是平均分配或强行移动。
只能从以下分类列表中选择最匹配的分类，不能创建新分类，输出必须与候选分类路径完全一致。
如果没有合适的分类，返回空字符串。

${buildOrganizeCategoryGuide(categoryList)}
${descriptionGuide ? `\n\n${descriptionGuide}` : ''}

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

  return `请为以下每个书签选择最合适的分类。优先联网访问 URL 或使用 Web 搜索核实内容；如果无法联网、无法访问或工具不可用，再根据标题、域名、URL 路径、描述和当前分类等有限线索判断；不要编造访问结果。重点区分在线消费、离线下载、终端应用下载、效率工具、社区资讯和 NSFW；信息不足时返回空字符串。\n${batchList}`;
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
          const completionRequest: AIChatCompletionRequest = {
            model: config.model,
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              { role: 'user', content: buildBookmarkBatchPrompt(aiBatch) },
            ],
            temperature: 0.1,
          };
          const completion = await aiClient.createChatCompletion(withAiReasoningEffort(completionRequest, config.reasoningEffort));

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
