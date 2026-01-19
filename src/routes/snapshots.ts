/**
 * Snapshots API Routes
 */
import fs from 'fs';
import path from 'path';
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';

export interface SnapshotRoutesOptions {
    db: Database;
    snapshotsDir: string;
}

export const snapshotRoutes: FastifyPluginCallback<SnapshotRoutesOptions> = (app, opts, done) => {
    const { db, snapshotsDir } = opts;

    // 确保快照表存在
    db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bookmark_id INTEGER REFERENCES bookmarks(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

    // GET /snapshots - 快照管理页面
    app.get('/snapshots', async (req: FastifyRequest, reply: FastifyReply) => {
        const total = (db.prepare('SELECT COUNT(*) as count FROM snapshots').get() as { count: number }).count;
        const totalSize = (db.prepare('SELECT SUM(file_size) as total FROM snapshots').get() as { total: number | null }).total || 0;

        const snapshots = db.prepare(`
      SELECT s.*, b.title as bookmark_title, c.name as bookmark_category
      FROM snapshots s
      LEFT JOIN bookmarks b ON s.bookmark_id = b.id
      LEFT JOIN categories c ON b.category_id = c.id
      ORDER BY s.created_at DESC
    `).all();

        return reply.view('snapshots.ejs', {
            snapshots,
            pagination: { page: 1, limit: total, total, totalPages: 1 },
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
            apiToken: process.env.API_TOKEN || '',
        });
    });

    // POST /api/snapshots - 保存快照
    app.post('/api/snapshots', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const urlInput = typeof body.url === 'string' ? body.url.trim() : '';
        const titleInput = typeof body.title === 'string' ? body.title.trim() : '';
        const content = typeof body.content === 'string' ? body.content : '';

        if (!urlInput) return reply.code(400).send({ error: '缺少 URL' });
        if (!content) return reply.code(400).send({ error: '缺少快照内容' });

        fs.mkdirSync(snapshotsDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const cleanTitle = (titleInput || 'untitled')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/\s+/g, '_')
            .slice(0, 50);
        const safeFilename = `${cleanTitle}_${timestamp}.html`;
        const filePath = path.join(snapshotsDir, safeFilename);

        try {
            fs.writeFileSync(filePath, content, 'utf8');
            const stats = fs.statSync(filePath);

            // 查找匹配的书签
            let bookmarkId: number | null = null;
            const bookmark = db.prepare('SELECT id FROM bookmarks WHERE url = ? OR canonical_url = ?').get(urlInput, urlInput) as { id: number } | undefined;
            if (bookmark) bookmarkId = bookmark.id;

            const res = db.prepare(`
        INSERT INTO snapshots (bookmark_id, url, title, filename, file_size, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(bookmarkId, urlInput, titleInput || urlInput, safeFilename, stats.size, new Date().toISOString());

            return reply.send({
                success: true,
                snapshot: { id: Number(res.lastInsertRowid), filename: safeFilename, file_size: stats.size, bookmark_id: bookmarkId },
            });
        } catch (e: any) {
            req.log.error({ err: e }, 'save snapshot failed');
            return reply.code(500).send({ error: '保存快照失败' });
        }
    });

    // GET /api/snapshots - 获取快照列表
    app.get('/api/snapshots', async (req: FastifyRequest, reply: FastifyReply) => {
        const query: any = req.query || {};
        const bookmarkId = query.bookmark_id;

        let snapshots;
        if (bookmarkId) {
            snapshots = db.prepare('SELECT * FROM snapshots WHERE bookmark_id = ? ORDER BY created_at DESC').all(bookmarkId);
        } else {
            snapshots = db.prepare('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 100').all();
        }

        return reply.send({ snapshots });
    });

    // GET /snapshots/:filename - 查看快照文件
    app.get('/snapshots/:filename', async (req: FastifyRequest<{ Params: { filename: string } }>, reply: FastifyReply) => {
        const filename = req.params.filename;
        // 允许中文和其他 Unicode 字符，只禁止路径穿越字符
        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') || !filename.endsWith('.html')) {
            return reply.code(400).send({ error: '无效的文件名' });
        }

        const filePath = path.join(snapshotsDir, filename);
        if (!fs.existsSync(filePath)) {
            return reply.code(404).send({ error: '快照不存在' });
        }

        return reply.type('text/html').send(fs.createReadStream(filePath));
    });

    // DELETE /api/snapshots/:id - 删除快照
    app.delete('/api/snapshots/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return reply.code(400).send({ error: '无效的 ID' });

        const row = db.prepare('SELECT filename FROM snapshots WHERE id = ?').get(id) as { filename: string } | undefined;
        if (!row) return reply.code(404).send({ error: '快照不存在' });

        try {
            const filePath = path.join(snapshotsDir, row.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
            return reply.send({ success: true });
        } catch (e: any) {
            req.log.error({ err: e }, 'delete snapshot failed');
            return reply.code(500).send({ error: '删除失败' });
        }
    });

    // POST /api/snapshots/batch-delete - 批量删除快照
    app.post('/api/snapshots/batch-delete', async (req: FastifyRequest, reply: FastifyReply) => {
        const body: any = req.body || {};
        const ids = body.ids;

        if (!Array.isArray(ids) || ids.length === 0) {
            return reply.code(400).send({ error: '缺少 ids 参数' });
        }

        try {
            let deleted = 0;
            for (const id of ids) {
                const numId = Number(id);
                if (!Number.isInteger(numId)) continue;

                const row = db.prepare('SELECT filename FROM snapshots WHERE id = ?').get(numId) as { filename: string } | undefined;
                if (row) {
                    const filePath = path.join(snapshotsDir, row.filename);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    db.prepare('DELETE FROM snapshots WHERE id = ?').run(numId);
                    deleted++;
                }
            }
            return reply.send({ success: true, deleted });
        } catch (e: any) {
            req.log.error({ err: e }, 'batch delete snapshots failed');
            return reply.code(500).send({ error: '批量删除失败' });
        }
    });

    done();
};
