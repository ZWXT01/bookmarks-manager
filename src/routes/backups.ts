/**
 * Backup API Routes
 */
import fs from 'fs';
import path from 'path';
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';

export interface BackupRoutesOptions {
    db: Database;
    backupDir: string;
    runBackupNow: (manual?: boolean) => { fileName: string; fullPath: string; skipped?: boolean };
}

export const backupRoutes: FastifyPluginCallback<BackupRoutesOptions> = (app, opts, done) => {
    const { db, backupDir, runBackupNow } = opts;

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
                const isManual = name.startsWith('manual_');
                return {
                    name,
                    size: stats.size,
                    created_at: stats.mtime.toISOString(),
                    type: isManual ? 'manual' : 'auto',
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
        if (!/^(backup|manual|pre_restore)_\d{8}[T_]?\d{6}\.db$/i.test(name)) {
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
        if (!/^(backup|manual|pre_restore)_\d{8}[T_]?\d{6}\.db$/i.test(name)) {
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
        const body: any = req.body || {};
        const name = typeof body.name === 'string' ? body.name.trim() : '';

        if (!name || !/^(backup|manual)_\d{8}_\d{6}\.db$/i.test(name)) {
            return reply.code(400).send({ error: '无效的备份名称' });
        }

        const filePath = path.join(backupDir, name);
        if (!fs.existsSync(filePath)) {
            return reply.code(404).send({ error: '备份不存在' });
        }

        try {
            // 读取备份并恢复
            const backupDb = require('better-sqlite3')(filePath, { readonly: true });

            // 开始事务
            db.exec('BEGIN TRANSACTION');

            try {
                // 清空当前表
                db.exec('DELETE FROM bookmarks');
                db.exec('DELETE FROM categories');

                // 从备份恢复
                const categories = backupDb.prepare('SELECT * FROM categories').all();
                const bookmarks = backupDb.prepare('SELECT * FROM bookmarks').all();

                for (const cat of categories) {
                    db.prepare('INSERT INTO categories (id, name, parent_id, sort_order, icon, color) VALUES (?, ?, ?, ?, ?, ?)').run(
                        cat.id, cat.name, cat.parent_id, cat.sort_order || 0, cat.icon, cat.color
                    );
                }

                for (const bm of bookmarks) {
                    db.prepare('INSERT INTO bookmarks (id, url, canonical_url, title, category_id, created_at, check_status, last_checked_at, check_http_code, check_error, skip_check, is_starred, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
                        bm.id, bm.url, bm.canonical_url, bm.title, bm.category_id, bm.created_at,
                        bm.check_status, bm.last_checked_at, bm.check_http_code, bm.check_error,
                        bm.skip_check || 0, bm.is_starred || 0, bm.description
                    );
                }

                db.exec('COMMIT');
                backupDb.close();

                req.log.info({ name }, 'backup restored');
                return reply.send({ success: true, message: `已从 ${name} 还原` });
            } catch (e) {
                db.exec('ROLLBACK');
                backupDb.close();
                throw e;
            }
        } catch (e: any) {
            req.log.error({ err: e }, 'restore backup failed');
            return reply.code(500).send({ error: '还原失败: ' + (e.message || '') });
        }
    });

    done();
};
