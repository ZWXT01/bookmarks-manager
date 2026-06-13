import { randomUUID } from 'crypto';
import type { Db } from './db';
import { getCategoryIdsForScope, getCategoryTree } from './category-service';
import { createJob, updateJob, getJob, jobQueue } from './jobs';

// ==================== Types ====================

export type PlanStatus = 'assigning' | 'preview' | 'applied' | 'canceled' | 'rolled_back' | 'failed' | 'error';

export interface PlanRow {
  id: string; job_id: string | null; status: PlanStatus; scope: string;
  target_tree: string | null; assignments: string | null; diff_summary: string | null;
  backup_snapshot: string | null; source_snapshot: string | null; phase: string | null;
  batches_done: number; batches_total: number;
  failed_batch_ids: string | null; needs_review_count: number;
  created_at: string; applied_at: string | null;
}

export interface CategoryNode { name: string; children: { name: string }[] }
export interface Assignment { bookmark_id: number; category_path: string; status: 'assigned' | 'needs_review' }
export type AssignmentInvalidReason = 'needs_review' | 'target_category_missing' | 'target_category_changed' | 'snapshot_missing';
export interface AssignmentApplicability {
  can_apply: boolean;
  invalid_reason: AssignmentInvalidReason | null;
  invalid_message: string | null;
  target_category_id?: number;
}

export interface DiffSummary {
  empty_categories: { id: number; name: string }[];
  moves: { bookmark_id: number; from_category: string | null; to_category: string }[];
  summary: { move_count: number; empty_count: number; needs_review: number };
}

export interface ConflictItem {
  bookmark_id: number;
  title: string;
  url: string;
  updated_at: string | null;
  reason: 'bookmark_changed' | 'bookmark_updated' | 'overlapping_plan';
  current_category: string | null;
  newer_plan_id?: string | null;
  newer_plan_status?: PlanStatus | null;
  newer_plan_created_at?: string | null;
}
export interface ApplyResult { conflicts: ConflictItem[]; empty_categories: { id: number; name: string }[]; applied_count: number }
export interface RollbackResult { restored_categories: number; restored_bookmarks: number }
export type BookmarkDecisionAction = 'apply' | 'discard';
export interface BookmarkApplyDecision { bookmark_id: number; action: BookmarkDecisionAction }
export interface ResolveDecisions {
  decisions?: BookmarkApplyDecision[];
  conflicts?: { bookmark_id: number; action: 'override' | 'skip' }[];
  empty_categories?: { id: number; action: 'delete' | 'keep' }[];
}

export interface PlanBookmarkSnapshot {
  bookmark_id: number;
  category_id: number | null;
  updated_at: string | null;
}

export interface PlanLiveTargetSnapshot {
  path: string;
  category_id: number;
}

export interface PlanSourceSnapshot {
  bookmark_states: PlanBookmarkSnapshot[];
  live_target_categories: PlanLiveTargetSnapshot[];
  scope_bookmark_ids: number[];
  scope_frozen: boolean;
}

export class PlanError extends Error {
  statusCode: number;
  activePlanId?: string;
  blockingPlanId?: string;
  blockingPlanStatus?: PlanStatus;
  blockingJobId?: string | null;
  discardRecommended?: boolean;
  constructor(statusCode: number, message: string, options?: {
    activePlanId?: string;
    blockingPlanId?: string;
    blockingPlanStatus?: PlanStatus;
    blockingJobId?: string | null;
    discardRecommended?: boolean;
  }) {
    super(message);
    this.name = 'PlanError';
    this.statusCode = statusCode;
    this.activePlanId = options?.activePlanId;
    this.blockingPlanId = options?.blockingPlanId;
    this.blockingPlanStatus = options?.blockingPlanStatus;
    this.blockingJobId = options?.blockingJobId;
    this.discardRecommended = options?.discardRecommended;
  }
}

// ==================== Constants ====================

const ACTIVE_STATUSES: PlanStatus[] = ['assigning'];
const BLOCKING_STATUSES: PlanStatus[] = ['assigning', 'preview', 'failed', 'error'];
const IMMUTABLE_TERMINAL_STATUSES = new Set<PlanStatus>(['applied', 'canceled', 'rolled_back']);
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const PLAN_TIMEOUT_MS = 7_200_000;
const DEFAULT_REASONS: Record<string, string> = {
  canceled: 'user_cancel', applied: 'user_apply', rolled_back: 'user_rollback',
  assigning: 'plan_created', preview: 'assignment_complete', failed: 'assignment_failed', error: 'assignment_failed',
};

export interface BlockingOrganizePlan {
  id: string;
  job_id: string | null;
  status: PlanStatus;
  created_at: string;
}

// ==================== Helpers ====================
const nowIso = () => new Date().toISOString();
const casefold = (s: string) => s.toLowerCase().trim();

function normalizePath(path: string): string {
  const parts = path.split('/').map(s => s.trim()).filter(Boolean).slice(0, 2);
  return parts.join('/');
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function parseAssignments(raw: string | null): Assignment[] {
  const arr = safeJson<unknown[]>(raw, []);
  if (!Array.isArray(arr)) return [];
  const map = new Map<number, Assignment>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const bid = Number(o.bookmark_id);
    if (!Number.isInteger(bid) || bid <= 0) continue;
    const cp = normalizePath(typeof o.category_path === 'string' ? o.category_path : '');
    map.set(bid, { bookmark_id: bid, category_path: cp, status: o.status === 'needs_review' || !cp ? 'needs_review' : 'assigned' });
  }
  return [...map.values()];
}

function parseTree(raw: string | null): CategoryNode[] {
  const arr = safeJson<unknown[]>(raw, []);
  if (!Array.isArray(arr)) return [];
  return arr.filter((n): n is Record<string, unknown> => !!n && typeof n === 'object').map(n => ({
    name: typeof n.name === 'string' ? n.name : '',
    children: (Array.isArray(n.children) ? n.children : [])
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map(c => ({ name: typeof c.name === 'string' ? c.name : '' })),
  }));
}

type PathLookup = Map<string, { id: number; path: string }>;

type BookmarkStateRow = { id: number; category_id: number | null; updated_at: string | null };

function buildPathLookup(db: Db): PathLookup {
  const lookup: PathLookup = new Map();
  for (const node of getCategoryTree(db)) {
    const p = normalizePath(node.fullPath || node.name);
    if (p) lookup.set(casefold(p), { id: node.id, path: p });
    for (const child of node.children) {
      const cp = normalizePath(child.fullPath || child.name);
      if (cp) lookup.set(casefold(cp), { id: child.id, path: cp });
    }
  }
  return lookup;
}

function getExistingCategoryId(rawPath: string, lookup: PathLookup): number {
  const p = normalizePath(rawPath);
  if (!p) throw new Error('invalid category path');
  const key = casefold(p);
  const existing = lookup.get(key);
  if (!existing) throw new PlanError(409, 'plan is stale: target categories changed', { discardRecommended: true });
  return existing.id;
}

function buildSnapshotTargetMap(snapshot: PlanSourceSnapshot | null): Map<string, PlanLiveTargetSnapshot> {
  const map = new Map<string, PlanLiveTargetSnapshot>();
  for (const target of snapshot?.live_target_categories ?? []) {
    const path = normalizePath(target.path);
    if (!path) continue;
    map.set(casefold(path), { ...target, path });
  }
  return map;
}

type BookmarkRow = { id: number; title: string; url: string; category_id: number | null; category_path: string | null; updated_at: string | null };

function getBookmarkMap(db: Db): Map<number, BookmarkRow> {
  const categoryPaths = new Map<number, string>();
  for (const node of getCategoryTree(db)) {
    const rootPath = normalizePath(node.fullPath || node.name);
    if (rootPath) categoryPaths.set(node.id, rootPath);
    for (const child of node.children) {
      const childPath = normalizePath(child.fullPath || child.name);
      if (childPath) categoryPaths.set(child.id, childPath);
    }
  }

  const rows = db.prepare(`
    SELECT b.id, b.title, b.url, b.category_id, b.updated_at
    FROM bookmarks b
  `).all() as Array<Omit<BookmarkRow, 'category_path'>>;
  return new Map(rows.map((row) => [row.id, {
    ...row,
    category_path: row.category_id != null ? categoryPaths.get(row.category_id) ?? null : null,
  }]));
}

type CatUsage = { id: number; name: string; bookmark_count: number; has_children: number };

function getCatUsage(db: Db): CatUsage[] {
  return db.prepare(`
    SELECT c.id,
      CASE WHEN p.id IS NOT NULL THEN p.name || '/' || c.name ELSE c.name END AS name,
      COUNT(b.id) AS bookmark_count,
      CASE WHEN EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id) THEN 1 ELSE 0 END AS has_children
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
    LEFT JOIN bookmarks b ON b.category_id = c.id
    GROUP BY c.id
  `).all() as CatUsage[];
}

function collectTargetPaths(plan: Pick<PlanRow, 'target_tree' | 'assignments'>, assignments?: Assignment[]): string[] {
  const tree = parseTree(plan.target_tree);
  const paths: string[] = [];
  for (const node of tree) {
    const top = node.name.trim();
    if (!top) continue;
    paths.push(top);
    for (const child of node.children) {
      const leaf = child.name.trim();
      if (leaf) paths.push(`${top}/${leaf}`);
    }
  }
  for (const a of (assignments ?? parseAssignments(plan.assignments))) {
    if (a.status === 'assigned' && a.category_path) paths.push(a.category_path);
  }
  // dedupe by casefold
  const seen = new Set<string>();
  return paths.filter(p => { const k = casefold(normalizePath(p)); if (seen.has(k)) return false; seen.add(k); return true; });
}

function getBookmarkStates(db: Db, bookmarkIds: number[]): Map<number, BookmarkStateRow> {
  if (!bookmarkIds.length) return new Map();
  const rows = db.prepare(`
    SELECT id, category_id, updated_at
    FROM bookmarks
    WHERE id IN (${bookmarkIds.map(() => '?').join(',')})
  `).all(...bookmarkIds) as BookmarkStateRow[];
  return new Map(rows.map(row => [row.id, row]));
}

function parseScopeBookmarkIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const item of value) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseScopeIds(scope: string): number[] {
  return parseScopeBookmarkIds(scope.slice(4).split(','));
}

function resolveScopeBookmarkIds(db: Db, rawScope: string): number[] {
  const scope = rawScope.trim() || 'all';
  if (scope.startsWith('ids:')) return parseScopeIds(scope);
  if (scope === 'uncategorized') {
    return db.prepare(`
      SELECT id
      FROM bookmarks
      WHERE category_id IS NULL
      ORDER BY id
    `).all().map((row) => Number((row as { id: number }).id)).filter((id) => Number.isInteger(id) && id > 0);
  }
  if (scope.startsWith('category:')) {
    const categoryId = Number(scope.split(':')[1]);
    if (!Number.isInteger(categoryId) || categoryId <= 0) return [];
    const categoryIds = getCategoryIdsForScope(db, categoryId);
    if (categoryIds.length === 0) return [];
    return db.prepare(`
      SELECT id
      FROM bookmarks
      WHERE category_id IN (${categoryIds.map(() => '?').join(',')})
      ORDER BY id
    `).all(...categoryIds).map((row) => Number((row as { id: number }).id)).filter((id) => Number.isInteger(id) && id > 0);
  }
  return db.prepare(`
    SELECT id
    FROM bookmarks
    ORDER BY id
  `).all().map((row) => Number((row as { id: number }).id)).filter((id) => Number.isInteger(id) && id > 0);
}

function parseSourceSnapshot(raw: string | null): PlanSourceSnapshot | null {
  const value = safeJson<Record<string, unknown> | null>(raw, null);
  if (!value || typeof value !== 'object') return null;

  const bookmarkStates = Array.isArray(value.bookmark_states)
    ? value.bookmark_states
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        bookmark_id: Number(item.bookmark_id),
        category_id: item.category_id == null ? null : Number(item.category_id),
        updated_at: typeof item.updated_at === 'string' ? item.updated_at : null,
      }))
      .filter(item => Number.isInteger(item.bookmark_id) && item.bookmark_id > 0 && (item.category_id == null || Number.isInteger(item.category_id)))
    : [];

  const liveTargetCategories = Array.isArray(value.live_target_categories)
    ? value.live_target_categories
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        path: normalizePath(typeof item.path === 'string' ? item.path : ''),
        category_id: Number(item.category_id),
      }))
      .filter(item => item.path && Number.isInteger(item.category_id) && item.category_id > 0)
    : [];

  const hasScopeBookmarkIds = Array.isArray(value.scope_bookmark_ids);
  const scopeBookmarkIds = parseScopeBookmarkIds(value.scope_bookmark_ids);
  const scopeFrozen = value.scope_frozen === true || hasScopeBookmarkIds;

  return {
    bookmark_states: bookmarkStates,
    live_target_categories: liveTargetCategories,
    scope_bookmark_ids: scopeBookmarkIds,
    scope_frozen: scopeFrozen,
  };
}

function buildLiveCategoryTreeSnapshot(db: Db): CategoryNode[] {
  return getCategoryTree(db).map(node => ({
    name: node.name,
    children: (node.children ?? []).map(child => ({ name: child.displayName || child.name })),
  }));
}

function buildInitialTargetTree(db: Db): CategoryNode[] {
  return buildLiveCategoryTreeSnapshot(db);
}

function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  if (from === to) return true;
  if (to === 'canceled' && !IMMUTABLE_TERMINAL_STATUSES.has(from)) return true;
  const allowed: Record<string, PlanStatus[]> = {
    assigning: ['preview', 'failed', 'error'],
    preview: ['applied'],
    failed: ['assigning'],
    error: ['assigning'],
    applied: ['rolled_back'],
  };
  return (allowed[from] ?? []).includes(to);
}

function logStateChange(db: Db, planId: string, from: string | null, to: string, reason: string): void {
  db.prepare('INSERT INTO plan_state_logs (plan_id, from_status, to_status, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(planId, from, to, reason, nowIso());
}

function expireAssigningPlan(db: Db, plan: PlanRow): void {
  updatePlan(db, plan.id, { status: 'error', phase: null });
  logStateChange(db, plan.id, plan.status, 'error', 'timeout');
  if (!plan.job_id) return;
  jobQueue.cancelJob(plan.job_id);
  if (getJob(db, plan.job_id)) {
    updateJob(db, plan.job_id, { status: 'failed', message: 'plan timeout' });
  }
}

function cancelAssigningPlanForCanceledJob(db: Db, plan: PlanRow): void {
  updatePlan(db, plan.id, { status: 'canceled', phase: null });
  logStateChange(db, plan.id, plan.status, 'canceled', 'job_canceled');
}

function toBlockingPlan(row: PlanRow): BlockingOrganizePlan {
  return {
    id: row.id,
    job_id: row.job_id ?? null,
    status: row.status,
    created_at: row.created_at,
  };
}

function getBlockingPlanMessage(plan: BlockingOrganizePlan): string {
  if (plan.status === 'assigning') return 'active plan already exists';
  if (plan.status === 'preview') return 'pending plan already exists';
  return 'unresolved plan already exists';
}

export function getBlockingOrganizePlan(db: Db, excludePlanId?: string | null): BlockingOrganizePlan | null {
  const placeholders = BLOCKING_STATUSES.map(() => '?').join(',');
  const params: unknown[] = [...BLOCKING_STATUSES];
  let excludeClause = '';
  if (excludePlanId) {
    excludeClause = 'AND id <> ?';
    params.push(excludePlanId);
  }

  const rows = db.prepare(`
    SELECT *
    FROM ai_organize_plans
    WHERE status IN (${placeholders})
      ${excludeClause}
    ORDER BY
      CASE status
        WHEN 'assigning' THEN 0
        WHEN 'preview' THEN 1
        WHEN 'error' THEN 2
        WHEN 'failed' THEN 3
        ELSE 9
      END,
      created_at DESC
  `).all(...params) as PlanRow[];

  let blocking: PlanRow | null = null;
  for (const row of rows) {
    if (row.status === 'assigning') {
      if (row.job_id) {
        const job = getJob(db, row.job_id);
        if (job?.status === 'canceled') {
          cancelAssigningPlanForCanceledJob(db, row);
          continue;
        }
        if (job?.status === 'failed') {
          expireAssigningPlan(db, row);
          row.status = 'error';
          row.phase = null;
          blocking = row;
          break;
        }
      }
      const createdMs = Date.parse(row.created_at);
      const age = Number.isFinite(createdMs) ? Date.now() - createdMs : Infinity;
      if (age > PLAN_TIMEOUT_MS) {
        expireAssigningPlan(db, row);
        continue;
      }
    }
    blocking = row;
    break;
  }

  return blocking ? toBlockingPlan(blocking) : null;
}

function ensureNoBlockingOrganizePlan(db: Db, excludePlanId?: string | null): void {
  const blocking = getBlockingOrganizePlan(db, excludePlanId);
  if (!blocking) return;

  throw new PlanError(409, getBlockingPlanMessage(blocking), {
    activePlanId: blocking.status === 'assigning' ? blocking.id : undefined,
    blockingPlanId: blocking.id,
    blockingPlanStatus: blocking.status,
    blockingJobId: blocking.job_id,
  });
}

export function ensureNoBlockingPlanForNewRun(db: Db, excludePlanId?: string | null): void {
  ensureNoBlockingOrganizePlan(db, excludePlanId);
}

export function isBlockingPlanStatus(status: string | null | undefined): status is PlanStatus {
  return status === 'assigning' || status === 'preview' || status === 'failed' || status === 'error';
}

export function buildPlanSourceSnapshot(
  db: Db,
  plan: Pick<PlanRow, 'scope' | 'target_tree' | 'assignments' | 'source_snapshot'>,
  assignmentsInput?: Assignment[],
): PlanSourceSnapshot {
  const assignments = assignmentsInput ?? parseAssignments(plan.assignments);
  const bookmarkIds = [...new Set(assignments.map(item => item.bookmark_id).filter(id => Number.isInteger(id) && id > 0))];
  const bookmarkStates = getBookmarkStates(db, bookmarkIds);
  const bookmarkSnapshots = bookmarkIds.map(bookmarkId => {
    const state = bookmarkStates.get(bookmarkId);
    return {
      bookmark_id: bookmarkId,
      category_id: state?.category_id ?? null,
      updated_at: state?.updated_at ?? null,
    };
  });

  const liveTargetCategories: PlanLiveTargetSnapshot[] = [];
  const lookup = buildPathLookup(db);
  for (const path of collectTargetPaths(plan, assignments)) {
    const existing = lookup.get(casefold(path));
    if (existing) liveTargetCategories.push({ path: existing.path, category_id: existing.id });
  }

  const existingSnapshot = parseSourceSnapshot(plan.source_snapshot ?? null);
  const scopeBookmarkIds = existingSnapshot?.scope_frozen
    ? existingSnapshot.scope_bookmark_ids
    : (bookmarkIds.length > 0 ? bookmarkIds : resolveScopeBookmarkIds(db, plan.scope));

  return {
    bookmark_states: bookmarkSnapshots,
    live_target_categories: liveTargetCategories,
    scope_bookmark_ids: scopeBookmarkIds,
    scope_frozen: true,
  };
}

export function getPlanScopeBookmarkIds(db: Db, plan: Pick<PlanRow, 'scope' | 'source_snapshot'>): number[] {
  const snapshot = parseSourceSnapshot(plan.source_snapshot ?? null);
  if (snapshot?.scope_frozen) return snapshot.scope_bookmark_ids;
  return resolveScopeBookmarkIds(db, plan.scope);
}

export function ensurePlanScopeSnapshot(db: Db, planId: string): PlanRow {
  const plan = getPlan(db, planId);
  if (!plan) throw new PlanError(404, 'plan not found');

  const existingSnapshot = parseSourceSnapshot(plan.source_snapshot ?? null);
  if (existingSnapshot?.scope_frozen) return plan;

  const sourceSnapshot: PlanSourceSnapshot = {
    bookmark_states: existingSnapshot?.bookmark_states ?? [],
    live_target_categories: existingSnapshot?.live_target_categories ?? [],
    scope_bookmark_ids: resolveScopeBookmarkIds(db, plan.scope),
    scope_frozen: true,
  };
  return updatePlan(db, planId, { source_snapshot: JSON.stringify(sourceSnapshot) });
}

function buildFreshAssigningSourceSnapshot(db: Db, plan: Pick<PlanRow, 'scope' | 'source_snapshot'>): PlanSourceSnapshot {
  const existingSnapshot = parseSourceSnapshot(plan.source_snapshot ?? null);
  return {
    bookmark_states: [],
    live_target_categories: [],
    scope_bookmark_ids: existingSnapshot?.scope_frozen
      ? existingSnapshot.scope_bookmark_ids
      : resolveScopeBookmarkIds(db, plan.scope),
    scope_frozen: true,
  };
}

function requireSourceSnapshot(plan: PlanRow): PlanSourceSnapshot {
  const snapshot = parseSourceSnapshot(plan.source_snapshot);
  if (!snapshot) throw new PlanError(409, 'plan safety snapshot missing; rerun organize', { discardRecommended: true });
  return snapshot;
}

function ensureLiveTargetsAvailable(db: Db, plan: PlanRow, assignments: Assignment[]): PathLookup {
  const lookup = buildPathLookup(db);
  const snapshotTargets = buildSnapshotTargetMap(parseSourceSnapshot(plan.source_snapshot));

  for (const assignment of assignments) {
    if (!canApplyAssignment(assignment)) continue;
    const path = normalizePath(assignment.category_path);
    const key = casefold(path);
    const current = lookup.get(key);
    const snapshotted = snapshotTargets.get(key);
    if (!current || !snapshotted || current.id !== snapshotted.category_id) {
      throw new PlanError(409, 'plan is stale: target categories changed', { discardRecommended: true });
    }
  }
  return lookup;
}

type ApplyValidationContext = {
  snapshot: PlanSourceSnapshot;
  currentStates: Map<number, BookmarkStateRow>;
};

type OverlappingPlanConflict = {
  newer_plan_id: string;
  newer_plan_status: PlanStatus;
  newer_plan_created_at: string;
};

function sameAssignmentIntent(left: Assignment | undefined, right: Assignment): boolean {
  if (!left) return false;
  return left.status === right.status && normalizePath(left.category_path) === normalizePath(right.category_path);
}

function canApplyAssignment(assignment: Assignment): boolean {
  return assignment.status === 'assigned' && !!normalizePath(assignment.category_path);
}

export function getAssignmentApplicability(
  db: Db,
  plan: Pick<PlanRow, 'source_snapshot'>,
  assignment: Assignment,
): AssignmentApplicability {
  if (!canApplyAssignment(assignment)) {
    return {
      can_apply: false,
      invalid_reason: 'needs_review',
      invalid_message: '未匹配到分类，无法应用',
    };
  }

  const path = normalizePath(assignment.category_path);
  const key = casefold(path);
  const current = buildPathLookup(db).get(key);
  if (!current) {
    return {
      can_apply: false,
      invalid_reason: 'target_category_missing',
      invalid_message: '分类已失效，无法应用',
    };
  }

  const snapshot = parseSourceSnapshot(plan.source_snapshot ?? null);
  if (!snapshot) {
    return {
      can_apply: false,
      invalid_reason: 'snapshot_missing',
      invalid_message: '计划安全快照缺失，无法应用',
    };
  }

  const snapshotted = buildSnapshotTargetMap(snapshot).get(key);
  if (!snapshotted || snapshotted.category_id !== current.id) {
    return {
      can_apply: false,
      invalid_reason: 'target_category_changed',
      invalid_message: '分类已失效，无法应用',
    };
  }

  return {
    can_apply: true,
    invalid_reason: null,
    invalid_message: null,
    target_category_id: current.id,
  };
}

function getDefaultBookmarkDecision(assignment: Assignment): BookmarkDecisionAction {
  return canApplyAssignment(assignment) ? 'apply' : 'discard';
}

function parseBookmarkDecisions(raw: unknown): BookmarkApplyDecision[] {
  if (!Array.isArray(raw)) return [];
  const map = new Map<number, BookmarkDecisionAction>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const bookmarkId = Number(row.bookmark_id);
    const action = row.action === 'apply' || row.action === 'discard' ? row.action : null;
    if (!Number.isInteger(bookmarkId) || bookmarkId <= 0 || !action) continue;
    map.set(bookmarkId, action);
  }
  return [...map.entries()].map(([bookmark_id, action]) => ({ bookmark_id, action }));
}

function resolveBookmarkDecisionMap(assignments: Assignment[], decisionsInput?: unknown): Map<number, BookmarkDecisionAction> {
  const explicit = new Map(parseBookmarkDecisions(decisionsInput).map(item => [item.bookmark_id, item.action]));
  const decisions = new Map<number, BookmarkDecisionAction>();
  for (const assignment of assignments) {
    const explicitAction = explicit.get(assignment.bookmark_id);
    const defaultAction = getDefaultBookmarkDecision(assignment);
    if (explicitAction === 'apply' && !canApplyAssignment(assignment)) {
      decisions.set(assignment.bookmark_id, 'discard');
      continue;
    }
    decisions.set(assignment.bookmark_id, explicitAction ?? defaultAction);
  }
  return decisions;
}

function selectAssignmentsForApply(assignments: Assignment[], decisionsInput?: unknown): Assignment[] {
  const decisions = resolveBookmarkDecisionMap(assignments, decisionsInput);
  return assignments.filter(assignment => decisions.get(assignment.bookmark_id) === 'apply' && canApplyAssignment(assignment));
}

function selectApplicableAssignmentsForApply(
  db: Db,
  plan: Pick<PlanRow, 'source_snapshot'>,
  assignments: Assignment[],
  decisionsInput?: unknown,
): Assignment[] {
  return selectAssignmentsForApply(assignments, decisionsInput)
    .filter(assignment => getAssignmentApplicability(db, plan, assignment).can_apply);
}

function findNewerOverlappingPlanConflicts(
  db: Db,
  plan: PlanRow,
  assignmentMap: Map<number, Assignment>,
): Map<number, OverlappingPlanConflict> {
  if (!assignmentMap.size) return new Map();
  const bookmarkIdSet = new Set(assignmentMap.keys());
  const rows = db.prepare(`
    SELECT id, status, created_at, assignments
    FROM ai_organize_plans
    WHERE id <> ?
      AND created_at > ?
      AND status IN ('preview', 'applied')
    ORDER BY created_at DESC
  `).all(plan.id, plan.created_at) as Array<Pick<PlanRow, 'id' | 'status' | 'created_at' | 'assignments'>>;

  const conflicts = new Map<number, OverlappingPlanConflict>();
  for (const row of rows) {
    const assignments = parseAssignments(row.assignments);
    for (const item of assignments) {
      if (!bookmarkIdSet.has(item.bookmark_id)) continue;
      if (sameAssignmentIntent(assignmentMap.get(item.bookmark_id), item)) continue;
      if (conflicts.has(item.bookmark_id)) continue;
      conflicts.set(item.bookmark_id, {
        newer_plan_id: row.id,
        newer_plan_status: row.status,
        newer_plan_created_at: row.created_at,
      });
    }
  }
  return conflicts;
}

function validatePlanApplySafety(db: Db, plan: PlanRow, assignments: Assignment[]): ApplyValidationContext {
  const snapshot = requireSourceSnapshot(plan);
  const selectedIds = new Set(assignments.map(item => item.bookmark_id));
  const selectedSnapshotStates = snapshot.bookmark_states.filter(item => selectedIds.has(item.bookmark_id));
  const currentStates = getBookmarkStates(db, selectedSnapshotStates.map(item => item.bookmark_id));

  if (currentStates.size !== selectedSnapshotStates.length) {
    throw new PlanError(409, 'plan is stale: bookmarks changed', { discardRecommended: true });
  }

  for (const item of selectedSnapshotStates) {
    const current = currentStates.get(item.bookmark_id);
    if (!current) throw new PlanError(409, 'plan is stale: bookmarks changed', { discardRecommended: true });
  }

  ensureLiveTargetsAvailable(db, plan, assignments);
  return {
    snapshot: {
      ...snapshot,
      bookmark_states: selectedSnapshotStates,
    },
    currentStates,
  };
}

function buildConflictItem(
  bm: BookmarkRow,
  reason: ConflictItem['reason'],
  extras: Partial<ConflictItem> = {},
): ConflictItem {
  return {
    bookmark_id: bm.id,
    title: bm.title,
    url: bm.url,
    updated_at: bm.updated_at,
    reason,
    current_category: bm.category_path ? normalizePath(bm.category_path) : null,
    newer_plan_id: null,
    newer_plan_status: null,
    newer_plan_created_at: null,
    ...extras,
  };
}

function collectSoftApplyConflicts(
  db: Db,
  plan: PlanRow,
  assignments: Assignment[],
  validation: ApplyValidationContext,
  bookmarks: Map<number, BookmarkRow>,
): Map<number, ConflictItem> {
  const assignmentMap = new Map(assignments.map(item => [item.bookmark_id, item]));
  const conflicts = new Map<number, ConflictItem>();
  const overlapConflicts = findNewerOverlappingPlanConflicts(db, plan, assignmentMap);

  for (const [bookmarkId, overlap] of overlapConflicts) {
    const bm = bookmarks.get(bookmarkId);
    if (!bm) continue;
    conflicts.set(bookmarkId, buildConflictItem(bm, 'overlapping_plan', overlap));
  }

  for (const item of validation.snapshot.bookmark_states) {
    const assignment = assignmentMap.get(item.bookmark_id);
    if (!assignment) continue;
    const current = validation.currentStates.get(item.bookmark_id);
    const bm = bookmarks.get(item.bookmark_id);
    if (!current || !bm) continue;

    const currentPath = bm.category_path ? normalizePath(bm.category_path) : null;
    const targetPath = assignment.status === 'assigned' ? normalizePath(assignment.category_path) : null;

    if (targetPath && currentPath && casefold(currentPath) === casefold(targetPath)) continue;
    if (assignment.status === 'needs_review' && current.category_id == null) continue;

    if ((current.category_id ?? null) !== (item.category_id ?? null)) {
      if (!conflicts.has(item.bookmark_id)) conflicts.set(item.bookmark_id, buildConflictItem(bm, 'bookmark_changed'));
      continue;
    }

    if (current.updated_at && Date.parse(current.updated_at) > Date.parse(plan.created_at)) {
      if (!conflicts.has(item.bookmark_id)) conflicts.set(item.bookmark_id, buildConflictItem(bm, 'bookmark_updated'));
    }
  }

  return conflicts;
}

function computeProjectedEmptyCategories(
  db: Db,
  assignments: Assignment[],
  lookup: PathLookup,
  bookmarks: Map<number, BookmarkRow>,
  conflicts: Map<number, ConflictItem>,
): { id: number; name: string }[] {
  const usage = getCatUsage(db);
  const counts = new Map(usage.map(u => [u.id, u.bookmark_count]));

  for (const assignment of assignments) {
    if (conflicts.has(assignment.bookmark_id)) continue;
    const bookmark = bookmarks.get(assignment.bookmark_id);
    if (!bookmark) throw new PlanError(409, 'plan is stale: bookmarks changed', { discardRecommended: true });

    const targetPath = normalizePath(assignment.category_path);
    if (!targetPath) continue;
    const targetId = getExistingCategoryId(targetPath, lookup);
    if (bookmark.category_id === targetId) continue;

    if (bookmark.category_id != null) {
      counts.set(bookmark.category_id, Math.max(0, (counts.get(bookmark.category_id) ?? 0) - 1));
    }
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }

  return usage
    .filter(u => u.bookmark_count > 0 && (counts.get(u.id) ?? 0) === 0 && u.has_children === 0)
    .map(u => ({ id: u.id, name: u.name }));
}

// ==================== CRUD ====================

export function createPlan(db: Db, scope: string): PlanRow {
  return db.transaction(() => {
    cleanupExpiredSnapshots(db);
    ensureNoBlockingOrganizePlan(db);
    const normalizedScope = scope.trim() || 'all';

    const id = randomUUID();
    const now = nowIso();
    const initialTargetTree = buildInitialTargetTree(db);
    const initialSourceSnapshot: PlanSourceSnapshot = {
      bookmark_states: [],
      live_target_categories: [],
      scope_bookmark_ids: resolveScopeBookmarkIds(db, normalizedScope),
      scope_frozen: true,
    };
    db.prepare(`INSERT INTO ai_organize_plans (id, status, scope, phase, batches_done, batches_total, needs_review_count, created_at)
      VALUES (?, 'assigning', ?, 'assigning', 0, 0, 0, ?)`).run(id, normalizedScope, now);
    updatePlan(db, id, {
      target_tree: JSON.stringify(initialTargetTree),
      source_snapshot: JSON.stringify(initialSourceSnapshot),
    });
    logStateChange(db, id, null, 'assigning', 'plan_created');

    // cleanup: keep 5 most recent non-applied
    const stale = db.prepare(`SELECT id FROM ai_organize_plans WHERE status <> 'applied' ORDER BY created_at DESC LIMIT -1 OFFSET 5`).all() as { id: string }[];
    if (stale.length) {
      const ids = stale.map(r => r.id);
      db.prepare(`DELETE FROM ai_organize_plans WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }

    return getPlan(db, id)!;
  })();
}

export function getPlan(db: Db, planId: string): PlanRow | null {
  return (db.prepare('SELECT * FROM ai_organize_plans WHERE id = ?').get(planId) as PlanRow | undefined) ?? null;
}

export function updatePlan(db: Db, planId: string, patch: Partial<Omit<PlanRow, 'id' | 'created_at'>>): PlanRow {
  const jsonCols = new Set(['target_tree', 'assignments', 'diff_summary', 'backup_snapshot', 'source_snapshot', 'failed_batch_ids']);
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return getPlan(db, planId)!;

  const sets = entries.map(([k]) => `${k} = ?`);
  const vals = entries.map(([k, v]) => jsonCols.has(k) && v !== null && typeof v !== 'string' ? JSON.stringify(v) : v);
  vals.push(planId);
  db.prepare(`UPDATE ai_organize_plans SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getPlan(db, planId)!;
}

export function deletePlan(db: Db, planId: string): boolean {
  return db.prepare('DELETE FROM ai_organize_plans WHERE id = ?').run(planId).changes > 0;
}

// ==================== State Machine ====================

export function transitionStatus(db: Db, planId: string, target: PlanStatus, reason?: string): PlanRow {
  return db.transaction(() => {
    const plan = getPlan(db, planId);
    if (!plan) throw new PlanError(404, 'plan not found');

    // terminal no-op (except applied→rolled_back)
    if (IMMUTABLE_TERMINAL_STATUSES.has(plan.status) && !(plan.status === 'applied' && target === 'rolled_back')) return plan;
    if (plan.status === target) return plan;
    if (!canTransition(plan.status, target)) throw new PlanError(409, `invalid transition: ${plan.status} → ${target}`);

    const patch: Partial<PlanRow> = { status: target };
    if (target === 'assigning') {
      const planWithScope = ensurePlanScopeSnapshot(db, planId);
      ensureNoBlockingOrganizePlan(db, planId);
      const job = createJob(db, 'ai_organize', `AI organize plan ${planId}`, 0);
      patch.job_id = job.id;
      patch.phase = 'assigning';
      patch.assignments = null;
      patch.diff_summary = null;
      patch.backup_snapshot = null;
      patch.source_snapshot = JSON.stringify(buildFreshAssigningSourceSnapshot(db, planWithScope));
      patch.batches_done = 0;
      patch.batches_total = 0;
      patch.failed_batch_ids = null;
      patch.needs_review_count = 0;
      patch.applied_at = null;
    } else if (target === 'preview') {
      patch.phase = 'preview';
    } else if (target === 'applied') {
      patch.phase = null; patch.applied_at = nowIso();
    } else {
      patch.phase = null;
    }

    const next = updatePlan(db, planId, patch);
    logStateChange(db, planId, plan.status, target, reason ?? DEFAULT_REASONS[target] ?? target);

    // sync job status
    if (next.job_id) {
      const job = getJob(db, next.job_id);
      if (job) {
        const jobIsActive = job.status === 'queued' || job.status === 'running';
        const shouldCancelJob = target === 'canceled' && (jobIsActive || (plan.status === 'preview' && job.status === 'done'));
        if (shouldCancelJob) { jobQueue.cancelJob(next.job_id); updateJob(db, next.job_id, { status: 'canceled', message: 'plan canceled' }); }
        else if (jobIsActive) {
          if (target === 'failed' || target === 'error') updateJob(db, next.job_id, { status: 'failed', message: 'plan failed' });
          else if (target === 'preview' || target === 'applied') updateJob(db, next.job_id, { status: 'done', message: 'plan done' });
        }
      }
    }
    return next;
  })();
}

export function getActivePlan(db: Db): PlanRow | null {
  const blocking = getBlockingOrganizePlan(db);
  if (!blocking || blocking.status !== 'assigning') return null;
  return getPlan(db, blocking.id);
}

// ==================== Tree Validation ====================

export function validateTree(tree: CategoryNode[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(tree)) return { valid: false, errors: ['tree must be an array'] };
  if (tree.length < 3 || tree.length > 20) errors.push('top-level count must be 3-20');

  let total = 0;
  const topNames = new Set<string>();

  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (!node || typeof node !== 'object') { errors.push(`node #${i + 1} invalid`); continue; }
    node.name = (typeof node.name === 'string' ? node.name : '').trim();
    if (!node.name) errors.push(`node #${i + 1} name empty`);
    if (node.name.length > 50) errors.push(`node #${i + 1} name > 50 chars`);
    total++;

    const key = casefold(node.name);
    if (topNames.has(key)) errors.push(`duplicate top-level: ${node.name}`);
    else topNames.add(key);

    const children = Array.isArray(node.children) ? node.children : [];
    node.children = children;
    const childNames = new Set<string>();
    for (let j = 0; j < children.length; j++) {
      const child = children[j] as { name: string; children?: unknown[] };
      if (!child || typeof child !== 'object') { errors.push(`child #${i + 1}.${j + 1} invalid`); continue; }
      child.name = (typeof child.name === 'string' ? child.name : '').trim();
      if (!child.name) errors.push(`child #${i + 1}.${j + 1} name empty`);
      if (child.name.length > 50) errors.push(`child #${i + 1}.${j + 1} name > 50 chars`);
      total++;
      const ck = casefold(child.name);
      if (childNames.has(ck)) errors.push(`duplicate child under "${node.name}": ${child.name}`);
      else childNames.add(ck);
      if (Array.isArray(child.children) && child.children.length > 0) errors.push(`depth > 2: ${node.name}/${child.name}`);
    }
  }
  if (total > 200) errors.push('total categories > 200');
  return { valid: errors.length === 0, errors };
}

// ==================== Diff ====================

export function computeDiff(db: Db, plan: PlanRow): DiffSummary {
  const assignments = parseAssignments(plan.assignments);
  const lookup = buildPathLookup(db);
  const bookmarks = getBookmarkMap(db);
  const moves: DiffSummary['moves'] = [];
  let needsReview = 0;

  for (const a of assignments) {
    if (a.status === 'needs_review') { needsReview++; continue; }
    if (!getAssignmentApplicability(db, plan, a).can_apply) { needsReview++; continue; }
    const tp = normalizePath(a.category_path);
    if (!tp) { needsReview++; continue; }
    const bm = bookmarks.get(a.bookmark_id);
    if (!bm) continue;
    const from = bm.category_path ? normalizePath(bm.category_path) : null;
    if (from && casefold(from) === casefold(tp)) continue;
    moves.push({ bookmark_id: a.bookmark_id, from_category: from, to_category: tp });
  }

  const usage = getCatUsage(db);
  const counts = new Map(usage.map(u => [u.id, u.bookmark_count]));
  for (const m of moves) {
    if (m.from_category) { const f = lookup.get(casefold(m.from_category)); if (f) counts.set(f.id, Math.max(0, (counts.get(f.id) ?? 0) - 1)); }
    const t = lookup.get(casefold(m.to_category)); if (t) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
  }
  const emptyCategories = usage
    .filter(u => u.bookmark_count > 0 && (counts.get(u.id) ?? 0) === 0 && u.has_children === 0)
    .map(u => ({ id: u.id, name: u.name }));

  return {
    empty_categories: emptyCategories, moves,
    summary: { move_count: moves.length, empty_count: emptyCategories.length, needs_review: needsReview },
  };
}

// ==================== Backup & Apply ====================

export function createBackupSnapshot(db: Db): string {
  const categories = db.prepare('SELECT id, name, parent_id, icon, color, sort_order, created_at FROM categories ORDER BY id').all();
  const bookmark_categories = db.prepare('SELECT id AS bookmark_id, category_id FROM bookmarks ORDER BY id').all();
  return JSON.stringify({ categories, bookmark_categories });
}

export function applyPlan(db: Db, planId: string, decisionsInput?: unknown): ApplyResult {
  return db.transaction(() => {
    const plan = getPlan(db, planId);
    if (!plan || plan.status !== 'preview') throw new Error('plan can only be applied in preview status');
    const assignments = parseAssignments(plan.assignments);
    const selectedAssignments = selectApplicableAssignmentsForApply(db, plan, assignments, decisionsInput);
    if (selectedAssignments.length === 0) return { conflicts: [], empty_categories: [], applied_count: 0 };
    const validation = validatePlanApplySafety(db, plan, selectedAssignments);

    const lookup = ensureLiveTargetsAvailable(db, plan, selectedAssignments);

    const bookmarks = getBookmarkMap(db);
    const softConflicts = collectSoftApplyConflicts(db, plan, selectedAssignments, validation, bookmarks);
    const projectedEmptyCategories = computeProjectedEmptyCategories(db, selectedAssignments, lookup, bookmarks, softConflicts);
    if (softConflicts.size > 0 || projectedEmptyCategories.length > 0) {
      return {
        conflicts: [...softConflicts.values()],
        empty_categories: projectedEmptyCategories,
        applied_count: 0,
      };
    }

    // Snapshot BEFORE any mutations. This is only reached once the apply can finish
    // without extra confirmation; confirmation flows apply later via resolveAndApply().
    if (!plan.backup_snapshot) updatePlan(db, planId, { backup_snapshot: createBackupSnapshot(db) });

    const moveStmt = db.prepare('UPDATE bookmarks SET category_id = ?, updated_at = ? WHERE id = ?');
    let applied = 0;
    const now = nowIso();

    const sourceCatIds = new Set<number>();

    for (const a of selectedAssignments) {
      const bm = bookmarks.get(a.bookmark_id);
      if (!bm) throw new PlanError(409, 'plan is stale: bookmarks changed', { discardRecommended: true });

      const tp = normalizePath(a.category_path);
      if (!tp) continue;
      const from = bm.category_path ? normalizePath(bm.category_path) : null;
      if (from && casefold(from) === casefold(tp)) continue;

      const catId = getExistingCategoryId(tp, lookup);
      if (bm.category_id === catId) continue;
      if (bm.category_id != null) sourceCatIds.add(bm.category_id);
      applied += moveStmt.run(catId, now, bm.id).changes;
    }

    let empty: { id: number; name: string }[] = [];
    if (sourceCatIds.size > 0) {
      const ph = [...sourceCatIds].map(() => '?').join(',');
      empty = db.prepare(`
        SELECT c.id,
          CASE WHEN p.id IS NOT NULL THEN p.name || '/' || c.name ELSE c.name END AS name
        FROM categories c
        LEFT JOIN categories p ON p.id = c.parent_id
        LEFT JOIN bookmarks b ON b.category_id = c.id
        WHERE c.id IN (${ph})
          AND NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id)
        GROUP BY c.id HAVING COUNT(b.id) = 0
      `).all(...sourceCatIds) as { id: number; name: string }[];
    }

    return { conflicts: [], empty_categories: empty, applied_count: applied };
  })();
}

export function resolveAndApply(db: Db, planId: string, decisions: ResolveDecisions): ApplyResult {
  return db.transaction(() => {
    const plan = getPlan(db, planId);
    if (!plan || plan.status !== 'preview') throw new Error('plan can only be resolved in preview status');
    const assignments = parseAssignments(plan.assignments);
    const selectedAssignments = selectApplicableAssignmentsForApply(db, plan, assignments, decisions.decisions);
    if (selectedAssignments.length === 0) {
      transitionStatus(db, planId, 'applied');
      return { conflicts: [], empty_categories: [], applied_count: 0 };
    }
    const validation = validatePlanApplySafety(db, plan, selectedAssignments);

    if (!plan.backup_snapshot) updatePlan(db, planId, { backup_snapshot: createBackupSnapshot(db) });

    const conflictMap = new Map((decisions.conflicts ?? []).map(c => [c.bookmark_id, c.action]));
    const emptyMap = new Map((decisions.empty_categories ?? []).map(e => [e.id, e.action]));
    const lookup = ensureLiveTargetsAvailable(db, plan, selectedAssignments);

    const bookmarks = getBookmarkMap(db);
    const softConflicts = collectSoftApplyConflicts(db, plan, selectedAssignments, validation, bookmarks);
    const moveStmt = db.prepare('UPDATE bookmarks SET category_id = ?, updated_at = ? WHERE id = ?');
    const sourceCatIds = new Set<number>();
    let applied = 0;
    const now = nowIso();

    for (const a of selectedAssignments) {
      const bm = bookmarks.get(a.bookmark_id);
      if (!bm) throw new PlanError(409, 'plan is stale: bookmarks changed', { discardRecommended: true });

      const conflict = softConflicts.get(a.bookmark_id);
      if (conflict) {
        const action = conflictMap.get(a.bookmark_id);
        if (!action) throw new PlanError(409, 'plan conflicts changed; rerun apply');
        if (action !== 'override') continue;
      }

      const tp = normalizePath(a.category_path);
      if (!tp) continue;
      const from = bm.category_path ? normalizePath(bm.category_path) : null;
      if (from && casefold(from) === casefold(tp)) continue;

      const catId = getExistingCategoryId(tp, lookup);
      if (bm.category_id === catId) continue;
      if (bm.category_id != null) sourceCatIds.add(bm.category_id);
      applied += moveStmt.run(catId, now, bm.id).changes;
    }

    // delete empty categories per user decision
    const currentEmpty = db.prepare(`
      SELECT c.id,
        CASE WHEN p.id IS NOT NULL THEN p.name || '/' || c.name ELSE c.name END AS name
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      LEFT JOIN bookmarks b ON b.category_id = c.id
      WHERE NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id)
      GROUP BY c.id HAVING COUNT(b.id) = 0
    `).all() as { id: number; name: string }[];
    const currentEmptyIds = new Set(currentEmpty.map(item => item.id));
    const delStmt = db.prepare('DELETE FROM categories WHERE id = ?');
    for (const [id, action] of emptyMap) {
      if (action === 'delete' && currentEmptyIds.has(id)) delStmt.run(id);
    }

    transitionStatus(db, planId, 'applied');

    let remaining: { id: number; name: string }[] = [];
    if (sourceCatIds.size > 0) {
      const ph = [...sourceCatIds].map(() => '?').join(',');
      remaining = db.prepare(`
        SELECT c.id,
          CASE WHEN p.id IS NOT NULL THEN p.name || '/' || c.name ELSE c.name END AS name
        FROM categories c
        LEFT JOIN categories p ON p.id = c.parent_id
        LEFT JOIN bookmarks b ON b.category_id = c.id
        WHERE c.id IN (${ph})
          AND NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id)
        GROUP BY c.id HAVING COUNT(b.id) = 0
      `).all(...sourceCatIds) as { id: number; name: string }[];
    }

    return { conflicts: [], empty_categories: remaining, applied_count: applied };
  })();
}

// ==================== Rollback ====================

export function rollbackPlan(db: Db, planId: string): RollbackResult {
  const plan = getPlan(db, planId);
  if (!plan) throw new Error('plan not found');
  if (plan.status === 'rolled_back') return { restored_categories: 0, restored_bookmarks: 0 };
  if (plan.status !== 'applied') throw new Error('only applied plans can be rolled back');

  const appliedMs = Date.parse(plan.applied_at ?? '');
  if (!Number.isFinite(appliedMs) || Date.now() - appliedMs > SNAPSHOT_TTL_MS || !plan.backup_snapshot) {
    throw new PlanError(403, 'rollback window expired');
  }

  const snapshot = safeJson<{ categories?: unknown[]; bookmark_categories?: unknown[] }>(plan.backup_snapshot, {});
  if (!Array.isArray(snapshot.categories) || !Array.isArray(snapshot.bookmark_categories)) {
    throw new PlanError(403, 'rollback snapshot corrupted');
  }

  return db.transaction(() => {
    db.prepare('DELETE FROM categories').run();
    const ins = db.prepare('INSERT INTO categories (id, name, parent_id, icon, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    // insert parents first
    const sorted = [...snapshot.categories!].sort((a: any, b: any) => (a.parent_id === null ? 0 : 1) - (b.parent_id === null ? 0 : 1) || a.id - b.id);
    for (const c of sorted as any[]) ins.run(c.id, c.name, c.parent_id, c.icon ?? null, c.color ?? null, c.sort_order ?? 0, c.created_at);

    const validIds = new Set(sorted.map((c: any) => c.id));
    const upd = db.prepare('UPDATE bookmarks SET category_id = ?, updated_at = ? WHERE id = ?');
    const now = nowIso();
    let restored = 0;
    for (const m of snapshot.bookmark_categories! as any[]) {
      const catId = m.category_id !== null && validIds.has(m.category_id) ? m.category_id : null;
      restored += upd.run(catId, now, m.bookmark_id).changes;
    }

    transitionStatus(db, planId, 'rolled_back');
    return { restored_categories: sorted.length, restored_bookmarks: restored };
  })();
}

// ==================== Snapshot Cleanup ====================

export function cleanupExpiredSnapshots(db: Db): number {
  const rows = db.prepare(`SELECT id, applied_at FROM ai_organize_plans WHERE backup_snapshot IS NOT NULL AND applied_at IS NOT NULL`).all() as { id: string; applied_at: string }[];
  const clear = db.prepare('UPDATE ai_organize_plans SET backup_snapshot = NULL WHERE id = ?');
  let count = 0;
  for (const r of rows) {
    const ms = Date.parse(r.applied_at);
    if (Number.isFinite(ms) && Date.now() - ms > SNAPSHOT_TTL_MS) count += clear.run(r.id).changes;
  }
  return count;
}

// ==================== Startup Recovery ====================

export function recoverStalePlans(db: Db): number {
  const stale = db.prepare(`SELECT * FROM ai_organize_plans WHERE status = 'assigning'`).all() as PlanRow[];
  for (const plan of stale) {
    const job = plan.job_id ? getJob(db, plan.job_id) : null;
    if (job?.status === 'canceled') {
      updatePlan(db, plan.id, { status: 'canceled' as PlanStatus, phase: null });
      logStateChange(db, plan.id, plan.status, 'canceled', 'job_canceled');
      continue;
    }

    updatePlan(db, plan.id, { status: 'error' as PlanStatus, phase: null });
    logStateChange(db, plan.id, plan.status, 'error', 'server_restart');
    if (plan.job_id && job) {
      if (job.status === 'queued' || job.status === 'running') {
        updateJob(db, plan.job_id, { status: 'failed', message: 'server restart' });
      }
    }
  }
  return stale.length;
}

// ==================== Confirm Empty ====================

export function confirmEmpty(db: Db, planId: string, decisions: { id: number; action: 'delete' | 'keep' }[]): { deleted: number; kept: number } {
  return db.transaction(() => {
    const plan = getPlan(db, planId);
    if (!plan || plan.status !== 'preview') throw new Error('plan must be in preview status');

    const assignments = parseAssignments(plan.assignments);
    const selectedAssignments = selectApplicableAssignmentsForApply(db, plan, assignments);
    const validation = validatePlanApplySafety(db, plan, selectedAssignments);
    const lookup = ensureLiveTargetsAvailable(db, plan, selectedAssignments);
    const bookmarks = getBookmarkMap(db);
    const softConflicts = collectSoftApplyConflicts(db, plan, selectedAssignments, validation, bookmarks);
    if (softConflicts.size > 0) {
      throw new PlanError(409, 'plan conflicts changed; rerun apply');
    }

    if (!plan.backup_snapshot) updatePlan(db, planId, { backup_snapshot: createBackupSnapshot(db) });

    const moveStmt = db.prepare('UPDATE bookmarks SET category_id = ?, updated_at = ? WHERE id = ?');
    const now = nowIso();
    for (const assignment of selectedAssignments) {
      const bookmark = bookmarks.get(assignment.bookmark_id);
      if (!bookmark) throw new PlanError(409, 'plan is stale: bookmarks changed', { discardRecommended: true });
      const targetPath = normalizePath(assignment.category_path);
      if (!targetPath) continue;
      const targetId = getExistingCategoryId(targetPath, lookup);
      if (bookmark.category_id !== targetId) moveStmt.run(targetId, now, bookmark.id);
    }

    const decisionMap = new Map(decisions.map(d => [d.id, d.action]));

    // re-verify which categories are actually still empty leaf nodes
    const currentEmpty = db.prepare(`
      SELECT c.id,
        CASE WHEN p.id IS NOT NULL THEN p.name || '/' || c.name ELSE c.name END AS name
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      LEFT JOIN bookmarks b ON b.category_id = c.id
      WHERE NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id)
      GROUP BY c.id HAVING COUNT(b.id) = 0
    `).all() as { id: number; name: string }[];
    const emptyIds = new Set(currentEmpty.map(c => c.id));

    const delStmt = db.prepare('DELETE FROM categories WHERE id = ?');
    let deleted = 0;
    let kept = 0;

    for (const c of currentEmpty) {
      const action = decisionMap.get(c.id) ?? 'keep';
      if (action === 'delete' && emptyIds.has(c.id)) {
        delStmt.run(c.id);
        deleted++;
      } else {
        kept++;
      }
    }

    transitionStatus(db, planId, 'applied');
    return { deleted, kept };
  })();
}
