import { randomUUID } from 'crypto';
import type { Db } from './db';
import { getOrCreateCategoryByPath, getCategoryTree, getCategoryById, getCategoryByName } from './category-service';
import { createJob, updateJob, getJob, jobQueue } from './jobs';

// ==================== Types ====================

export type PlanStatus = 'designing' | 'assigning' | 'preview' | 'applied' | 'canceled' | 'rolled_back' | 'failed' | 'error';

export interface PlanRow {
  id: string; job_id: string | null; status: PlanStatus; scope: string;
  target_tree: string | null; assignments: string | null; diff_summary: string | null;
  backup_snapshot: string | null; phase: string | null;
  batches_done: number; batches_total: number;
  failed_batch_ids: string | null; needs_review_count: number;
  created_at: string; applied_at: string | null;
}

export interface CategoryNode { name: string; children: { name: string }[] }
export interface Assignment { bookmark_id: number; category_path: string; status: 'assigned' | 'needs_review' }

export interface DiffSummary {
  new_categories: string[];
  empty_categories: { id: number; name: string }[];
  moves: { bookmark_id: number; from_category: string | null; to_category: string }[];
  summary: { new_count: number; move_count: number; empty_count: number; needs_review: number };
}

export interface ConflictItem { bookmark_id: number; title: string; url: string; updated_at: string }
export interface ApplyResult { conflicts: ConflictItem[]; empty_categories: { id: number; name: string }[]; applied_count: number }
export interface RollbackResult { restored_categories: number; restored_bookmarks: number }
export interface ResolveDecisions {
  conflicts?: { bookmark_id: number; action: 'override' | 'skip' }[];
  empty_categories?: { id: number; action: 'delete' | 'keep' }[];
}

export class PlanError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PlanError';
    this.statusCode = statusCode;
  }
}

// ==================== Constants ====================

const ACTIVE_STATUSES: PlanStatus[] = ['designing', 'assigning', 'preview'];
const TERMINAL_STATUSES = new Set<PlanStatus>(['applied', 'canceled', 'rolled_back', 'error']);
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

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

function resolveCategory(db: Db, rawPath: string, lookup: PathLookup): number {
  const p = normalizePath(rawPath);
  if (!p) throw new Error('invalid category path');
  const key = casefold(p);
  const existing = lookup.get(key);
  if (existing) return existing.id;
  const id = getOrCreateCategoryByPath(db, p);
  lookup.set(key, { id, path: p });
  return id;
}

type BookmarkRow = { id: number; title: string; url: string; category_id: number | null; category_name: string | null; updated_at: string | null };

function getBookmarkMap(db: Db): Map<number, BookmarkRow> {
  const rows = db.prepare(`
    SELECT b.id, b.title, b.url, b.category_id, b.updated_at, c.name AS category_name
    FROM bookmarks b LEFT JOIN categories c ON c.id = b.category_id
  `).all() as BookmarkRow[];
  return new Map(rows.map(r => [r.id, r]));
}

type CatUsage = { id: number; name: string; bookmark_count: number; has_children: number };

function getCatUsage(db: Db): CatUsage[] {
  return db.prepare(`
    SELECT c.id, c.name, COUNT(b.id) AS bookmark_count,
      CASE WHEN EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id) THEN 1 ELSE 0 END AS has_children
    FROM categories c LEFT JOIN bookmarks b ON b.category_id = c.id GROUP BY c.id
  `).all() as CatUsage[];
}

function collectTargetPaths(plan: PlanRow, assignments?: Assignment[]): string[] {
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

function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  if (from === to) return true;
  if (to === 'canceled' && !TERMINAL_STATUSES.has(from)) return true;
  const allowed: Record<string, PlanStatus[]> = {
    designing: ['assigning'],
    assigning: ['preview', 'failed', 'error'],
    preview: ['applied'],
    failed: ['assigning'],
    applied: ['rolled_back'],
  };
  return (allowed[from] ?? []).includes(to);
}

// ==================== CRUD ====================

export function createPlan(db: Db, scope: string): PlanRow {
  return db.transaction(() => {
    cleanupExpiredSnapshots(db);
    const ph = ACTIVE_STATUSES.map(() => '?').join(',');
    const active = db.prepare(`SELECT id FROM ai_organize_plans WHERE status IN (${ph}) LIMIT 1`).get(...ACTIVE_STATUSES);
    if (active) throw new PlanError(409, 'active plan already exists');

    const id = randomUUID();
    const now = nowIso();
    db.prepare(`INSERT INTO ai_organize_plans (id, status, scope, phase, batches_done, batches_total, needs_review_count, created_at)
      VALUES (?, 'designing', ?, 'designing', 0, 0, 0, ?)`).run(id, scope.trim() || 'all', now);

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
  const jsonCols = new Set(['target_tree', 'assignments', 'diff_summary', 'backup_snapshot', 'failed_batch_ids']);
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

export function transitionStatus(db: Db, planId: string, target: PlanStatus): PlanRow {
  return db.transaction(() => {
    const plan = getPlan(db, planId);
    if (!plan) throw new Error('plan not found');

    // terminal no-op (except applied→rolled_back)
    if (TERMINAL_STATUSES.has(plan.status) && !(plan.status === 'applied' && target === 'rolled_back')) return plan;
    if (plan.status === target) return plan;
    if (!canTransition(plan.status, target)) throw new Error(`invalid transition: ${plan.status} → ${target}`);

    const patch: Partial<PlanRow> = { status: target };
    if (target === 'assigning') {
      const job = createJob(db, 'ai_organize', `AI organize plan ${planId}`, 0);
      patch.job_id = job.id;
      patch.phase = 'assigning';
    } else if (target === 'preview') {
      patch.phase = 'preview';
    } else if (target === 'applied') {
      patch.phase = null; patch.applied_at = nowIso();
    } else {
      patch.phase = null;
    }

    const next = updatePlan(db, planId, patch);

    // sync job status
    if (next.job_id) {
      const job = getJob(db, next.job_id);
      if (job && (job.status === 'queued' || job.status === 'running')) {
        if (target === 'canceled') { jobQueue.cancelJob(next.job_id); updateJob(db, next.job_id, { status: 'canceled', message: 'plan canceled' }); }
        else if (target === 'failed' || target === 'error') updateJob(db, next.job_id, { status: 'failed', message: 'plan failed' });
        else if (target === 'preview' || target === 'applied') updateJob(db, next.job_id, { status: 'done', message: 'plan done' });
      }
    }
    return next;
  })();
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

export function updatePlanTree(db: Db, planId: string, tree: CategoryNode[], confirm = false): PlanRow {
  return db.transaction(() => {
    const plan = getPlan(db, planId);
    if (!plan || plan.status !== 'designing') throw new Error('tree can only be updated in designing status');
    const v = validateTree(tree);
    if (!v.valid) throw new Error(`invalid tree: ${v.errors.join('; ')}`);
    updatePlan(db, planId, { target_tree: JSON.stringify(tree) });
    if (confirm) transitionStatus(db, planId, 'assigning');
    return getPlan(db, planId)!;
  })();
}

// ==================== Diff ====================

export function computeDiff(db: Db, plan: PlanRow): DiffSummary {
  const assignments = parseAssignments(plan.assignments);
  const lookup = buildPathLookup(db);
  const targetPaths = collectTargetPaths(plan, assignments);

  const newCategories = targetPaths.filter(p => !lookup.has(casefold(normalizePath(p))));
  const bookmarks = getBookmarkMap(db);
  const moves: DiffSummary['moves'] = [];
  let needsReview = 0;

  for (const a of assignments) {
    if (a.status === 'needs_review') { needsReview++; continue; }
    const tp = normalizePath(a.category_path);
    if (!tp) { needsReview++; continue; }
    const bm = bookmarks.get(a.bookmark_id);
    if (!bm) continue;
    const from = bm.category_name ? normalizePath(bm.category_name) : null;
    if (from && casefold(from) === casefold(tp)) continue;
    moves.push({ bookmark_id: a.bookmark_id, from_category: from, to_category: tp });
  }

  // predict empty categories
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
    new_categories: newCategories, empty_categories: emptyCategories, moves,
    summary: { new_count: newCategories.length, move_count: moves.length, empty_count: emptyCategories.length, needs_review: needsReview },
  };
}

// ==================== Backup & Apply ====================

export function createBackupSnapshot(db: Db): string {
  const categories = db.prepare('SELECT id, name, parent_id, icon, color, sort_order, created_at FROM categories ORDER BY id').all();
  const bookmark_categories = db.prepare('SELECT id AS bookmark_id, category_id FROM bookmarks ORDER BY id').all();
  return JSON.stringify({ categories, bookmark_categories });
}

export function applyPlan(db: Db, planId: string): ApplyResult {
  return db.transaction(() => {
    const plan = getPlan(db, planId);
    if (!plan || plan.status !== 'preview') throw new Error('plan can only be applied in preview status');
    const assignments = parseAssignments(plan.assignments);

    if (!plan.backup_snapshot) updatePlan(db, planId, { backup_snapshot: createBackupSnapshot(db) });

    const lookup = buildPathLookup(db);
    for (const p of collectTargetPaths(plan, assignments)) resolveCategory(db, p, lookup);

    const bookmarks = getBookmarkMap(db);
    const moveStmt = db.prepare('UPDATE bookmarks SET category_id = ?, updated_at = ? WHERE id = ?');
    const conflicts: ConflictItem[] = [];
    let applied = 0;
    const now = nowIso();

    for (const a of assignments) {
      if (a.status !== 'assigned') continue;
      const tp = normalizePath(a.category_path);
      if (!tp) continue;
      const bm = bookmarks.get(a.bookmark_id);
      if (!bm) continue;
      const from = bm.category_name ? normalizePath(bm.category_name) : null;
      if (from && casefold(from) === casefold(tp)) continue;

      if (bm.updated_at && Date.parse(bm.updated_at) > Date.parse(plan.created_at)) {
        conflicts.push({ bookmark_id: bm.id, title: bm.title, url: bm.url, updated_at: bm.updated_at });
        continue;
      }

      const catId = resolveCategory(db, tp, lookup);
      if (bm.category_id === catId) continue;
      applied += moveStmt.run(catId, now, bm.id).changes;
    }

    const empty = db.prepare(`
      SELECT c.id, c.name FROM categories c
      LEFT JOIN bookmarks b ON b.category_id = c.id
      WHERE NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id)
      GROUP BY c.id HAVING COUNT(b.id) = 0
    `).all() as { id: number; name: string }[];

    return { conflicts, empty_categories: empty, applied_count: applied };
  })();
}

export function resolveAndApply(db: Db, planId: string, decisions: ResolveDecisions): ApplyResult {
  return db.transaction(() => {
    const plan = getPlan(db, planId);
    if (!plan || plan.status !== 'preview') throw new Error('plan can only be resolved in preview status');
    const assignments = parseAssignments(plan.assignments);

    if (!plan.backup_snapshot) updatePlan(db, planId, { backup_snapshot: createBackupSnapshot(db) });

    const conflictMap = new Map((decisions.conflicts ?? []).map(c => [c.bookmark_id, c.action]));
    const emptyMap = new Map((decisions.empty_categories ?? []).map(e => [e.id, e.action]));
    const lookup = buildPathLookup(db);
    for (const p of collectTargetPaths(plan, assignments)) resolveCategory(db, p, lookup);

    const bookmarks = getBookmarkMap(db);
    const moveStmt = db.prepare('UPDATE bookmarks SET category_id = ?, updated_at = ? WHERE id = ?');
    const skipped: ConflictItem[] = [];
    let applied = 0;
    const now = nowIso();

    for (const a of assignments) {
      if (a.status !== 'assigned') continue;
      const tp = normalizePath(a.category_path);
      if (!tp) continue;
      const bm = bookmarks.get(a.bookmark_id);
      if (!bm) continue;
      const from = bm.category_name ? normalizePath(bm.category_name) : null;
      if (from && casefold(from) === casefold(tp)) continue;

      if (bm.updated_at && Date.parse(bm.updated_at) > Date.parse(plan.created_at)) {
        if (conflictMap.get(bm.id) !== 'override') {
          skipped.push({ bookmark_id: bm.id, title: bm.title, url: bm.url, updated_at: bm.updated_at });
          continue;
        }
      }

      const catId = resolveCategory(db, tp, lookup);
      if (bm.category_id === catId) continue;
      applied += moveStmt.run(catId, now, bm.id).changes;
    }

    // delete empty categories per user decision
    const delStmt = db.prepare('DELETE FROM categories WHERE id = ?');
    for (const [id, action] of emptyMap) { if (action === 'delete') delStmt.run(id); }

    transitionStatus(db, planId, 'applied');

    const remaining = db.prepare(`
      SELECT c.id, c.name FROM categories c
      LEFT JOIN bookmarks b ON b.category_id = c.id
      WHERE NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id)
      GROUP BY c.id HAVING COUNT(b.id) = 0
    `).all() as { id: number; name: string }[];

    return { conflicts: skipped, empty_categories: remaining, applied_count: applied };
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
