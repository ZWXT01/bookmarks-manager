"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestDb = createTestDb;
exports.seedBookmarks = seedBookmarks;
exports.seedCategory = seedCategory;
/**
 * Test helper: provides an in-memory SQLite database
 * that mirrors the production schema via openDb().
 */
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("../../src/db");
let counter = 0;
/**
 * Create a fresh test database using a temp file.
 * openDb() requires a real file path, so we use os.tmpdir().
 * Returns { db, cleanup } — call cleanup() in afterEach.
 */
function createTestDb() {
    counter += 1;
    const tmpPath = path_1.default.join(os_1.default.tmpdir(), `bm_test_${Date.now()}_${counter}.db`);
    const db = (0, db_1.openDb)(tmpPath);
    const cleanup = () => {
        try {
            db.close();
        }
        catch { /* ignore */ }
        try {
            fs_1.default.unlinkSync(tmpPath);
            fs_1.default.unlinkSync(tmpPath + '-wal');
            fs_1.default.unlinkSync(tmpPath + '-shm');
        }
        catch { /* temp files may not exist */ }
    };
    return { db, cleanup };
}
/** Insert N bookmarks into the test DB, returns inserted IDs */
function seedBookmarks(db, items) {
    const stmt = db.prepare(`INSERT INTO bookmarks (url, canonical_url, title, category_id, created_at, check_status)
     VALUES (?, ?, ?, ?, datetime('now'), 'not_checked')`);
    const ids = [];
    for (const item of items) {
        const res = stmt.run(item.url, item.url, item.title, item.categoryId ?? null);
        ids.push(Number(res.lastInsertRowid));
    }
    return ids;
}
/** Insert a top-level category, returns its ID */
function seedCategory(db, name, parentId = null) {
    const res = db.prepare(`INSERT INTO categories (name, parent_id, created_at) VALUES (?, ?, datetime('now'))`).run(name, parentId);
    return Number(res.lastInsertRowid);
}
