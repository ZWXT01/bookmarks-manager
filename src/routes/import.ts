/**
 * Import Routes - 书签导入路由
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { MultipartFile } from '@fastify/multipart';
import { createJob, getJob, jobQueue, updateJob } from '../jobs';
import { parseImportContent, runImportJob } from '../importer';
import { toInt, decodeImportBuffer } from '../utils/helpers';

export interface ImportRoutesOptions {
    db: Database;
}

type MultipartRequest = FastifyRequest & { file: () => Promise<MultipartFile | undefined> };

export const importRoutes: FastifyPluginCallback<ImportRoutesOptions> = (app, opts, done) => {
    const { db } = opts;

    // POST /import - 导入书签
    app.post('/import', async (req: MultipartRequest, reply: FastifyReply) => {
        const wantsJson = /application\/json/i.test((req.headers as any)?.accept || '');
        let fileName: string | null = null;
        let fileMime: string | null = null;
        let fileBuf: Buffer | null = null;
        let skipDuplicates = true;
        let defaultCategoryId: number | null = null;
        let overrideCategory = false;

        try {
            const parts: any = (req as any).parts();
            for await (const part of parts) {
                if (part && part.type === 'file') {
                    if (!fileBuf) {
                        fileName = part.filename;
                        fileMime = part.mimetype;
                        fileBuf = await part.toBuffer();
                    } else {
                        await part.toBuffer();
                    }
                    continue;
                }
                if (part && typeof part.fieldname === 'string' && part.fieldname === 'skipDuplicates') {
                    const v = part.value;
                    skipDuplicates = v === '1' || v === 'on' || v === true;
                }
                if (part && typeof part.fieldname === 'string' && part.fieldname === 'overrideCategory') {
                    const v = part.value;
                    overrideCategory = v === '1' || v === 'on' || v === true;
                }
                if (part && typeof part.fieldname === 'string' && part.fieldname === 'defaultCategoryId') {
                    const v = part.value;
                    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
                    if (!s || s === 'uncategorized') {
                        defaultCategoryId = null;
                    } else {
                        const n = toInt(s);
                        defaultCategoryId = typeof n === 'number' ? n : null;
                    }
                }
            }
        } catch (err) {
            req.log.warn({ err }, 'import multipart parse failed');
            if (wantsJson) {
                return reply.code(400).send({ error: 'Operation failed' });
            }
            return reply.redirect('/?err=' + encodeURIComponent('文件上传失败，请重试'));
        }

        if (!fileBuf || !fileName) {
            req.log.info('import requested without file');
            if (wantsJson) {
                return reply.code(400).send({ error: 'Operation failed' });
            }
            return reply.redirect('/?err=' + encodeURIComponent('请选择要导入的文件'));
        }

        const buf = fileBuf;
        req.log.info({ filename: fileName, mimetype: fileMime, size: buf.length }, 'import file received');

        const content = decodeImportBuffer(buf);
        const contentPreview = content.substring(0, 200).replace(/\s+/g, ' ');
        const items = parseImportContent(content);

        req.log.info({ filename: fileName, contentLength: content.length, contentPreview, itemCount: items.length }, 'import parsed');

        if (typeof defaultCategoryId === 'number') {
            const exists = db.prepare('SELECT 1 AS ok FROM categories WHERE id = ?').get(defaultCategoryId) as { ok: 1 } | undefined;
            if (!exists) {
                if (wantsJson) {
                    return reply.code(404).send({ error: 'Operation failed' });
                }
                return reply.redirect('/?err=' + encodeURIComponent('默认分类不存在'));
            }
        }

        if (!items.length) {
            req.log.warn({ filename: fileName, contentPreview }, 'import failed: no items parsed');
            const errMsg = '未识别到可导入的书签。支持格式：Netscape HTML、JSON、纯文本URL列表。文件：' + fileName;
            if (wantsJson) {
                return reply.code(400).send({ error: errMsg });
            }
            return reply.redirect('/?err=' + encodeURIComponent(errMsg));
        }

        req.log.info({ skipDuplicates }, 'import options parsed');

        const job = createJob(db, 'import', '已接收文件：' + fileName);
        req.log.info({ jobId: job.id }, 'import job queued');

        jobQueue.enqueue(job.id, async () => {
            const log = app.log.child({ jobId: job.id, jobType: 'import' });
            const startedAt = Date.now();
            try {
                log.info({ itemCount: items.length, skipDuplicates, overrideCategory }, 'import job started');
                const res = await runImportJob(db, job.id, items, {
                    defaultCategoryId: overrideCategory ? defaultCategoryId : null,
                    skipDuplicates,
                    overrideCategory,
                    logger: log,
                });

                const current = getJob(db, job.id);
                if (current?.status === 'canceled') {
                    log.info({ durationMs: Date.now() - startedAt }, 'import job canceled');
                    return;
                }

                log.info({ durationMs: Date.now() - startedAt, insertedCount: res.insertedIds.length }, 'import job done');
                updateJob(db, job.id, { status: 'done' });
            } catch (err) {
                log.error({ err, durationMs: Date.now() - startedAt }, 'import job failed');
                updateJob(db, job.id, { status: 'failed', message: '导入失败' });
            }
        });

        if (wantsJson) {
            return reply.send({ jobId: job.id });
        }
        return reply.redirect('/jobs/' + job.id);
    });

    done();
};
