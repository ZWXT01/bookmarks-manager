/**
 * Settings API Routes
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { toIntClamp } from './types';

export interface SettingsRoutesOptions {
    db: Database;
    envFilePath: string;
    dbPath: string;
    backupDir: string;
    checkRetries: number;
    checkRetryDelayMs: number;
    backupEnabled: boolean;
    backupIntervalMinutes: number;
    backupRetention: number;
    periodicCheckEnabled: boolean;
    periodicCheckSchedule: string;
    periodicCheckHour: number;
    getSetting: (key: string) => string | null;
    setSetting: (key: string, value: string) => void;
    getIntSetting: (key: string, min: number, max: number, fallback: number) => number;
    getBoolSetting: (key: string, fallback: boolean) => boolean;
    effectiveCheckRetries: (fallback: number) => number;
    effectiveCheckRetryDelayMs: (fallback: number) => number;
    effectiveBackupEnabled: (fallback: boolean) => boolean;
    effectiveBackupIntervalMinutes: (fallback: number) => number;
    effectiveBackupRetention: (fallback: number) => number;
    effectivePeriodicCheckSchedule: (fallback: string) => string;
    effectivePeriodicCheckHour: (fallback: number) => number;
    writeDotEnvFile: (envFilePath: string, updates: Record<string, string>) => void;
}

export const settingsRoutes: FastifyPluginCallback<SettingsRoutesOptions> = (app, opts, done) => {
    const {
        db, envFilePath, dbPath, backupDir,
        checkRetries, checkRetryDelayMs, backupEnabled, backupIntervalMinutes, backupRetention,
        periodicCheckEnabled, periodicCheckSchedule, periodicCheckHour,
        getSetting, setSetting, getIntSetting, getBoolSetting,
        effectiveCheckRetries, effectiveCheckRetryDelayMs, effectiveBackupEnabled,
        effectiveBackupIntervalMinutes, effectiveBackupRetention,
        effectivePeriodicCheckSchedule, effectivePeriodicCheckHour,
        writeDotEnvFile,
    } = opts;

    // GET /settings - 设置页面
    app.get('/settings', async (req: FastifyRequest, reply: FastifyReply) => {
        const curCheckRetries = getIntSetting('check_retries', 0, 5, checkRetries);
        const curCheckRetryDelayMs = getIntSetting('check_retry_delay_ms', 0, 10_000, checkRetryDelayMs);
        const curBackupEnabled = getBoolSetting('backup_enabled', backupEnabled);
        const curBackupIntervalMinutes = getIntSetting('backup_interval_minutes', 1, 525_600, backupIntervalMinutes);
        const curBackupRetention = getIntSetting('backup_retention', 1, 365, backupRetention);
        const curPeriodicCheckEnabled = getBoolSetting('periodic_check_enabled', periodicCheckEnabled);
        const curPeriodicCheckSchedule = effectivePeriodicCheckSchedule(periodicCheckSchedule);
        const curPeriodicCheckHour = effectivePeriodicCheckHour(periodicCheckHour);

        const checkEnvOverride = process.env.CHECK_RETRIES !== undefined || process.env.CHECK_RETRY_DELAY_MS !== undefined;
        const backupEnvOverride = process.env.BACKUP_ENABLED !== undefined ||
            process.env.BACKUP_INTERVAL_MINUTES !== undefined || process.env.BACKUP_RETENTION !== undefined;

        const aiBaseUrl = getSetting('ai_base_url') ?? '';
        const aiApiKey = getSetting('ai_api_key') ?? '';
        const aiModel = getSetting('ai_model') ?? '';
        const aiBatchSize = getSetting('ai_batch_size') ?? '30';

        return reply.view('settings.ejs', {
            curCheckRetries, curCheckRetryDelayMs, curBackupEnabled, curBackupIntervalMinutes, curBackupRetention,
            curPeriodicCheckEnabled, curPeriodicCheckSchedule, curPeriodicCheckHour,
            checkEnvOverride, backupEnvOverride, aiBaseUrl, aiApiKey, aiModel, aiBatchSize,
            envFilePath, dbPath, backupDir,
        });
    });

    // POST /settings - 保存设置
    app.post('/settings', async (req: FastifyRequest, reply: FastifyReply) => {
        const wantsJson = /application\/json/i.test((req.headers as any)?.accept || '');
        const body: any = req.body || {};
        try {
            const retries = toIntClamp(body.check_retries, 0, 5, effectiveCheckRetries(checkRetries));
            const delayMs = toIntClamp(body.check_retry_delay_ms, 0, 10_000, effectiveCheckRetryDelayMs(checkRetryDelayMs));
            setSetting('check_retries', String(retries));
            setSetting('check_retry_delay_ms', String(delayMs));

            const backupEnabledVal = typeof body.backup_enabled === 'string' ? body.backup_enabled : '';
            const backupEnabledBool = backupEnabledVal === '1' || backupEnabledVal === 'true' || backupEnabledVal === 'on';
            const backupInterval = toIntClamp(body.backup_interval_minutes, 1, 525_600, effectiveBackupIntervalMinutes(backupIntervalMinutes));
            const backupRet = toIntClamp(body.backup_retention, 1, 365, effectiveBackupRetention(backupRetention));
            setSetting('backup_enabled', backupEnabledBool ? '1' : '0');
            setSetting('backup_interval_minutes', String(backupInterval));
            setSetting('backup_retention', String(backupRet));

            const periodicCheckEnabledVal = typeof body.periodic_check_enabled === 'string' ? body.periodic_check_enabled : '';
            const periodicCheckEnabledBool = periodicCheckEnabledVal === '1' || periodicCheckEnabledVal === 'true' || periodicCheckEnabledVal === 'on';
            const periodicCheckScheduleVal = typeof body.periodic_check_schedule === 'string' ? body.periodic_check_schedule : 'weekly';
            const actualSchedule = periodicCheckScheduleVal === 'monthly' ? 'monthly' : 'weekly';
            const periodicCheckHourVal = toIntClamp(body.periodic_check_hour, 2, 5, 2);
            setSetting('periodic_check_enabled', periodicCheckEnabledBool ? '1' : '0');
            setSetting('periodic_check_schedule', actualSchedule);
            setSetting('periodic_check_hour', String(periodicCheckHourVal));

            const aiBaseUrl = typeof body.ai_base_url === 'string' ? body.ai_base_url.trim() : '';
            const aiApiKey = typeof body.ai_api_key === 'string' ? body.ai_api_key.trim() : '';
            const aiModel = typeof body.ai_model === 'string' ? body.ai_model.trim() : '';
            const aiBatchSize = typeof body.ai_batch_size === 'string' ? body.ai_batch_size.trim() : '30';
            setSetting('ai_base_url', aiBaseUrl);
            setSetting('ai_api_key', aiApiKey);
            setSetting('ai_model', aiModel);
            setSetting('ai_batch_size', aiBatchSize);

            let envResult: any = { success: true, path: envFilePath, updatedKeys: [] as string[] };
            try {
                const updates: Record<string, string> = {
                    CHECK_RETRIES: String(retries),
                    CHECK_RETRY_DELAY_MS: String(delayMs),
                    BACKUP_ENABLED: backupEnabledBool ? '1' : '0',
                    BACKUP_INTERVAL_MINUTES: String(backupInterval),
                    BACKUP_RETENTION: String(backupRet),
                    PERIODIC_CHECK_ENABLED: periodicCheckEnabledBool ? '1' : '0',
                    PERIODIC_CHECK_SCHEDULE: actualSchedule,
                    PERIODIC_CHECK_HOUR: String(periodicCheckHourVal),
                };
                envResult.updatedKeys = Object.keys(updates);
                writeDotEnvFile(envFilePath, updates);
            } catch (e: any) {
                envResult = { success: false, path: envFilePath, error: e?.message || '写入失败' };
                req.log.warn({ err: e, envFilePath }, 'write .env failed');
            }

            if (wantsJson) {
                return reply.send({
                    success: true, env: envResult,
                    saved: {
                        check_retries: retries, check_retry_delay_ms: delayMs,
                        backup_enabled: backupEnabledBool, backup_interval_minutes: backupInterval, backup_retention: backupRet,
                        periodic_check_enabled: periodicCheckEnabledBool, periodic_check_schedule: actualSchedule, periodic_check_hour: periodicCheckHourVal,
                        ai_base_url: aiBaseUrl, ai_model: aiModel,
                    },
                });
            }
            return reply.redirect('/settings');
        } catch (e: any) {
            req.log.error({ err: e }, 'save settings failed');
            if (wantsJson) return reply.code(500).send({ error: '保存失败' });
            return reply.redirect('/settings');
        }
    });

    // GET /api/settings
    app.get('/api/settings', async (_req: FastifyRequest, reply: FastifyReply) => {
        const aiApiKey = getSetting('ai_api_key') ?? '';
        return reply.send({
            check_retries: effectiveCheckRetries(checkRetries),
            check_retry_delay_ms: effectiveCheckRetryDelayMs(checkRetryDelayMs),
            backup_enabled: effectiveBackupEnabled(backupEnabled),
            backup_interval_minutes: effectiveBackupIntervalMinutes(backupIntervalMinutes),
            backup_retention: effectiveBackupRetention(backupRetention),
            ai_base_url: getSetting('ai_base_url') ?? '',
            ai_api_key: aiApiKey ? '******' : '',
            ai_model: getSetting('ai_model') ?? '',
            ai_batch_size: getSetting('ai_batch_size') ?? '30',
        });
    });

    // POST /api/settings/reset
    app.post('/api/settings/reset', async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            db.prepare("DELETE FROM settings WHERE key IN ('check_retries', 'check_retry_delay_ms', 'backup_enabled', 'backup_interval_minutes', 'backup_retention', 'periodic_check_enabled', 'periodic_check_schedule', 'periodic_check_hour')").run();
            req.log.info('settings reset to default');
            return reply.send({ success: true });
        } catch (e: any) {
            req.log.error({ err: e }, 'reset settings failed');
            return reply.code(500).send({ error: '重置失败' });
        }
    });

    done();
};
