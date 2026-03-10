import OpenAI from 'openai';
import type { Db } from './db';
import type { Assignment, CategoryNode, PlanRow } from './ai-organize-plan';
import { updatePlan, transitionStatus, getPlan } from './ai-organize-plan';
import { updateJob, jobQueue, publishJobEvent } from './jobs';
import { getCategoryTree } from './category-service';

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

export function validateAssignment(categoryPath: string, validPaths: Set<string>): boolean {
  const normalized = categoryPath.split('/').map(s => s.trim()).filter(Boolean).slice(0, 2).join('/');
  return validPaths.has(normalized.toLowerCase().trim());
}

interface BookmarkBatch { id: number; url: string; title: string; current_category: string | null }

function buildValidPathsFromDb(db: Db): Set<string> {
  const paths = new Set<string>();
  for (const node of getCategoryTree(db)) {
    const fp = node.fullPath.trim();
    if (fp) paths.add(fp.toLowerCase());
    for (const child of node.children) {
      const cfp = child.fullPath.trim();
      if (cfp) paths.add(cfp.toLowerCase());
    }
  }
  return paths;
}

function buildCategoryListFromDb(db: Db): string[] {
  const list: string[] = [];
  for (const node of getCategoryTree(db)) {
    const fp = node.fullPath.trim();
    if (fp) list.push(fp);
    for (const child of node.children) {
      const cfp = child.fullPath.trim();
      if (cfp) list.push(cfp);
    }
  }
  return list;
}

export async function assignBookmarks(
  db: Db, planId: string, config: AIConfig, retryConfig: RetryConfig = {}, batchSize: BatchSize = 20,
): Promise<void> {
  const timeout = retryConfig.timeout ?? 300000;
  const maxRetries = retryConfig.maxRetries ?? 2;
  const failThreshold = retryConfig.failThreshold ?? 5;

  const plan = getPlan(db, planId);
  if (!plan) throw new Error('plan not found');

  const validPaths = buildValidPathsFromDb(db);
  const categoryList = buildCategoryListFromDb(db);

  // resolve scope: support bookmark_ids, uncategorized, category:N, or all
  let whereClause = '';
  if (plan.scope === 'uncategorized') {
    whereClause = 'WHERE b.category_id IS NULL';
  } else if (plan.scope.startsWith('category:')) {
    const catId = parseInt(plan.scope.split(':')[1]);
    if (!isNaN(catId)) whereClause = `WHERE b.category_id = ${catId}`;
  } else if (plan.scope.startsWith('ids:')) {
    const ids = plan.scope.slice(4).split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (ids.length) whereClause = `WHERE b.id IN (${ids.join(',')})`;
  }

  const bookmarks = db.prepare(`
    SELECT b.id, b.url, b.title, c.name AS current_category
    FROM bookmarks b LEFT JOIN categories c ON c.id = b.category_id
    ${whereClause} ORDER BY b.id
  `).all() as BookmarkBatch[];

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

  const categoriesText = categoryList.join('\n');
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
        const batchList = batch.map((b, i) => `${i + 1}. [${b.title}] ${b.url}`).join('\n');
        const completion = await openai.chat.completions.create({
          model: config.model,
          messages: [
            {
              role: 'system',
              content: `你是书签分类助手，具备联网能力。请联网访问每个书签的URL，了解网页实际内容后再分类。
只能从以下分类列表中选择最匹配的分类，不能创建新分类。
如果没有合适的分类，返回空字符串。

可选分类:
${categoriesText}

严格返回 JSON: {"assignments":[{"index":1,"category":"分类路径"}]}`
            },
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
          if (cat && cat.trim() !== '' && validateAssignment(cat, validPaths)) {
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

    // Collect this batch's assignments for SSE push
    const batchAssignments = allAssignments.slice(allAssignments.length - batch.length);
    const bmMap = new Map(batch.map(b => [b.id, { title: b.title, url: b.url }]));
    const enriched = batchAssignments.map(a => ({
      ...a,
      title: bmMap.get(a.bookmark_id)?.title ?? '',
      url: bmMap.get(a.bookmark_id)?.url ?? '',
    }));

    updatePlan(db, planId, { batches_done: bi + 1, needs_review_count: needsReviewCount });
    if (plan.job_id) {
      updateJob(db, plan.job_id, {
        processed: allAssignments.length,
        inserted: allAssignments.length - needsReviewCount,
        skipped: needsReviewCount,
      });
      publishJobEvent(plan.job_id, 'batch_assignments', enriched);
    }
  }

  updatePlan(db, planId, {
    assignments: JSON.stringify(allAssignments),
    failed_batch_ids: failedBatchIds.length ? JSON.stringify(failedBatchIds) : null,
    needs_review_count: needsReviewCount,
  });

  if (plan.job_id) {
    const assignedCount = allAssignments.filter(a => a.status === 'assigned').length;
    updateJob(db, plan.job_id, {
      processed: allAssignments.length,
      inserted: assignedCount,
      skipped: needsReviewCount,
    });
  }

  transitionStatus(db, planId, 'preview');
}
