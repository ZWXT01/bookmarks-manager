/**
 * Backup API Routes
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
    allocateBackupFile,
    backupFileNamePattern,
    createSqliteBackup,
    partialRestoreContract,
} from '../backup-contract';

export interface BackupRoutesOptions {
    db: Database;
    backupDir: string;
    runBackupNow: (manual?: boolean) => { fileName: string; fullPath: string; skipped?: boolean };
}

export const backupRoutes: FastifyPluginCallback<BackupRoutesOptions> = (app, opts, done) => {
    const { db, backupDir, runBackupNow } = opts;
    const requiredRestoreTables = ['categories', 'bookmarks'] as const;
    const requiredCategoryColumns = ['id', 'name', 'parent_id', 'created_at'] as const;
    const requiredBookmarkColumns = ['id', 'url', 'canonical_url', 'title', 'created_at'] as const;

    function createValidationCopy(sourcePath: string): { tempDir: string; tempPath: string } {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-restore-'));
        const tempPath = path.join(tempDir, 'restore.db');
        fs.copyFileSync(sourcePath, tempPath);
        return { tempDir, tempPath };
    }

    function createPreRestoreBackup(): { fileName: string; fullPath: string } {
        const { fileName, fullPath } = allocateBackupFile(backupDir, 'pre_restore_');
        createSqliteBackup(db, fullPath);
        return { fileName, fullPath };
    }

    function assertBackupTablesAndColumns(backupDb: Database): void {
        for (const table of requiredRestoreTables) {
            const exists = backupDb.prepare(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            ).get(table);
            if (!exists) throw new Error(`备份缺少表: ${table}`);
        }

        const categoryColumns = new Set(
            (backupDb.prepare('PRAGMA table_info(categories)').all() as Array<{ name: string }>).map((column) => column.name),
        );
        for (const column of requiredCategoryColumns) {
            if (!categoryColumns.has(column)) throw new Error(`备份缺少 categories.${column} 列`);
        }

        const bookmarkColumns = new Set(
            (backupDb.prepare('PRAGMA table_info(bookmarks)').all() as Array<{ name: string }>).map((column) => column.name),
        );
        for (const column of requiredBookmarkColumns) {
            if (!bookmarkColumns.has(column)) throw new Error(`备份缺少 bookmarks.${column} 列`);
        }
    }

    function openValidatedBackupDb(filePath: string): Database {
        const openBackupDb = require('better-sqlite3');
        const backupDb = openBackupDb(filePath, { readonly: true }) as Database;

        try {
            const integrity = backupDb.prepare('PRAGMA integrity_check').pluck().get() as string | undefined;
            if (integrity !== 'ok') {
                throw new Error(`备份校验失败: integrity_check=${integrity || 'unknown'}`);
            }

            assertBackupTablesAndColumns(backupDb);
            return backupDb;
        } catch (error) {
            backupDb.close();
            throw error;
        }
    }

    function restoreCategoriesAndBookmarks(backupDb: Database): void {
        const categories = backupDb.prepare(`
            SELECT *
            FROM categories
            ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, id ASC
        `).all() as Array<Record<string, any>>;
        const bookmarks = backupDb.prepare(`
            SELECT *
            FROM bookmarks
            ORDER BY id ASC
        `).all() as Array<Record<string, any>>;

        db.exec('BEGIN TRANSACTION');

        try {
            db.exec('DELETE FROM bookmarks');
            db.exec('DELETE FROM categories');

            for (const cat of categories) {
                db.prepare(`
                    INSERT INTO categories (id, name, parent_id, sort_order, icon, color, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    cat.id,
                    cat.name,
                    cat.parent_id ?? null,
                    cat.sort_order ?? 0,
                    cat.icon ?? null,
                    cat.color ?? null,
                    cat.created_at || new Date().toISOString(),
                );
            }

            for (const bookmark of bookmarks) {
                db.prepare(`
                    INSERT INTO bookmarks (
                        id, url, canonical_url, title, category_id, created_at, updated_at,
                        check_status, last_checked_at, check_http_code, check_error,
                        skip_check, is_starred, description
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    bookmark.id,
                    bookmark.url,
                    bookmark.canonical_url,
                    bookmark.title,
                    bookmark.category_id ?? null,
                    bookmark.created_at || new Date().toISOString(),
                    bookmark.updated_at || bookmark.created_at || new Date().toISOString(),
                    bookmark.check_status || 'not_checked',
                    bookmark.last_checked_at ?? null,
                    bookmark.check_http_code ?? null,
                    bookmark.check_error ?? null,
                    bookmark.skip_check ?? 0,
                    bookmark.is_starred ?? 0,
                    bookmark.description ?? null,
                );
            }

            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }

    // GET /api/backups - 获取备份列表
    app.get('/api/backups', async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            if (!fs.existsSync(backupDir)) {
                return reply.send({ backups: [] });
            }

            const files = fs.readdirSync(backupDir).filter(f => /\.(db)$/i.test(f));
            const backups = files.map(name => {
                const fullPath = path.join(backupDir, name);
                const stats = fs.statSync(fullPath);
                const type = name.startsWith('manual_')
                    ? 'manual'
                    : name.startsWith('pre_restore_')
                        ? 'pre_restore'
                        : 'auto';
                return {
                    name,
                    size: stats.size,
                    created_at: stats.mtime.toISOString(),
                    type,
                };
            }).sort((a, b) => b.created_at.localeCompare(a.created_at));

            return reply.send({ backups });
        } catch (e: any) {
            return reply.code(500).send({ error: '获取备份列表失败' });
        }
    });

    // POST /api/backups/run - 手动创建备份
    app.post('/api/backups/run', async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const res = runBackupNow(true);
            if (res.skipped) {
                return reply.send({ success: true, skipped: true, message: '当前无书签，跳过备份' });
            }
            req.log.info({ fileName: res.fileName }, 'manual backup created');
            return reply.send({ success: true, backup: res.fileName });
        } catch (e: any) {
            req.log.error({ err: e }, 'backup failed');
            return reply.code(500).send({ error: '备份失败' });
        }
    });

    // GET /backups/:name - 下载备份文件
    app.get('/backups/:name', async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
        const name = req.params.name;
        if (!backupFileNamePattern.test(name)) {
            return reply.code(400).send({ error: '无效的文件名' });
        }

        const filePath = path.join(backupDir, name);
        if (!fs.existsSync(filePath)) {
            return reply.code(404).send({ error: '备份不存在' });
        }

        return reply.header('Content-Disposition', `attachment; filename="${name}"`).send(fs.createReadStream(filePath));
    });

    // DELETE /api/backups/:name - 删除备份
    app.delete('/api/backups/:name', async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
        const name = req.params.name;
        if (!backupFileNamePattern.test(name)) {
            return reply.code(400).send({ error: '无效的文件名' });
        }

        const filePath = path.join(backupDir, name);
        if (!fs.existsSync(filePath)) {
            return reply.code(404).send({ error: '备份不存在' });
        }

        try {
            fs.unlinkSync(filePath);
            req.log.info({ name }, 'backup deleted');
            return reply.send({ success: true });
        } catch (e: any) {
            req.log.error({ err: e }, 'delete backup failed');
            return reply.code(500).send({ error: '删除失败' });
        }
    });

    // POST /api/backups/restore - 还原备份
    app.post('/api/backups/restore', async (req: FastifyRequest, reply: FastifyReply) => {
        const isMultipart = typeof (req as any).isMultipart === 'function' && (req as any).isMultipart();
        let workingFilePath: string | null = null;
        let workingTempDir: string | null = null;
        let preRestoreBackup: { fileName: string; fullPath: string } | null = null;
        let sourceName = '';
        const mode = isMultipart ? 'upload' : 'named_backup';

        try {
            if (isMultipart) {
                const parts: any = (req as any).parts();
                for await (const part of parts) {
                    if (part?.type !== 'file') continue;

                    if (workingFilePath) {
                        await part.toBuffer();
                        continue;
                    }

                    const filename = typeof part.filename === 'string' ? part.filename.trim() : '';
                    if (!filename || !filename.toLowerCase().endsWith('.db')) {
                        await part.toBuffer();
                        return reply.code(400).send({ error: '请上传 .db 格式文件' });
                    }

                    sourceName = filename;
                    const buffer = await part.toBuffer();
                    if (!buffer || buffer.length === 0) {
                        return reply.code(400).send({ error: '上传文件为空' });
                    }

                    workingTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-restore-'));
                    workingFilePath = path.join(workingTempDir, 'restore.db');
                    fs.writeFileSync(workingFilePath, buffer);
                }

                if (!workingFilePath) {
                    return reply.code(400).send({ error: '缺少上传文件' });
                }
            } else {
                const body: any = req.body || {};
                const name = typeof body.name === 'string' ? body.name.trim() : '';
                if (!name || !backupFileNamePattern.test(name)) {
                    return reply.code(400).send({ error: '无效的备份名称' });
                }

                const filePath = path.join(backupDir, name);
                if (!fs.existsSync(filePath)) {
                    return reply.code(404).send({ error: '备份不存在' });
                }

                sourceName = name;
                const validationCopy = createValidationCopy(filePath);
                workingTempDir = validationCopy.tempDir;
                workingFilePath = validationCopy.tempPath;
            }

            const backupDb = openValidatedBackupDb(workingFilePath);
            try {
                preRestoreBackup = createPreRestoreBackup();
                restoreCategoriesAndBookmarks(backupDb);
            } finally {
                backupDb.close();
            }

            req.log.info({
                sourceName,
                mode,
                preRestoreBackup: preRestoreBackup.fileName,
                restoredTables: partialRestoreContract.restoredTables,
            }, 'backup restored');
            return reply.send({
                success: true,
                message: `已从 ${sourceName} 还原分类与书签`,
                restored_tables: [...partialRestoreContract.restoredTables],
                preserved_tables: [...partialRestoreContract.preservedTables],
                preserved_assets: [...partialRestoreContract.preservedAssets],
                pre_restore_backup: preRestoreBackup.fileName,
            });
        } catch (e: any) {
            req.log.error({ err: e, sourceName, mode, preRestoreBackup: preRestoreBackup?.fileName }, 'restore backup failed');
            return reply.code(500).send({ error: '还原失败: ' + (e.message || '') });
        } finally {
            if (workingTempDir) {
                try { fs.rmSync(workingTempDir, { recursive: true, force: true }); } catch { }
            }
        }
    });

    done();
};
