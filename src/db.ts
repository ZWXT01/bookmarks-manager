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
      name TEXT NOT NULL,
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
      title TEXT NULL,
      input TEXT NOT NULL,
      reason TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_job_failures_job_id ON job_failures(job_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bookmark_id INTEGER REFERENCES bookmarks(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 性能优化索引
    CREATE INDEX IF NOT EXISTS idx_bookmarks_check_status ON bookmarks(check_status);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
    CREATE INDEX IF NOT EXISTS idx_snapshots_bookmark_id ON snapshots(bookmark_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);

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
      source_snapshot TEXT,
      phase TEXT,
      batches_done INTEGER NOT NULL DEFAULT 0,
      batches_total INTEGER NOT NULL DEFAULT 0,
      failed_batch_ids TEXT,
      needs_review_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      applied_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ai_organize_plans_status ON ai_organize_plans(status);

    CREATE TABLE IF NOT EXISTS plan_state_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL REFERENCES ai_organize_plans(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plan_state_logs_plan_id ON plan_state_logs(plan_id);
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

  // 迁移：添加 job_failures.title 字段（用于任务详情展示书签标题）
  const jobFailureColumns = db.prepare("PRAGMA table_info(job_failures)").all() as Array<{ name: string }>;
  const hasJobFailureTitle = jobFailureColumns.some(col => col.name === 'title');
  if (!hasJobFailureTitle) {
    db.exec(`ALTER TABLE job_failures ADD COLUMN title TEXT`);
  }

  // 迁移：添加分类 sort_order 字段（用于同级排序）
  const hasSortOrder = catColumns.some(col => col.name === 'sort_order');
  if (!hasSortOrder) {
    db.exec(`ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0`);
  }

  migrateCategoriesToScopedShortNames(db);
  migrateAiOrganizePlansAwayFromTemplates(db);
  dropLegacyTemplateTables(db);

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

  // 迁移：取消旧 designing 状态的 Plan
  db.exec(`UPDATE ai_organize_plans SET status = 'canceled' WHERE status = 'designing'`);

  // 迁移：添加 ai_organize_plans.source_snapshot 列
  const planColumns = db.prepare("PRAGMA table_info(ai_organize_plans)").all() as Array<{ name: string }>;
  if (!planColumns.some(col => col.name === 'source_snapshot')) {
    db.exec(`ALTER TABLE ai_organize_plans ADD COLUMN source_snapshot TEXT`);
  }

  return db;
}

interface CategoryMigrationRow {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
  icon: string | null;
  color: string | null;
  sort_order: number | null;
}

function tableSql(db: Db, name: string): string {
  const row = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(name) as { sql: string | null } | undefined;
  return row?.sql ?? '';
}

function categoriesHaveGlobalNameUnique(db: Db): boolean {
  if (/\bname\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i.test(tableSql(db, 'categories'))) return true;
  const indexes = db.prepare(`PRAGMA index_list(categories)`).all() as Array<{
    name: string;
    unique: number;
    partial: number;
    origin: string;
  }>;
  for (const idx of indexes) {
    if (!idx.unique || idx.partial) continue;
    const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all() as Array<{ name: string }>;
    if (cols.length === 1 && cols[0]?.name === 'name') return true;
  }
  return false;
}

function tableExists(db: Db, name: string): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(name));
}

function columnNames(db: Db, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .map(column => column.name);
}

function normalizeChildName(rawName: string, parentName: string | null | undefined): string {
  const trimmed = rawName.trim();
  if (parentName && trimmed.startsWith(parentName + '/')) {
    return trimmed.slice(parentName.length + 1).trim() || trimmed;
  }
  return trimmed.includes('/') ? trimmed.split('/').pop()!.trim() : trimmed;
}

function makeUniqueName(baseName: string, used: Set<string>): string {
  const normalized = baseName.trim() || '未命名';
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }

  let index = 2;
  while (used.has(`${normalized} (${index})`)) index += 1;
  const next = `${normalized} (${index})`;
  used.add(next);
  return next;
}

function normalizeCategoryRows(rows: CategoryMigrationRow[]): CategoryMigrationRow[] {
  const rootRows = rows.filter(row => row.parent_id === null);
  const rootNameById = new Map<number, string>();
  const usedRootNames = new Set<string>();

  for (const row of rootRows) {
    const name = makeUniqueName(row.name.trim() || '未命名', usedRootNames);
    rootNameById.set(row.id, name);
  }

  const usedChildNames = new Map<number, Set<string>>();
  const normalized = rows.map(row => ({ ...row }));

  for (const row of normalized) {
    if (row.parent_id === null || !rootNameById.has(row.parent_id)) {
      row.parent_id = null;
      row.name = rootNameById.get(row.id) ?? makeUniqueName(row.name.trim() || '未命名', usedRootNames);
      continue;
    }

    const parentName = rootNameById.get(row.parent_id)!;
    let used = usedChildNames.get(row.parent_id);
    if (!used) {
      used = new Set<string>();
      usedChildNames.set(row.parent_id, used);
    }
    row.name = makeUniqueName(normalizeChildName(row.name, parentName), used);
  }

  return normalized.sort((a, b) => a.id - b.id);
}

function migrateCategoriesToScopedShortNames(db: Db): void {
  const settingsReady = Boolean(db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'`
  ).get());
  if (!settingsReady) return;

  const marker = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('categories_short_names_migrated') as { value: string } | undefined;
  const hasSlashChildren = (db.prepare(
    `SELECT COUNT(1) AS cnt FROM categories WHERE parent_id IS NOT NULL AND name LIKE '%/%'`
  ).get() as { cnt: number }).cnt > 0;
  const needsRebuild = !marker || categoriesHaveGlobalNameUnique(db) || hasSlashChildren;

  if (needsRebuild) {
    const rows = db.prepare(`
      SELECT id, name, parent_id, created_at, icon, color, sort_order
      FROM categories
      ORDER BY id
    `).all() as CategoryMigrationRow[];
    const normalizedRows = normalizeCategoryRows(rows);

    db.pragma('foreign_keys = OFF');
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec(`DROP TABLE IF EXISTS categories_new_short_names`);
      db.exec(`
        CREATE TABLE categories_new_short_names (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          parent_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          icon TEXT,
          color TEXT,
          sort_order INTEGER DEFAULT 0
        )
      `);

      const insert = db.prepare(`
        INSERT INTO categories_new_short_names (id, name, parent_id, created_at, icon, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of normalizedRows) {
        insert.run(
          row.id,
          row.name,
          row.parent_id,
          row.created_at,
          row.icon ?? null,
          row.color ?? null,
          row.sort_order ?? 0,
        );
      }

      db.exec(`DROP TABLE categories`);
      db.exec(`ALTER TABLE categories_new_short_names RENAME TO categories`);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
        CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_root_name_unique ON categories(name) WHERE parent_id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_child_parent_name_unique ON categories(parent_id, name) WHERE parent_id IS NOT NULL;
      `);
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run('categories_short_names_migrated', '1');
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  } else {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_root_name_unique ON categories(name) WHERE parent_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_child_parent_name_unique ON categories(parent_id, name) WHERE parent_id IS NOT NULL;
    `);
    if (hasSlashChildren) {
      const rows = db.prepare(`
        SELECT id, name, parent_id, created_at, icon, color, sort_order
        FROM categories
        ORDER BY id
      `).all() as CategoryMigrationRow[];
      const normalizedRows = normalizeCategoryRows(rows);
      const update = db.prepare('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?');
      const tx = db.transaction(() => {
        for (const row of normalizedRows) update.run(row.name, row.parent_id, row.id);
      });
      tx();
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run('categories_short_names_migrated', '1');
  }
}

function migrateAiOrganizePlansAwayFromTemplates(db: Db): void {
  if (!tableExists(db, 'ai_organize_plans')) return;

  const existingColumns = new Set(columnNames(db, 'ai_organize_plans'));
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(ai_organize_plans)`).all() as Array<{ table: string }>;
  const hasTemplateColumn = existingColumns.has('template_id');
  const hasTemplateForeignKey = foreignKeys.some(key => key.table === 'category_templates');

  if (!hasTemplateColumn && !hasTemplateForeignKey) return;

  const canonicalColumns = [
    'id',
    'job_id',
    'status',
    'scope',
    'target_tree',
    'assignments',
    'diff_summary',
    'backup_snapshot',
    'source_snapshot',
    'phase',
    'batches_done',
    'batches_total',
    'failed_batch_ids',
    'needs_review_count',
    'created_at',
    'applied_at',
  ];
  const selectExprs = canonicalColumns.map(column => {
    if (existingColumns.has(column)) return column;
    if (column === 'status') return `'canceled' AS status`;
    if (column === 'scope') return `'all' AS scope`;
    if (column === 'batches_done' || column === 'batches_total' || column === 'needs_review_count') return `0 AS ${column}`;
    if (column === 'created_at') return `datetime('now') AS created_at`;
    return `NULL AS ${column}`;
  });

  db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`DROP TABLE IF EXISTS ai_organize_plans_new_no_templates`);
    db.exec(`
      CREATE TABLE ai_organize_plans_new_no_templates (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        status TEXT NOT NULL DEFAULT 'designing',
        scope TEXT NOT NULL DEFAULT 'all',
        target_tree TEXT,
        assignments TEXT,
        diff_summary TEXT,
        backup_snapshot TEXT,
        source_snapshot TEXT,
        phase TEXT,
        batches_done INTEGER NOT NULL DEFAULT 0,
        batches_total INTEGER NOT NULL DEFAULT 0,
        failed_batch_ids TEXT,
        needs_review_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        applied_at TEXT
      )
    `);
    db.exec(`
      INSERT INTO ai_organize_plans_new_no_templates (${canonicalColumns.join(', ')})
      SELECT ${selectExprs.join(', ')}
      FROM ai_organize_plans
    `);
    db.exec(`DROP TABLE ai_organize_plans`);
    db.exec(`ALTER TABLE ai_organize_plans_new_no_templates RENAME TO ai_organize_plans`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_organize_plans_status ON ai_organize_plans(status)`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function dropLegacyTemplateTables(db: Db): void {
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      DROP TABLE IF EXISTS template_snapshots;
      DROP TABLE IF EXISTS category_templates;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
