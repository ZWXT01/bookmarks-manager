import OpenAI from 'openai';
import type { Db } from './db';
import type { Assignment, CategoryNode, PlanRow } from './ai-organize-plan';
import { updatePlan, transitionStatus, getPlan } from './ai-organize-plan';
import { updateJob, jobQueue } from './jobs';

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

interface FeatureSummary {
  topDomains: { domain: string; count: number }[];
  topKeywords: { keyword: string; count: number }[];
  existingCategories: { name: string; count: number }[];
  totalBookmarks: number;
}

// ==================== Feature Extraction ====================

export function extractFeatures(db: Db): FeatureSummary {
  const totalRow = db.prepare('SELECT COUNT(*) AS cnt FROM bookmarks').get() as { cnt: number };
  const total = totalRow.cnt;

  // domain TOP 200
  const domainRows = db.prepare(`
    SELECT REPLACE(REPLACE(REPLACE(url, 'https://', ''), 'http://', ''), 'www.', '') AS raw_url
    FROM bookmarks WHERE url IS NOT NULL
  `).all() as { raw_url: string }[];

  const domainCounts = new Map<string, number>();
  for (const r of domainRows) {
    const domain = r.raw_url.split('/')[0]?.toLowerCase();
    if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  const topDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 200)
    .map(([domain, count]) => ({ domain, count }));

  // keyword TOP 100
  const titleRows = db.prepare("SELECT title FROM bookmarks WHERE title IS NOT NULL AND title != ''").all() as { title: string }[];
  const kwCounts = new Map<string, number>();
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'with', 'by', 'from', 'as', 'it', 'this', 'that', 'be', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'not', 'no', 'but', 'if', 'so', 'up', 'out', 'about', 'into', 'over', 'after', 'all', 'also', 'new', 'one', 'two', 'just', 'more', 'how', 'what', 'when', 'who', 'which', 'where', 'why', 'than', 'then', 'now', 'only', 'very', 'its', 'my', 'your', 'our', 'their', 'his', 'her', 'we', 'you', 'they', 'he', 'she', 'me', 'us', 'him', 'them', '的', '了', '在', '是', '和', '与', '及', '等', '个', '中', '为', '上', '下', '大', '小', '有', '无', '不', '也', '都', '就', '还', '又', '被', '把', '让', '给', '从', '到', '对', '向', '以', '用', '于', '而', '但', '却', '如', '若', '虽', '然', '因', '所', '这', '那', '些', '每', '各', '该', '其', '之', '者', '来', '去', '过', '着', '得', '地', '会', '能', '可', '要', '想', '应', '该']);
  for (const r of titleRows) {
    const words = r.title.replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(w => w.length >= 2);
    for (const w of words) {
      const lw = w.toLowerCase();
      if (!stopWords.has(lw)) kwCounts.set(lw, (kwCounts.get(lw) ?? 0) + 1);
    }
  }
  const topKeywords = [...kwCounts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 100)
    .map(([keyword, count]) => ({ keyword, count }));

  // existing categories with counts
  const catRows = db.prepare(`
    SELECT c.name, COUNT(b.id) AS count FROM categories c
    LEFT JOIN bookmarks b ON b.category_id = c.id
    GROUP BY c.id ORDER BY count DESC
  `).all() as { name: string; count: number }[];

  return { topDomains, topKeywords, existingCategories: catRows, totalBookmarks: total };
}

// ==================== AI Category Tree Design ====================

export async function designCategoryTree(db: Db, config: AIConfig, scope: string): Promise<CategoryNode[]> {
  const features = extractFeatures(db);
  const existingList = features.existingCategories.map(c => c.name).join('、');

  const sampleUrls = db.prepare(`SELECT url FROM bookmarks WHERE url IS NOT NULL ORDER BY RANDOM() LIMIT 30`).all() as { url: string }[];
  const urlSample = sampleUrls.map(r => r.url).join('\n');

  const prompt = `你是书签分类体系设计专家。请联网访问下方的代表性URL，了解这些网站的实际内容后，设计一个二级分类树。

规则：
1. 一级分类 3-20 个，总分类数 ≤ 200
2. 最多 2 级（一级/二级），禁止 3 级
3. 分类名称 ≤ 50 字符
4. 同级名称不能重复
5. 优先复用已有分类名称

书签总数: ${features.totalBookmarks}
整理范围: ${scope}

代表性URL（请联网访问了解内容）:
${urlSample}

域名 TOP 50:
${features.topDomains.slice(0, 50).map(d => `${d.domain} (${d.count})`).join(', ')}

关键词 TOP 50:
${features.topKeywords.slice(0, 50).map(k => `${k.keyword} (${k.count})`).join(', ')}

${existingList ? `已有分类: ${existingList}` : ''}

严格返回 JSON，格式：
[{"name":"一级分类","children":[{"name":"二级分类"}]}]`;

  const openai = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl.replace(/\/+$/, ''), timeout: 120000, defaultHeaders: { 'User-Agent': 'bookmarks-manager/1.0' } });
  const completion = await openai.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: '你具备联网能力。请先联网访问用户提供的URL了解网站内容，再设计分类树。只返回 JSON 数组，不要解释。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() ?? '';
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI 未返回有效的分类树 JSON');

  const tree = JSON.parse(jsonMatch[0]) as CategoryNode[];
  if (!Array.isArray(tree) || tree.length === 0) throw new Error('AI 返回的分类树为空');
  return tree;
}

// ==================== Batch Assignment ====================

export function validateAssignment(categoryPath: string, validPaths: Set<string>): boolean {
  const normalized = categoryPath.split('/').map(s => s.trim()).filter(Boolean).slice(0, 2).join('/');
  return validPaths.has(normalized.toLowerCase().trim());
}

interface BookmarkBatch { id: number; url: string; title: string; current_category: string | null }

function buildValidPaths(tree: CategoryNode[]): Set<string> {
  const paths = new Set<string>();
  for (const node of tree) {
    const top = node.name.trim();
    if (!top) continue;
    paths.add(top.toLowerCase().trim());
    for (const child of (node.children ?? [])) {
      const leaf = child.name.trim();
      if (leaf) paths.add(`${top}/${leaf}`.toLowerCase().trim());
    }
  }
  return paths;
}

export async function assignBookmarks(
  db: Db, planId: string, config: AIConfig, retryConfig: RetryConfig = {},
): Promise<void> {
  const timeout = retryConfig.timeout ?? 300000;
  const maxRetries = retryConfig.maxRetries ?? 2;
  const failThreshold = retryConfig.failThreshold ?? 5;

  const plan = getPlan(db, planId);
  if (!plan) throw new Error('plan not found');

  const tree: CategoryNode[] = JSON.parse(plan.target_tree ?? '[]');
  const validPaths = buildValidPaths(tree);

  // resolve scope
  let whereClause = '';
  if (plan.scope === 'uncategorized') whereClause = 'WHERE b.category_id IS NULL';
  else if (plan.scope.startsWith('category:')) {
    const catId = parseInt(plan.scope.split(':')[1]);
    if (!isNaN(catId)) whereClause = `WHERE b.category_id = ${catId}`;
  }

  const bookmarks = db.prepare(`
    SELECT b.id, b.url, b.title, c.name AS current_category
    FROM bookmarks b LEFT JOIN categories c ON c.id = b.category_id
    ${whereClause} ORDER BY b.id
  `).all() as BookmarkBatch[];

  const batchSize = 50;
  const batches: BookmarkBatch[][] = [];
  for (let i = 0; i < bookmarks.length; i += batchSize) batches.push(bookmarks.slice(i, i + batchSize));

  updatePlan(db, planId, { batches_total: batches.length, batches_done: 0 });

  const allAssignments: Assignment[] = [];
  let consecutiveFails = 0;
  let needsReviewCount = 0;
  const failedBatchIds: number[] = [];

  const treePaths = [...validPaths].join('\n');
  const openai = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl.replace(/\/+$/, ''), timeout, defaultHeaders: { 'User-Agent': 'bookmarks-manager/1.0' } });

  for (let bi = 0; bi < batches.length; bi++) {
    if (jobQueue.isCanceled(plan.job_id ?? '')) {
      transitionStatus(db, planId, 'canceled');
      return;
    }

    const batch = batches[bi];
    let success = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const batchList = batch.map((b, i) => `${i + 1}. [${b.title}] ${b.url}${b.current_category ? ` (当前: ${b.current_category})` : ''}`).join('\n');
        const completion = await openai.chat.completions.create({
          model: config.model,
          messages: [
            { role: 'system', content: `你是书签分类助手，具备联网能力。请联网访问每个书签的URL，了解网页实际内容后再分类。从以下分类中选择最匹配的分类，不能创建新分类。\n\n可选分类:\n${treePaths}\n\n严格返回 JSON: {"assignments":[{"index":1,"category":"分类路径"}]}` },
            { role: 'user', content: `请联网访问以下每个书签的URL，了解内容后分类:\n${batchList}` },
          ],
          temperature: 0.2,
        });

        const raw = completion.choices?.[0]?.message?.content?.trim() ?? '';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('no JSON in response');

        const parsed = JSON.parse(jsonMatch[0]) as { assignments: { index: number; category: string }[] };
        const assignMap = new Map<number, string>();
        for (const a of (parsed.assignments ?? [])) assignMap.set(a.index, a.category);

        for (let i = 0; i < batch.length; i++) {
          const cat = assignMap.get(i + 1);
          if (cat && validateAssignment(cat, validPaths)) {
            allAssignments.push({ bookmark_id: batch[i].id, category_path: cat.trim(), status: 'assigned' });
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
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // exponential backoff
      }
    }

    if (!success) {
      consecutiveFails++;
      failedBatchIds.push(bi);
      // mark all in batch as needs_review
      for (const b of batch) {
        allAssignments.push({ bookmark_id: b.id, category_path: '', status: 'needs_review' });
        needsReviewCount++;
      }

      if (consecutiveFails >= failThreshold) {
        updatePlan(db, planId, {
          assignments: JSON.stringify(allAssignments),
          failed_batch_ids: JSON.stringify(failedBatchIds),
          needs_review_count: needsReviewCount,
          batches_done: bi + 1,
        });
        transitionStatus(db, planId, 'failed');
        return;
      }
    }

    updatePlan(db, planId, { batches_done: bi + 1, needs_review_count: needsReviewCount });
  }

  // all done
  updatePlan(db, planId, {
    assignments: JSON.stringify(allAssignments),
    failed_batch_ids: failedBatchIds.length ? JSON.stringify(failedBatchIds) : null,
    needs_review_count: needsReviewCount,
  });
  transitionStatus(db, planId, 'preview');
}
