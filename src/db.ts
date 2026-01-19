import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_canonical_url ON bookmarks(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_category_id ON bookmarks(category_id);

    CREATE TABLE IF NOT EXISTS jobs (
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

    CREATE TABLE IF NOT EXISTS job_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      input TEXT NOT NULL,
      reason TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_job_failures_job_id ON job_failures(job_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_classification_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
      suggested_category TEXT NOT NULL,
      confidence TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_bookmark_id ON ai_classification_suggestions(bookmark_id);
    
    -- 性能优化索引
    CREATE INDEX IF NOT EXISTS idx_bookmarks_check_status ON bookmarks(check_status);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

    -- API Tokens 表
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
  `);

  // 迁移：添加skip_check字段（如果不存在）
  const columns = db.prepare("PRAGMA table_info(bookmarks)").all() as Array<{ name: string }>;
  const hasSkipCheck = columns.some(col => col.name === 'skip_check');
  if (!hasSkipCheck) {
    db.exec(`ALTER TABLE bookmarks ADD COLUMN skip_check INTEGER NOT NULL DEFAULT 0`);
  }

  // 迁移：添加 description 字段（如果不存在）
  const hasDescription = columns.some(col => col.name === 'description');
  if (!hasDescription) {
    db.exec(`ALTER TABLE bookmarks ADD COLUMN description TEXT`);
  }

  // 迁移：添加 is_starred 字段（如果不存在）
  const hasIsStarred = columns.some(col => col.name === 'is_starred');
  if (!hasIsStarred) {
    db.exec(`ALTER TABLE bookmarks ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookmarks_is_starred ON bookmarks(is_starred)`);
  }

  // 迁移：添加分类 icon 和 color 字段
  const catColumns = db.prepare("PRAGMA table_info(categories)").all() as Array<{ name: string }>;
  const hasIcon = catColumns.some(col => col.name === 'icon');
  if (!hasIcon) {
    db.exec(`ALTER TABLE categories ADD COLUMN icon TEXT`);
  }
  const hasColor = catColumns.some(col => col.name === 'color');
  if (!hasColor) {
    db.exec(`ALTER TABLE categories ADD COLUMN color TEXT`);
  }

  // 迁移：添加 jobs 表 extra 字段
  const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  const hasExtra = jobColumns.some(col => col.name === 'extra');
  if (!hasExtra) {
    db.exec(`ALTER TABLE jobs ADD COLUMN extra TEXT`);
  }

  // 迁移：添加 ai_classification_suggestions 表 job_id 字段
  const sugColumns = db.prepare("PRAGMA table_info(ai_classification_suggestions)").all() as Array<{ name: string }>;
  const hasJobId = sugColumns.some(col => col.name === 'job_id');
  if (!hasJobId) {
    db.exec(`ALTER TABLE ai_classification_suggestions ADD COLUMN job_id TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_suggestions_job_id ON ai_classification_suggestions(job_id)`);
  }

  // 迁移：添加分类 sort_order 字段（用于同级排序）
  const hasSortOrder = catColumns.some(col => col.name === 'sort_order');
  if (!hasSortOrder) {
    db.exec(`ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0`);
  }

  // 创建 parent_id 索引（用于树状查询）
  db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`);

  return db;
}
