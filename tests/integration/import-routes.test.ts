import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getJob, jobQueue } from '../../src/jobs';
import { createTestApp, type TestAppContext } from '../helpers/app';
import { seedBookmarks, seedCategory } from '../helpers/factories';

interface MultipartPart {
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
}

function buildMultipartBody(parts: MultipartPart[]): { boundary: string; body: Buffer } {
    const boundary = `----codex-boundary-${Date.now()}`;
    const chunks: Buffer[] = [];

    for (const part of parts) {
        chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));

        const disposition = [`form-data; name="${part.name}"`];
        if (part.filename) disposition.push(`filename="${part.filename}"`);
        chunks.push(Buffer.from(`Content-Disposition: ${disposition.join('; ')}\r\n`, 'utf8'));

        if (part.filename) {
            chunks.push(Buffer.from(`Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n`, 'utf8'));
        }

        chunks.push(Buffer.from('\r\n', 'utf8'));
        chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value, 'utf8'));
        chunks.push(Buffer.from('\r\n', 'utf8'));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return { boundary, body: Buffer.concat(chunks) };
}

describe('integration: import routes', () => {
    let ctx: TestAppContext;
    let authHeaders: Record<string, string>;

    beforeEach(async () => {
        ctx = await createTestApp();
        const session = await ctx.login();
        authHeaders = session.headers;
    });

    afterEach(async () => {
        if (ctx) await ctx.cleanup();
    });

    async function postMultipart(parts: MultipartPart[]) {
        const { boundary, body } = buildMultipartBody(parts);

        return ctx.app.inject({
            method: 'POST',
            url: '/import',
            headers: {
                ...authHeaders,
                accept: 'application/json',
                'content-type': `multipart/form-data; boundary=${boundary}`,
                'content-length': String(body.length),
            },
            payload: body,
        });
    }

    it('imports Netscape HTML and records a finished job', async () => {
        const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Tech</H3>
  <DL><p>
    <DT><A HREF="https://html.example.com">HTML Example</A>
  </DL><p>
</DL><p>`;

        const response = await postMultipart([{
            name: 'file',
            filename: 'bookmarks.html',
            contentType: 'text/html',
            value: html,
        }]);

        expect(response.statusCode).toBe(200);
        const { jobId } = response.json() as { jobId: string };

        await jobQueue.onIdle();

        const job = getJob(ctx.db, jobId);
        expect(job).not.toBeNull();
        expect(job).toMatchObject({
            status: 'done',
            processed: 1,
            inserted: 1,
            skipped: 0,
            failed: 0,
        });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count).toBe(1);
    });

    it('imports JSON uploads and records a finished job', async () => {
        const json = JSON.stringify([
            {
                url: 'https://json.example.com',
                title: 'JSON Example',
                category: 'Notes/Reference',
            },
        ]);

        const response = await postMultipart([{
            name: 'file',
            filename: 'bookmarks.json',
            contentType: 'application/json',
            value: json,
        }]);

        expect(response.statusCode).toBe(200);
        const { jobId } = response.json() as { jobId: string };

        await jobQueue.onIdle();

        const job = getJob(ctx.db, jobId);
        expect(job).not.toBeNull();
        expect(job).toMatchObject({
            status: 'done',
            processed: 1,
            inserted: 1,
            skipped: 0,
            failed: 0,
        });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count).toBe(1);
    });

    it('imports plain-text uploads and records a finished job', async () => {
        const response = await postMultipart([{
            name: 'file',
            filename: 'bookmarks.txt',
            contentType: 'text/plain',
            value: 'https://text.example.com\n',
        }]);

        expect(response.statusCode).toBe(200);
        const { jobId } = response.json() as { jobId: string };

        await jobQueue.onIdle();

        const job = getJob(ctx.db, jobId);
        expect(job).not.toBeNull();
        expect(job).toMatchObject({
            status: 'done',
            processed: 1,
            inserted: 1,
            skipped: 0,
            failed: 0,
        });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count).toBe(1);
    });

    it('rejects missing files, empty files, and unparseable content', async () => {
        const missingFile = await postMultipart([{
            name: 'skipDuplicates',
            value: '1',
        }]);
        expect(missingFile.statusCode).toBe(400);
        expect(missingFile.json()).toEqual({ error: 'Operation failed' });

        const emptyFile = await postMultipart([{
            name: 'file',
            filename: 'empty.txt',
            contentType: 'text/plain',
            value: Buffer.alloc(0),
        }]);
        expect(emptyFile.statusCode).toBe(400);
        expect(emptyFile.json().error).toContain('未识别到可导入的书签');

        const invalidContent = await postMultipart([{
            name: 'file',
            filename: 'broken.json',
            contentType: 'application/json',
            value: '{"bookmarks": [',
        }]);
        expect(invalidContent.statusCode).toBe(400);
        expect(invalidContent.json().error).toContain('未识别到可导入的书签');
    });

    it('covers skipDuplicates on and off and keeps side-effect counts stable', async () => {
        seedBookmarks(ctx.db, [{ url: 'https://dup.example.com', title: 'Existing' }]);

        const skipOn = await postMultipart([
            {
                name: 'file',
                filename: 'skip-on.json',
                contentType: 'application/json',
                value: JSON.stringify([{ url: 'https://dup.example.com', title: 'Duplicate' }]),
            },
            { name: 'skipDuplicates', value: '1' },
        ]);
        expect(skipOn.statusCode).toBe(200);
        await jobQueue.onIdle();

        const skipOnJob = getJob(ctx.db, skipOn.json().jobId as string);
        expect(skipOnJob).toMatchObject({
            status: 'done',
            processed: 1,
            inserted: 0,
            skipped: 1,
            failed: 0,
        });

        const skipOff = await postMultipart([
            {
                name: 'file',
                filename: 'skip-off.json',
                contentType: 'application/json',
                value: JSON.stringify([{ url: 'https://dup.example.com', title: 'Duplicate Again' }]),
            },
            { name: 'skipDuplicates', value: '0' },
        ]);
        expect(skipOff.statusCode).toBe(200);
        await jobQueue.onIdle();

        const skipOffJob = getJob(ctx.db, skipOff.json().jobId as string);
        expect(skipOffJob).toMatchObject({
            status: 'done',
            processed: 1,
            inserted: 1,
            skipped: 0,
            failed: 0,
        });
        expect((ctx.db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get() as { count: number }).count).toBe(2);
    });

    it('respects overrideCategory when a default category is provided', async () => {
        const defaultCategoryId = seedCategory(ctx.db, 'Inbox');

        const keepOriginal = await postMultipart([
            {
                name: 'file',
                filename: 'keep-original.json',
                contentType: 'application/json',
                value: JSON.stringify([{ url: 'https://keep.example.com', title: 'Keep', category: 'Imported/Docs' }]),
            },
            { name: 'defaultCategoryId', value: String(defaultCategoryId) },
            { name: 'overrideCategory', value: '0' },
        ]);
        expect(keepOriginal.statusCode).toBe(200);
        await jobQueue.onIdle();

        const keepBookmark = ctx.db.prepare('SELECT category_id FROM bookmarks WHERE url = ?').get('https://keep.example.com') as { category_id: number | null };
        const importedCategory = ctx.db.prepare('SELECT id FROM categories WHERE name = ?').get('Imported/Docs') as { id: number };
        expect(keepBookmark.category_id).toBe(importedCategory.id);

        const categoryCountAfterKeep = (ctx.db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number }).count;

        const override = await postMultipart([
            {
                name: 'file',
                filename: 'override.json',
                contentType: 'application/json',
                value: JSON.stringify([{ url: 'https://override.example.com', title: 'Override', category: 'Imported/Docs' }]),
            },
            { name: 'defaultCategoryId', value: String(defaultCategoryId) },
            { name: 'overrideCategory', value: '1' },
        ]);
        expect(override.statusCode).toBe(200);
        await jobQueue.onIdle();

        const overrideBookmark = ctx.db.prepare('SELECT category_id FROM bookmarks WHERE url = ?').get('https://override.example.com') as { category_id: number | null };
        const categoryCountAfterOverride = (ctx.db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number }).count;

        expect(overrideBookmark.category_id).toBe(defaultCategoryId);
        expect(categoryCountAfterOverride).toBe(categoryCountAfterKeep);
    });
});
