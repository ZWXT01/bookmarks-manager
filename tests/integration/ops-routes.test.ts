import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestAppContext } from '../helpers/app';
import { seedBookmarks, seedCategory } from '../helpers/factories';

interface TestContext extends TestAppContext {
    backupDir: string;
    snapshotsDir: string;
    envFilePath: string;
    authHeaders: Record<string, string>;
}

async function createTestContext(): Promise<TestContext> {
    const ctx = await createTestApp();
    const session = await ctx.login();

    return {
        ...ctx,
        backupDir: ctx.paths.backupDir,
        snapshotsDir: ctx.paths.snapshotsDir,
        envFilePath: ctx.paths.envFilePath,
        authHeaders: session.headers,
    };
}

describe('integration: ops routes', () => {
    let ctx: TestContext;

    beforeEach(async () => {
        ctx = await createTestContext();
    });

    afterEach(async () => {
        if (ctx) await ctx.cleanup();
    });

    it('covers settings save, read, reset, masking, and reset failure paths', async () => {
        const saveResponse = await ctx.app.inject({
            method: 'POST',
            url: '/settings',
            headers: {
                ...ctx.authHeaders,
                accept: 'application/json',
            },
            payload: {
                check_retries: '3',
                check_retry_delay_ms: '700',
                backup_enabled: 'on',
                backup_interval_minutes: '60',
                backup_retention: '5',
                periodic_check_enabled: '1',
                periodic_check_schedule: 'monthly',
                periodic_check_hour: '4',
                ai_base_url: 'https://api.example.test/v1',
                ai_api_key: 'top-secret-key',
                ai_model: 'demo-model',
                ai_batch_size: '42',
            },
        });

        expect(saveResponse.statusCode).toBe(200);
        expect(saveResponse.json()).toMatchObject({
            success: true,
            env: {
                success: true,
                updatedKeys: [
                    'CHECK_RETRIES',
                    'CHECK_RETRY_DELAY_MS',
                    'BACKUP_ENABLED',
                    'BACKUP_INTERVAL_MINUTES',
                    'BACKUP_RETENTION',
                    'PERIODIC_CHECK_ENABLED',
                    'PERIODIC_CHECK_SCHEDULE',
                    'PERIODIC_CHECK_HOUR',
                ],
            },
            saved: {
                check_retries: 3,
                check_retry_delay_ms: 700,
                backup_enabled: true,
                backup_interval_minutes: 60,
                backup_retention: 5,
                periodic_check_enabled: true,
                periodic_check_schedule: 'monthly',
                periodic_check_hour: 4,
                ai_base_url: 'https://api.example.test/v1',
                ai_model: 'demo-model',
                ai_batch_size: '30',
            },
        });

        const envBody = fs.readFileSync(ctx.envFilePath, 'utf8');
        expect(envBody).toContain('CHECK_RETRIES=3');
        expect(envBody).toContain('CHECK_RETRY_DELAY_MS=700');
        expect(envBody).toContain('BACKUP_ENABLED=1');
        expect(envBody).toContain('PERIODIC_CHECK_SCHEDULE=monthly');

        const getResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/settings',
            headers: ctx.authHeaders,
        });

        expect(getResponse.statusCode).toBe(200);
        expect(getResponse.json()).toEqual({
            check_retries: 3,
            check_retry_delay_ms: 700,
            backup_enabled: true,
            backup_interval_minutes: 60,
            backup_retention: 5,
            ai_base_url: 'https://api.example.test/v1',
            ai_api_key: '******',
            ai_model: 'demo-model',
            ai_batch_size: '30',
        });

        const resetResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/settings/reset',
            headers: ctx.authHeaders,
        });

        expect(resetResponse.statusCode).toBe(200);
        expect(resetResponse.json()).toEqual({ success: true });

        const afterReset = await ctx.app.inject({
            method: 'GET',
            url: '/api/settings',
            headers: ctx.authHeaders,
        });

        expect(afterReset.statusCode).toBe(200);
        expect(afterReset.json()).toEqual({
            check_retries: 1,
            check_retry_delay_ms: 500,
            backup_enabled: false,
            backup_interval_minutes: 1440,
            backup_retention: 10,
            ai_base_url: 'https://api.example.test/v1',
            ai_api_key: '******',
            ai_model: 'demo-model',
            ai_batch_size: '30',
        });

        ctx.db.exec('DROP TABLE settings');

        const failedReset = await ctx.app.inject({
            method: 'POST',
            url: '/api/settings/reset',
            headers: ctx.authHeaders,
        });

        expect(failedReset.statusCode).toBe(500);
        expect(failedReset.json()).toEqual({ error: '重置失败' });
    });

    it('covers template CRUD, apply/reset success, and validation/not-found branches', async () => {
        const listResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/templates',
            headers: ctx.authHeaders,
        });

        expect(listResponse.statusCode).toBe(200);
        expect(listResponse.json().templates.length).toBeGreaterThanOrEqual(4);
        const presetTemplate = listResponse.json().templates.find((template: any) => template.type === 'preset');
        expect(presetTemplate).toBeTruthy();

        const createResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/templates',
            headers: ctx.authHeaders,
            payload: {
                name: 'Ops Template',
                tree: [
                    { name: 'Work', children: [{ name: 'Docs' }] },
                    { name: 'Life', children: [{ name: 'Travel' }] },
                ],
            },
        });

        expect(createResponse.statusCode).toBe(200);
        const templateId = createResponse.json().template.id as number;

        const getResponse = await ctx.app.inject({
            method: 'GET',
            url: `/api/templates/${templateId}`,
            headers: ctx.authHeaders,
        });

        expect(getResponse.statusCode).toBe(200);
        expect(getResponse.json().template).toMatchObject({
            id: templateId,
            name: 'Ops Template',
        });
        expect(getResponse.json().template.tree).toEqual([
            { name: 'Work', children: [{ name: 'Docs' }] },
            { name: 'Life', children: [{ name: 'Travel' }] },
        ]);

        const updateResponse = await ctx.app.inject({
            method: 'PUT',
            url: `/api/templates/${templateId}`,
            headers: ctx.authHeaders,
            payload: {
                name: 'Ops Template v2',
                tree: [
                    { name: 'Projects', children: [{ name: 'Alpha' }] },
                ],
            },
        });

        expect(updateResponse.statusCode).toBe(200);
        expect(updateResponse.json().template).toMatchObject({
            id: templateId,
            name: 'Ops Template v2',
        });

        const applyResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/templates/${templateId}/apply`,
            headers: ctx.authHeaders,
        });

        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toEqual({ success: true });
        expect(ctx.db.prepare('SELECT id FROM category_templates WHERE is_active = 1').get()).toEqual({ id: templateId });
        expect(ctx.db.prepare('SELECT name FROM categories WHERE parent_id IS NULL ORDER BY name').all()).toEqual([{ name: 'Projects' }]);
        expect(ctx.db.prepare('SELECT name FROM categories WHERE parent_id IS NOT NULL ORDER BY name').all()).toEqual([{ name: 'Projects/Alpha' }]);

        seedCategory(ctx.db, 'Extra');

        const resetResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/templates/${templateId}/reset`,
            headers: ctx.authHeaders,
        });

        expect(resetResponse.statusCode).toBe(200);
        expect(resetResponse.json()).toEqual({ success: true });
        expect(ctx.db.prepare('SELECT id FROM categories WHERE name = ?').get('Extra')).toBeUndefined();
        expect(ctx.db.prepare('SELECT name FROM categories WHERE parent_id IS NULL ORDER BY name').all()).toEqual([{ name: 'Projects' }]);

        const secondTemplate = await ctx.app.inject({
            method: 'POST',
            url: '/api/templates',
            headers: ctx.authHeaders,
            payload: {
                name: 'Switch Template',
                tree: [{ name: 'Reference', children: [{ name: 'Links' }] }],
            },
        });
        const secondTemplateId = secondTemplate.json().template.id as number;

        const applySecondResponse = await ctx.app.inject({
            method: 'POST',
            url: `/api/templates/${secondTemplateId}/apply`,
            headers: ctx.authHeaders,
        });

        expect(applySecondResponse.statusCode).toBe(200);

        const deleteResponse = await ctx.app.inject({
            method: 'DELETE',
            url: `/api/templates/${templateId}`,
            headers: ctx.authHeaders,
        });

        expect(deleteResponse.statusCode).toBe(200);
        expect(deleteResponse.json()).toEqual({ success: true });

        const missingAfterDelete = await ctx.app.inject({
            method: 'GET',
            url: `/api/templates/${templateId}`,
            headers: ctx.authHeaders,
        });

        expect(missingAfterDelete.statusCode).toBe(404);
        expect(missingAfterDelete.json()).toEqual({ error: 'template not found' });

        const invalidId = await ctx.app.inject({
            method: 'GET',
            url: '/api/templates/not-a-number',
            headers: ctx.authHeaders,
        });
        expect(invalidId.statusCode).toBe(400);
        expect(invalidId.json()).toEqual({ error: 'invalid id' });

        const missingTemplate = await ctx.app.inject({
            method: 'DELETE',
            url: '/api/templates/999999',
            headers: ctx.authHeaders,
        });
        expect(missingTemplate.statusCode).toBe(404);
        expect(missingTemplate.json()).toEqual({ error: 'template not found' });

        const invalidTree = await ctx.app.inject({
            method: 'POST',
            url: '/api/templates',
            headers: ctx.authHeaders,
            payload: {
                name: 'Broken Template',
                tree: [
                    { name: 'Dup', children: [] },
                    { name: 'Dup', children: [] },
                ],
            },
        });
        expect(invalidTree.statusCode).toBe(400);
        expect(invalidTree.json().error).toContain('duplicate top-level: Dup');

        const presetUpdate = await ctx.app.inject({
            method: 'PUT',
            url: `/api/templates/${presetTemplate.id}`,
            headers: ctx.authHeaders,
            payload: { name: 'Blocked' },
        });
        expect(presetUpdate.statusCode).toBe(403);
        expect(presetUpdate.json()).toEqual({ error: 'preset templates cannot be updated' });

        const presetApply = await ctx.app.inject({
            method: 'POST',
            url: `/api/templates/${presetTemplate.id}/apply`,
            headers: ctx.authHeaders,
        });
        expect(presetApply.statusCode).toBe(403);
        expect(presetApply.json().error).toContain('Preset templates are read-only references');

        const inactiveTemplate = await ctx.app.inject({
            method: 'POST',
            url: '/api/templates',
            headers: ctx.authHeaders,
            payload: {
                name: 'Inactive Template',
                tree: [{ name: 'Archive', children: [] }],
            },
        });
        const inactiveTemplateId = inactiveTemplate.json().template.id as number;

        const resetInactive = await ctx.app.inject({
            method: 'POST',
            url: `/api/templates/${inactiveTemplateId}/reset`,
            headers: ctx.authHeaders,
        });
        expect(resetInactive.statusCode).toBe(403);
        expect(resetInactive.json()).toEqual({ error: 'Only the currently active template can be reset' });
    });

    it('covers snapshot save/list/view/delete/batch-delete success and validation branches', async () => {
        const [bookmarkId] = seedBookmarks(ctx.db, [
            {
                url: 'https://matched.example.com/article',
                title: 'Matched Bookmark',
            },
        ]);

        const createResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/snapshots',
            headers: ctx.authHeaders,
            payload: {
                url: 'https://matched.example.com/article',
                title: 'Matched Snapshot',
                content: '<!doctype html><html><body>matched</body></html>',
            },
        });

        expect(createResponse.statusCode).toBe(200);
        expect(createResponse.json()).toMatchObject({
            success: true,
            snapshot: {
                bookmark_id: bookmarkId,
            },
        });
        const firstSnapshot = createResponse.json().snapshot;
        expect(fs.existsSync(path.join(ctx.snapshotsDir, firstSnapshot.filename))).toBe(true);

        const filteredList = await ctx.app.inject({
            method: 'GET',
            url: `/api/snapshots?bookmark_id=${bookmarkId}`,
            headers: ctx.authHeaders,
        });

        expect(filteredList.statusCode).toBe(200);
        expect(filteredList.json().snapshots).toHaveLength(1);
        expect(filteredList.json().snapshots[0].id).toBe(firstSnapshot.id);

        const viewResponse = await ctx.app.inject({
            method: 'GET',
            url: `/snapshots/${firstSnapshot.filename}`,
            headers: ctx.authHeaders,
        });

        expect(viewResponse.statusCode).toBe(200);
        expect(viewResponse.headers['content-type']).toContain('text/html');
        expect(viewResponse.body).toContain('matched');

        const secondSnapshotResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/snapshots',
            headers: ctx.authHeaders,
            payload: {
                url: 'https://unmatched.example.com/article',
                title: 'Unmatched Snapshot',
                content: '<!doctype html><html><body>other</body></html>',
            },
        });

        expect(secondSnapshotResponse.statusCode).toBe(200);
        const secondSnapshot = secondSnapshotResponse.json().snapshot;
        expect(secondSnapshot.bookmark_id).toBe(null);

        const deleteResponse = await ctx.app.inject({
            method: 'DELETE',
            url: `/api/snapshots/${firstSnapshot.id}`,
            headers: ctx.authHeaders,
        });

        expect(deleteResponse.statusCode).toBe(200);
        expect(deleteResponse.json()).toEqual({ success: true });
        expect(fs.existsSync(path.join(ctx.snapshotsDir, firstSnapshot.filename))).toBe(false);

        const batchDeleteResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/snapshots/batch-delete',
            headers: ctx.authHeaders,
            payload: {
                ids: [secondSnapshot.id, 'bad-id', 999999],
            },
        });

        expect(batchDeleteResponse.statusCode).toBe(200);
        expect(batchDeleteResponse.json()).toEqual({ success: true, deleted: 1 });
        expect(fs.existsSync(path.join(ctx.snapshotsDir, secondSnapshot.filename))).toBe(false);

        const missingUrl = await ctx.app.inject({
            method: 'POST',
            url: '/api/snapshots',
            headers: ctx.authHeaders,
            payload: {
                title: 'Broken Snapshot',
                content: '<html></html>',
            },
        });
        expect(missingUrl.statusCode).toBe(400);
        expect(missingUrl.json()).toEqual({ error: '缺少 URL' });

        const missingContent = await ctx.app.inject({
            method: 'POST',
            url: '/api/snapshots',
            headers: ctx.authHeaders,
            payload: {
                url: 'https://missing-content.example.com',
                title: 'Broken Snapshot',
            },
        });
        expect(missingContent.statusCode).toBe(400);
        expect(missingContent.json()).toEqual({ error: '缺少快照内容' });

        const invalidFilename = await ctx.app.inject({
            method: 'GET',
            url: '/snapshots/bad.txt',
            headers: ctx.authHeaders,
        });
        expect(invalidFilename.statusCode).toBe(400);
        expect(invalidFilename.json()).toEqual({ error: '无效的文件名' });

        const missingFile = await ctx.app.inject({
            method: 'GET',
            url: '/snapshots/missing-file.html',
            headers: ctx.authHeaders,
        });
        expect(missingFile.statusCode).toBe(404);
        expect(missingFile.json()).toEqual({ error: '快照不存在' });

        const invalidDelete = await ctx.app.inject({
            method: 'DELETE',
            url: '/api/snapshots/not-a-number',
            headers: ctx.authHeaders,
        });
        expect(invalidDelete.statusCode).toBe(400);
        expect(invalidDelete.json()).toEqual({ error: '无效的 ID' });

        const missingDelete = await ctx.app.inject({
            method: 'DELETE',
            url: '/api/snapshots/999999',
            headers: ctx.authHeaders,
        });
        expect(missingDelete.statusCode).toBe(404);
        expect(missingDelete.json()).toEqual({ error: '快照不存在' });

        const missingIds = await ctx.app.inject({
            method: 'POST',
            url: '/api/snapshots/batch-delete',
            headers: ctx.authHeaders,
            payload: {},
        });
        expect(missingIds.statusCode).toBe(400);
        expect(missingIds.json()).toEqual({ error: '缺少 ids 参数' });
    });

    it('covers backup list/run/delete and partial-restore contract with isolated data', async () => {
        const emptyListResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/backups',
            headers: ctx.authHeaders,
        });

        expect(emptyListResponse.statusCode).toBe(200);
        expect(emptyListResponse.json()).toEqual({ backups: [] });

        const skippedBackup = await ctx.app.inject({
            method: 'POST',
            url: '/api/backups/run',
            headers: ctx.authHeaders,
        });

        expect(skippedBackup.statusCode).toBe(200);
        expect(skippedBackup.json()).toEqual({
            success: true,
            skipped: true,
            message: '当前无书签，跳过备份',
        });

        const originalCategoryId = seedCategory(ctx.db, 'Original Category');
        const [originalBookmarkId] = seedBookmarks(ctx.db, [
            { url: 'https://backup.example.com', title: 'Backup target', categoryId: originalCategoryId },
        ]);

        const createdBackup = await ctx.app.inject({
            method: 'POST',
            url: '/api/backups/run',
            headers: ctx.authHeaders,
        });

        expect(createdBackup.statusCode).toBe(200);
        expect(createdBackup.json().success).toBe(true);
        expect(createdBackup.json().backup).toMatch(/^manual_\d{8}_\d{6}\.db$/);
        const backupName = createdBackup.json().backup as string;
        const backupPath = path.join(ctx.backupDir, backupName);
        expect(fs.existsSync(backupPath)).toBe(true);

        const invalidDownload = await ctx.app.inject({
            method: 'GET',
            url: '/backups/bad.txt',
            headers: ctx.authHeaders,
        });
        expect(invalidDownload.statusCode).toBe(400);
        expect(invalidDownload.json()).toEqual({ error: '无效的文件名' });

        const missingDownload = await ctx.app.inject({
            method: 'GET',
            url: '/backups/manual_20990101_000000.db',
            headers: ctx.authHeaders,
        });
        expect(missingDownload.statusCode).toBe(404);
        expect(missingDownload.json()).toEqual({ error: '备份不存在' });

        const downloadResponse = await ctx.app.inject({
            method: 'GET',
            url: `/backups/${backupName}`,
            headers: ctx.authHeaders,
        });

        expect(downloadResponse.statusCode).toBe(200);
        expect(downloadResponse.headers['content-disposition']).toContain(backupName);
        expect(downloadResponse.rawPayload.length).toBeGreaterThan(0);

        const invalidDelete = await ctx.app.inject({
            method: 'DELETE',
            url: '/api/backups/bad.txt',
            headers: ctx.authHeaders,
        });
        expect(invalidDelete.statusCode).toBe(400);
        expect(invalidDelete.json()).toEqual({ error: '无效的文件名' });

        const missingDelete = await ctx.app.inject({
            method: 'DELETE',
            url: '/api/backups/manual_20990101_000000.db',
            headers: ctx.authHeaders,
        });
        expect(missingDelete.statusCode).toBe(404);
        expect(missingDelete.json()).toEqual({ error: '备份不存在' });

        ctx.db.prepare(`
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run('check_retries', '9');

        const snapshotResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/snapshots',
            headers: ctx.authHeaders,
            payload: {
                url: 'https://snapshot-only.example.com/article',
                title: 'Preserved Snapshot',
                content: '<!doctype html><html><body>snapshot-only</body></html>',
            },
        });
        expect(snapshotResponse.statusCode).toBe(200);
        const preservedSnapshot = snapshotResponse.json().snapshot as { id: number; filename: string; bookmark_id: number | null };
        expect(preservedSnapshot.bookmark_id).toBe(null);
        expect(fs.existsSync(path.join(ctx.snapshotsDir, preservedSnapshot.filename))).toBe(true);

        const transientCategoryId = seedCategory(ctx.db, 'Transient Category');
        const [transientBookmarkId] = seedBookmarks(ctx.db, [
            { url: 'https://transient.example.com', title: 'Transient Bookmark', categoryId: transientCategoryId },
        ]);

        const invalidRestoreName = await ctx.app.inject({
            method: 'POST',
            url: '/api/backups/restore',
            headers: ctx.authHeaders,
            payload: {},
        });
        expect(invalidRestoreName.statusCode).toBe(400);
        expect(invalidRestoreName.json()).toEqual({ error: '无效的备份名称' });

        const missingRestore = await ctx.app.inject({
            method: 'POST',
            url: '/api/backups/restore',
            headers: ctx.authHeaders,
            payload: { name: 'manual_20990101_000000.db' },
        });
        expect(missingRestore.statusCode).toBe(404);
        expect(missingRestore.json()).toEqual({ error: '备份不存在' });

        const restoreResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/backups/restore',
            headers: ctx.authHeaders,
            payload: { name: backupName },
        });
        expect(restoreResponse.statusCode).toBe(200);
        expect(restoreResponse.json()).toMatchObject({
            success: true,
            message: `已从 ${backupName} 还原分类与书签`,
            restored_tables: ['categories', 'bookmarks'],
            preserved_assets: ['snapshots/*.html'],
        });
        expect(restoreResponse.json().preserved_tables).toEqual(expect.arrayContaining(['settings', 'snapshots']));
        expect(restoreResponse.json().pre_restore_backup).toMatch(/^pre_restore_\d{8}_\d{6}\.db$/);

        const preRestoreBackupName = restoreResponse.json().pre_restore_backup as string;
        const preRestoreBackupPath = path.join(ctx.backupDir, preRestoreBackupName);
        expect(fs.existsSync(preRestoreBackupPath)).toBe(true);

        expect(ctx.db.prepare('SELECT name FROM categories ORDER BY id').all()).toEqual([
            { name: 'Original Category' },
        ]);
        expect(ctx.db.prepare('SELECT id, title FROM bookmarks ORDER BY id').all()).toEqual([
            { id: originalBookmarkId, title: 'Backup target' },
        ]);
        expect(ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get('check_retries')).toEqual({ value: '9' });
        expect(ctx.db.prepare('SELECT id, filename, bookmark_id FROM snapshots WHERE id = ?').get(preservedSnapshot.id)).toEqual({
            id: preservedSnapshot.id,
            filename: preservedSnapshot.filename,
            bookmark_id: null,
        });
        expect(fs.existsSync(path.join(ctx.snapshotsDir, preservedSnapshot.filename))).toBe(true);
        expect(ctx.db.prepare('SELECT id FROM bookmarks WHERE id = ?').get(transientBookmarkId)).toBeUndefined();
        expect(ctx.db.prepare('SELECT id FROM categories WHERE id = ?').get(transientCategoryId)).toBeUndefined();

        const listAfterRestore = await ctx.app.inject({
            method: 'GET',
            url: '/api/backups',
            headers: ctx.authHeaders,
        });

        expect(listAfterRestore.statusCode).toBe(200);
        expect(listAfterRestore.json().backups).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: backupName, type: 'manual' }),
            expect.objectContaining({ name: preRestoreBackupName, type: 'pre_restore' }),
        ]));

        const rollbackResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/backups/restore',
            headers: ctx.authHeaders,
            payload: { name: preRestoreBackupName },
        });
        expect(rollbackResponse.statusCode).toBe(200);
        expect(ctx.db.prepare('SELECT id, title FROM bookmarks WHERE id = ?').get(transientBookmarkId)).toEqual({
            id: transientBookmarkId,
            title: 'Transient Bookmark',
        });
        expect(ctx.db.prepare('SELECT id, name FROM categories WHERE id = ?').get(transientCategoryId)).toEqual({
            id: transientCategoryId,
            name: 'Transient Category',
        });
        expect(ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get('check_retries')).toEqual({ value: '9' });
        expect(fs.existsSync(path.join(ctx.snapshotsDir, preservedSnapshot.filename))).toBe(true);

        const brokenBackupName = 'manual_20260328_123456.db';
        fs.mkdirSync(ctx.backupDir, { recursive: true });
        fs.writeFileSync(path.join(ctx.backupDir, brokenBackupName), 'not-a-real-sqlite-db', 'utf8');

        const brokenRestore = await ctx.app.inject({
            method: 'POST',
            url: '/api/backups/restore',
            headers: ctx.authHeaders,
            payload: { name: brokenBackupName },
        });
        expect(brokenRestore.statusCode).toBe(500);
        expect(brokenRestore.json().error).toContain('还原失败:');

        const deleteResponse = await ctx.app.inject({
            method: 'DELETE',
            url: `/api/backups/${backupName}`,
            headers: ctx.authHeaders,
        });

        expect(deleteResponse.statusCode).toBe(200);
        expect(deleteResponse.json()).toEqual({ success: true });
        expect(fs.existsSync(backupPath)).toBe(false);
    });
});
