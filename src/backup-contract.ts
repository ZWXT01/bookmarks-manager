import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';

export const backupFileNamePattern = /^(backup|manual|pre_restore)_\d{8}[T_]?\d{6}\.db$/i;

export const partialRestoreContract = {
  restoredTables: ['categories', 'bookmarks'],
  preservedTables: [
    'settings',
    'api_tokens',
    'jobs',
    'job_failures',
    'category_templates',
    'template_snapshots',
    'ai_organize_plans',
    'plan_state_logs',
    'snapshots',
  ],
  preservedAssets: ['snapshots/*.html'],
} as const;

export function formatBackupTimestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '_' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

export function escapeSqlString(input: string): string {
  return input.replace(/'/g, "''");
}

export function allocateBackupFile(
  backupDir: string,
  prefix: 'backup_' | 'manual_' | 'pre_restore_',
): { fileName: string; fullPath: string } {
  fs.mkdirSync(backupDir, { recursive: true });

  const baseTime = Date.now();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ts = formatBackupTimestamp(new Date(baseTime + attempt * 1000));
    const fileName = prefix + ts + '.db';
    const fullPath = path.join(backupDir, fileName);
    if (!fs.existsSync(fullPath)) return { fileName, fullPath };
  }

  throw new Error(`无法为 ${prefix} 分配唯一备份文件名`);
}

export function createSqliteBackup(db: Database, fullPath: string): void {
  db.exec('VACUUM INTO \'' + escapeSqlString(fullPath) + '\'');
}
