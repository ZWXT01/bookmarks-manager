import type { Db } from './db';
import type { Assignment, CategoryNode, PlanRow } from './ai-organize-plan';
import { updatePlan, transitionStatus, getPlan, buildPlanSourceSnapshot, getPlanScopeBookmarkIds } from './ai-organize-plan';
import { updateJob, jobQueue, publishJobEvent } from './jobs';
import { getCategoryTree } from './category-service';
import { createOpenAIClient, extractAICompletionText, type AIClientFactory } from './ai-client';
import { getTemplate, getActiveTemplate } from './template-service';

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

function buildLiveCategoryTreeSnapshot(db: Db): CategoryNode[] {
  return getCategoryTree(db).map(node => ({
    name: node.name,
    children: (node.children ?? []).map(child => ({ name: child.name })),
  }));
}

function resolvePlanTargetTree(db: Db, plan: Pick<PlanRow, 'template_id' | 'target_tree'>): CategoryNode[] {
  const snapshottedTree = parseTargetTree(plan.target_tree);
  if (snapshottedTree.length > 0) return snapshottedTree;

  if (plan.template_id != null) {
    const template = getTemplate(db, plan.template_id);
    if (template) {
      const templateTree = parseTargetTree(template.tree);
      if (templateTree.length > 0) return templateTree;
    }
  }

  const activeTemplate = getActiveTemplate(db);
  if (activeTemplate) {
    const activeTree = parseTargetTree(activeTemplate.tree);
    if (activeTree.length > 0) return activeTree;
  }

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

interface BookmarkBatch { id: number; url: string; title: string; current_category: string | null }

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
  const bookmarks = scopeBookmarkIds.length > 0
    ? db.prepare(`
      SELECT b.id, b.url, b.title, c.name AS current_category
      FROM bookmarks b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.id IN (${scopeBookmarkIds.map(() => '?').join(',')})
      ORDER BY b.id
    `).all(...scopeBookmarkIds) as BookmarkBatch[]
    : [];

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
        const batchList = batch.map((b, i) => `${i + 1}. [${b.title}] ${b.url}`).join('\n');
        const completion = await aiClient.createChatCompletion({
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

        const raw = extractAICompletionText(completion);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('no JSON in response');

        const parsed = JSON.parse(jsonMatch[0]) as { assignments: { index: number; category: string }[] };
        const assignMap = new Map<number, string>();
        for (const a of (parsed.assignments ?? [])) assignMap.set(a.index, a.category);
        if (isPlanExecutionCanceled(db, planId, plan.job_id)) return;

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
