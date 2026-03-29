import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

import type { Db } from '../../src/db';
import { buildPlanSourceSnapshot, type PlanStatus, type PlanRow } from '../../src/ai-organize-plan';
import type { JobRow, JobStatus, JobType } from '../../src/jobs';

export { createTestDb, seedBookmarks, seedCategory } from './db';

export interface SeedUserOptions {
    username?: string;
    password?: string;
    created_at?: string;
    updated_at?: string;
    last_login_at?: string | null;
}

export interface SeededUser {
    id: number;
    username: string;
    password: string;
}

export type CategoryTreeSeedInput =
    | string
    | {
        name: string;
        icon?: string | null;
        color?: string | null;
        created_at?: string;
        children?: CategoryTreeSeedInput[];
    };

export interface SeededCategoryTreeNode {
    id: number;
    name: string;
    parentId: number | null;
    fullPath: string;
    children: SeededCategoryTreeNode[];
}

export interface SeedJobOptions {
    id?: string;
    type?: JobType;
    status?: JobStatus;
    total?: number;
    processed?: number;
    inserted?: number;
    skipped?: number;
    failed?: number;
    message?: string | null;
    extra?: unknown;
    created_at?: string;
    updated_at?: string;
}

export interface SeedPlanOptions {
    id?: string;
    job_id?: string | null;
    status?: PlanStatus;
    scope?: string;
    target_tree?: unknown;
    assignments?: unknown;
    diff_summary?: unknown;
    backup_snapshot?: unknown;
    source_snapshot?: unknown;
    phase?: string | null;
    batches_done?: number;
    batches_total?: number;
    failed_batch_ids?: unknown;
    needs_review_count?: number;
    template_id?: number | null;
    created_at?: string;
    applied_at?: string | null;
}

export interface SeedSnapshotOptions {
    snapshotsDir: string;
    bookmark_id?: number | null;
    url?: string;
    title?: string;
    filename?: string;
    content?: string;
    created_at?: string;
}

export interface SnapshotRow {
    id: number;
    bookmark_id: number | null;
    url: string;
    title: string;
    filename: string;
    file_size: number;
    created_at: string;
}

function ensureUsersTable(db: Db): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT
        )
    `);
}

function ensureSnapshotsTable(db: Db): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bookmark_id INTEGER REFERENCES bookmarks(id) ON DELETE SET NULL,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            filename TEXT NOT NULL UNIQUE,
            file_size INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
    `);
}

function serializeJson(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function defaultPlanPhase(status: PlanStatus): string | null {
    if (status === 'assigning') return 'assigning';
    if (status === 'preview') return 'preview';
    return null;
}

function insertCategoryNode(
    db: Db,
    input: CategoryTreeSeedInput,
    parentId: number | null,
    parentPath: string,
    sortOrder: number,
): SeededCategoryTreeNode {
    const node = typeof input === 'string' ? { name: input } : input;
    const createdAt = node.created_at ?? new Date().toISOString();
    const result = db.prepare(
        `INSERT INTO categories (name, parent_id, icon, color, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(node.name, parentId, node.icon ?? null, node.color ?? null, sortOrder, createdAt);

    const id = Number(result.lastInsertRowid);
    const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    const children = (node.children ?? []).map((child, index) => insertCategoryNode(db, child, id, fullPath, index));

    return { id, name: node.name, parentId, fullPath, children };
}

export function seedUser(db: Db, options: SeedUserOptions = {}): SeededUser {
    ensureUsersTable(db);

    const username = options.username ?? `user_${randomUUID().slice(0, 8)}`;
    const password = options.password ?? 'test-password';
    const createdAt = options.created_at ?? new Date().toISOString();
    const updatedAt = options.updated_at ?? createdAt;
    const passwordHash = bcrypt.hashSync(password, 10);

    const result = db.prepare(
        'INSERT INTO users (username, password_hash, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?)',
    ).run(username, passwordHash, createdAt, updatedAt, options.last_login_at ?? null);

    return {
        id: Number(result.lastInsertRowid),
        username,
        password,
    };
}

export function seedCategoryTree(db: Db, tree: CategoryTreeSeedInput[]): SeededCategoryTreeNode[] {
    return tree.map((node, index) => insertCategoryNode(db, node, null, '', index));
}

export function seedJob(db: Db, options: SeedJobOptions = {}): JobRow {
    const id = options.id ?? randomUUID();
    const createdAt = options.created_at ?? new Date().toISOString();
    const updatedAt = options.updated_at ?? createdAt;

    db.prepare(
        `INSERT INTO jobs (
            id, type, status, total, processed, inserted, skipped, failed, message, extra, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        id,
        options.type ?? 'import',
        options.status ?? 'queued',
        options.total ?? 0,
        options.processed ?? 0,
        options.inserted ?? 0,
        options.skipped ?? 0,
        options.failed ?? 0,
        options.message ?? null,
        serializeJson(options.extra),
        createdAt,
        updatedAt,
    );

    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow;
}

export function seedPlan(db: Db, options: SeedPlanOptions = {}): PlanRow {
    const id = options.id ?? randomUUID();
    const status = options.status ?? 'assigning';
    const createdAt = options.created_at ?? new Date().toISOString();
    const appliedAt = options.applied_at ?? (status === 'applied' ? createdAt : null);

    db.prepare(
        `INSERT INTO ai_organize_plans (
            id, job_id, status, scope, target_tree, assignments, diff_summary, backup_snapshot, source_snapshot,
            phase, batches_done, batches_total, failed_batch_ids, needs_review_count,
            template_id, created_at, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        id,
        options.job_id ?? null,
        status,
        options.scope ?? 'all',
        serializeJson(options.target_tree),
        serializeJson(options.assignments),
        serializeJson(options.diff_summary),
        serializeJson(options.backup_snapshot),
        serializeJson(options.source_snapshot),
        options.phase ?? defaultPlanPhase(status),
        options.batches_done ?? 0,
        options.batches_total ?? 0,
        serializeJson(options.failed_batch_ids),
        options.needs_review_count ?? 0,
        options.template_id ?? null,
        createdAt,
        appliedAt,
    );

    let plan = db.prepare('SELECT * FROM ai_organize_plans WHERE id = ?').get(id) as PlanRow;
    if (options.source_snapshot === undefined && plan.assignments && (plan.status === 'preview' || plan.status === 'applied')) {
        const sourceSnapshot = buildPlanSourceSnapshot(db, plan);
        db.prepare('UPDATE ai_organize_plans SET source_snapshot = ? WHERE id = ?').run(JSON.stringify(sourceSnapshot), id);
        plan = db.prepare('SELECT * FROM ai_organize_plans WHERE id = ?').get(id) as PlanRow;
    }

    return plan;
}

export function seedSnapshot(db: Db, options: SeedSnapshotOptions): SnapshotRow {
    ensureSnapshotsTable(db);

    const url = options.url ?? 'https://example.com';
    const title = options.title ?? 'Example Snapshot';
    const createdAt = options.created_at ?? new Date().toISOString();
    const filename = options.filename ?? `snapshot-${randomUUID().slice(0, 8)}.html`;
    const content = options.content ?? '<!doctype html><html><body>snapshot</body></html>';
    const filePath = path.join(options.snapshotsDir, filename);

    fs.mkdirSync(options.snapshotsDir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    const fileSize = fs.statSync(filePath).size;

    const result = db.prepare(
        `INSERT INTO snapshots (bookmark_id, url, title, filename, file_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(options.bookmark_id ?? null, url, title, filename, fileSize, createdAt);

    return db.prepare('SELECT * FROM snapshots WHERE id = ?').get(Number(result.lastInsertRowid)) as SnapshotRow;
}
