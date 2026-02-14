/**
 * Test helper: provides an in-memory SQLite database
 * that mirrors the production schema via openDb().
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { openDb, type Db } from '../../src/db';

let counter = 0;

/**
 * Create a fresh test database using a temp file.
 * openDb() requires a real file path, so we use os.tmpdir().
 * Returns { db, cleanup } — call cleanup() in afterEach.
 */
export function createTestDb(): { db: Db; cleanup: () => void } {
    counter += 1;
    const tmpPath = path.join(
        os.tmpdir(),
        `bm_test_${Date.now()}_${counter}.db`,
    );
    const db = openDb(tmpPath);

    const cleanup = () => {
        try {
            db.close();
        } catch { /* ignore */ }
        try {
            fs.unlinkSync(tmpPath);
            fs.unlinkSync(tmpPath + '-wal');
            fs.unlinkSync(tmpPath + '-shm');
        } catch { /* temp files may not exist */ }
    };

    return { db, cleanup };
}

/** Insert N bookmarks into the test DB, returns inserted IDs */
export function seedBookmarks(
    db: Db,
    items: Array<{ url: string; title: string; categoryId?: number | null }>,
): number[] {
    const stmt = db.prepare(
        `INSERT INTO bookmarks (url, canonical_url, title, category_id, created_at, check_status)
     VALUES (?, ?, ?, ?, datetime('now'), 'not_checked')`,
    );
    const ids: number[] = [];
    for (const item of items) {
        const res = stmt.run(item.url, item.url, item.title, item.categoryId ?? null);
        ids.push(Number(res.lastInsertRowid));
    }
    return ids;
}

/** Insert a top-level category, returns its ID */
export function seedCategory(db: Db, name: string, parentId: number | null = null): number {
    const res = db.prepare(
        `INSERT INTO categories (name, parent_id, created_at) VALUES (?, ?, datetime('now'))`,
    ).run(name, parentId);
    return Number(res.lastInsertRowid);
}
