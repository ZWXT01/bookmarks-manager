import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPlan } from '../src/ai-organize-plan';
import { getCategoryByPath, getCategoryFullPath } from '../src/category-service';
import { openDb, type Db } from '../src/db';

let cleanupPaths: string[] = [];
let openHandles: Db[] = [];

function tmpDbPath(): string {
    const dbPath = path.join(os.tmpdir(), `bm_migration_${Date.now()}_${Math.random().toString(16).slice(2)}.db`);
    cleanupPaths.push(dbPath);
    return dbPath;
}

function cleanupDbFiles(dbPath: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
    }
}

afterEach(() => {
    for (const db of openHandles.splice(0)) {
        try { db.close(); } catch { /* ignore */ }
    }
    for (const dbPath of cleanupPaths.splice(0)) cleanupDbFiles(dbPath);
});

describe('database migrations', () => {
    it('removes legacy template schema while keeping categories and foreign keys valid', () => {
        const dbPath = tmpDbPath();
        const legacy = new Database(dbPath);
        legacy.pragma('foreign_keys = ON');
        legacy.exec(`
            CREATE TABLE categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                parent_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                canonical_url TEXT NOT NULL,
                title TEXT NOT NULL,
                category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                last_checked_at TEXT NULL,
                check_status TEXT NOT NULL DEFAULT 'not_checked',
                check_http_code INTEGER NULL,
                check_error TEXT NULL,
                skip_check INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE jobs (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                total INTEGER NOT NULL DEFAULT 0,
                processed INTEGER NOT NULL DEFAULT 0,
                inserted INTEGER NOT NULL DEFAULT 0,
                skipped INTEGER NOT NULL DEFAULT 0,
                failed INTEGER NOT NULL DEFAULT 0,
                message TEXT NULL,
                extra TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE ai_organize_plans (
                id TEXT PRIMARY KEY,
                job_id TEXT,
                status TEXT NOT NULL DEFAULT 'designing',
                scope TEXT NOT NULL DEFAULT 'all',
                target_tree TEXT,
                assignments TEXT,
                diff_summary TEXT,
                backup_snapshot TEXT,
                phase TEXT,
                batches_done INTEGER NOT NULL DEFAULT 0,
                batches_total INTEGER NOT NULL DEFAULT 0,
                failed_batch_ids TEXT,
                needs_review_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                applied_at TEXT,
                template_id INTEGER REFERENCES category_templates(id)
            );
            CREATE TABLE category_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'preset',
                tree TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE template_snapshots (
                template_id INTEGER NOT NULL REFERENCES category_templates(id) ON DELETE CASCADE,
                bookmark_id INTEGER NOT NULL,
                category_path TEXT NOT NULL,
                PRIMARY KEY (template_id, bookmark_id)
            );

            INSERT INTO categories (id, name, parent_id, created_at) VALUES
              (1, '技术开发', NULL, '2026-01-01T00:00:00.000Z'),
              (2, '技术开发/前端', 1, '2026-01-01T00:00:00.000Z');
            INSERT INTO bookmarks (id, url, canonical_url, title, category_id, created_at)
              VALUES (1, 'https://example.test', 'https://example.test', 'Example', 2, '2026-01-01T00:00:00.000Z');
            INSERT INTO category_templates (id, name, type, tree, is_active, created_at, updated_at)
              VALUES (1, '旧模板', 'custom', '[]', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
            INSERT INTO ai_organize_plans (id, status, scope, template_id, created_at)
              VALUES ('legacy-plan', 'applied', 'all', 1, '2026-01-01T00:00:00.000Z');
        `);
        legacy.close();

        const db = openDb(dbPath);
        openHandles.push(db);

        const child = getCategoryByPath(db, '技术开发/前端');
        expect(child).toBeTruthy();
        expect(child!.name).toBe('前端');
        expect(getCategoryFullPath(db, child!.id)).toBe('技术开发/前端');

        const bookmarksFk = db.prepare('PRAGMA foreign_key_list(bookmarks)').all() as Array<{ table: string }>;
        expect(bookmarksFk.some(fk => fk.table === 'categories')).toBe(true);
        expect(bookmarksFk.some(fk => fk.table.includes('old'))).toBe(false);
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

        const planColumns = db.prepare('PRAGMA table_info(ai_organize_plans)').all() as Array<{ name: string }>;
        expect(planColumns.map(column => column.name)).not.toContain('template_id');
        const planFks = db.prepare('PRAGMA foreign_key_list(ai_organize_plans)').all() as Array<{ table: string }>;
        expect(planFks.some(fk => fk.table === 'category_templates')).toBe(false);
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('category_templates', 'template_snapshots')").all()).toEqual([]);

        expect(() => createPlan(db, 'all')).not.toThrow();
    });
});
