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

    -- AI 整理计划表
    CREATE TABLE IF NOT EXISTS ai_organize_plans (
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
      applied_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ai_organize_plans_status ON ai_organize_plans(status);
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

  // 迁移：添加分类 sort_order 字段（用于同级排序）
  const hasSortOrder = catColumns.some(col => col.name === 'sort_order');
  if (!hasSortOrder) {
    db.exec(`ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0`);
  }

  // 迁移：添加 bookmarks.updated_at 字段（冲突检测依赖）
  const hasUpdatedAt = columns.some(col => col.name === 'updated_at');
  if (!hasUpdatedAt) {
    db.exec(`ALTER TABLE bookmarks ADD COLUMN updated_at TEXT`);
    db.exec(`UPDATE bookmarks SET updated_at = created_at WHERE updated_at IS NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookmarks_updated_at ON bookmarks(updated_at)`);
  }

  // 迁移：删除旧 AI 建议表
  db.exec(`DROP TABLE IF EXISTS ai_classification_suggestions`);
  db.exec(`DROP TABLE IF EXISTS ai_simplify_suggestions`);
  db.exec(`DROP TABLE IF EXISTS ai_level_simplify_suggestions`);

  // 创建 parent_id 索引（用于树状查询）
  db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`);

  return db;
}
