import path from 'path';

import fs from 'fs';

import { randomUUID } from 'crypto';

import OpenAI from 'openai';

import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import type { MultipartFile } from '@fastify/multipart';
import session from '@fastify/session';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import ejs from 'ejs';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import iconv from 'iconv-lite';

import { checkAuth, validateCredentials, initUserTable, changePassword, getUserInfo, getClientIp, createApiToken, listApiTokens, deleteApiToken, validateApiToken, cleanupExpiredTokens } from './auth';

import { openDb } from './db';
import { canonicalizeUrl } from './url';
import {
  countJobFailures,
  createJob,
  getJob,
  jobQueue,
  listJobFailuresPaged,
  pruneJobsToRecent,
  setJobQueueLogger,
  subscribeJob,
  updateJob,
} from './jobs';
import { queryExportRows, buildNetscapeHtml } from './exporter';
import { parseImportContent, runImportJob } from './importer';
import { runCheckJob } from './checker';
import { runAIClassifyJob } from './ai-classify-job';
import { runAISimplifyJob, getSimplifyMappings, getSimplifyMappingsByJobId, applyOneSimplifyMapping, applyAllSimplifyMappings } from './ai-simplify-job';

type CategoryRow = { id: number; name: string; count: number };

type CategoryEditRow = { id: number; name: string };

type BookmarkRow = {
  id: number;
  url: string;
  title: string;
  category_name: string | null;
  created_at: string;
  check_status: string;
  last_checked_at: string | null;
  check_http_code: number | null;
  check_error: string | null;
};

type BookmarkEditRow = {
  id: number;
  url: string;
  title: string;
  category_id: number | null;
};

function toInt(value: unknown): number | null {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0) return value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return null;
}

function toIntClamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}

function escapeLikePattern(input: string): string {
  return input.replace(/[%_]/g, '\\$&');
}

function validateStringLength(value: string, maxLength: number, fieldName: string): void {
  if (value.length > maxLength) {
    throw new Error(fieldName + '长度不能超过' + maxLength + '个字符');
  }
}

function decodeImportBuffer(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  const gbk = iconv.decode(buf, 'gbk');

  const badUtf8 = (utf8.match(/\uFFFD/g) || []).length;
  const badGbk = (gbk.match(/\uFFFD/g) || []).length;

  return badGbk < badUtf8 ? gbk : utf8;
}

function withFlash(url: string, key: 'msg' | 'err', value: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + key + '=' + encodeURIComponent(value);
}

function safeRedirectTarget(input: unknown, fallback: string): string {
  if (typeof input === 'string' && input.startsWith('/')) return input;
  return fallback;
}

 function escapeHtml(input: string): string {
   return input
     .replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#39;');
 }

 function loadDotEnvFileIfPresent(envFilePath: string): void {
   try {
     if (!fs.existsSync(envFilePath)) return;
     const raw = fs.readFileSync(envFilePath, 'utf8');
     const lines = raw.split(/\r?\n/);
     for (const line of lines) {
       const trimmed = line.trim();
       if (!trimmed || trimmed.startsWith('#')) continue;
       const eq = trimmed.indexOf('=');
       if (eq <= 0) continue;
       const key = trimmed.slice(0, eq).trim();
       if (!key) continue;
       if (process.env[key] !== undefined) continue;
       let value = trimmed.slice(eq + 1);
       value = value.trim();
       if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
         value = value.slice(1, -1);
       }
       process.env[key] = value;
     }
   } catch {
   }
 }

 function writeDotEnvFile(envFilePath: string, updates: Record<string, string>): void {
   const keys = Object.keys(updates);
   if (keys.length === 0) return;

   let raw = '';
   try {
     if (fs.existsSync(envFilePath)) {
       raw = fs.readFileSync(envFilePath, 'utf8');
     }
   } catch {
     raw = '';
   }

   const hasTrailingNewline = raw.endsWith('\n') || raw.endsWith('\r\n');
   const lines = raw ? raw.split(/\r?\n/) : [];
   const seen = new Set<string>();
   const out: string[] = [];

   for (const line of lines) {
     let replaced = false;
     for (const k of keys) {
       if (seen.has(k)) continue;
       const re = new RegExp('^\\s*' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*=');
       if (re.test(line)) {
         out.push(k + '=' + updates[k]);
         seen.add(k);
         replaced = true;
         break;
       }
     }
     if (!replaced) out.push(line);
   }

   for (const k of keys) {
     if (!seen.has(k)) {
       out.push(k + '=' + updates[k]);
     }
   }

   const next = out.join('\n') + (hasTrailingNewline || out.length === 0 ? '' : '\n');
   fs.writeFileSync(envFilePath, next, 'utf8');
 }

async function main(): Promise<void> {
  const port = Number(process.env.PORT || 8080);
  const envFilePath = path.join(process.cwd(), '.env');
  loadDotEnvFileIfPresent(envFilePath);
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db');

  const backupEnabled = process.env.BACKUP_ENABLED === '1' || process.env.BACKUP_ENABLED === 'true';
  const backupIntervalMinutes = toIntClamp(process.env.BACKUP_INTERVAL_MINUTES, 1, 525_600, 1440);
  const backupRetention = toIntClamp(process.env.BACKUP_RETENTION, 1, 365, 10);
  const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');

  const checkConcurrency = toIntClamp(process.env.CHECK_CONCURRENCY, 1, 100, 30);
  const checkTimeoutMs = toIntClamp(process.env.CHECK_TIMEOUT_MS, 1000, 60_000, 5000);
  const checkRetries = toIntClamp(process.env.CHECK_RETRIES, 0, 5, 1);
  const checkRetryDelayMs = toIntClamp(process.env.CHECK_RETRY_DELAY_MS, 0, 10_000, 500);
  const periodicCheckEnabled = process.env.PERIODIC_CHECK_ENABLED === '1' || process.env.PERIODIC_CHECK_ENABLED === 'true';
  const periodicCheckSchedule = process.env.PERIODIC_CHECK_SCHEDULE || 'weekly'; // 'weekly' or 'monthly'
  const periodicCheckHour = toIntClamp(process.env.PERIODIC_CHECK_HOUR, 2, 5, 2); // 默认凌晨2点

  const db = openDb(dbPath);
  
  // 初始化用户表
  initUserTable(db);

  function getSetting(key: string): string | null {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  function setSetting(key: string, value: string): void {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      value,
    );
  }

  function getIntSetting(key: string, min: number, max: number, fallback: number): number {
    const raw = getSetting(key);
    if (raw === null) return fallback;
    return toIntClamp(raw, min, max, fallback);
  }

  function getBoolSetting(key: string, fallback: boolean): boolean {
    const raw = getSetting(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true' || raw === 'on';
  }

  function effectiveCheckRetries(fallback: number): number {
    return getIntSetting('check_retries', 0, 5, fallback);
  }

  function effectiveCheckRetryDelayMs(fallback: number): number {
    return getIntSetting('check_retry_delay_ms', 0, 10_000, fallback);
  }

  function effectiveBackupEnabled(fallback: boolean): boolean {
    return getBoolSetting('backup_enabled', fallback);
  }

  function effectivePeriodicCheckEnabled(fallback: boolean): boolean {
    return getBoolSetting('periodic_check_enabled', fallback);
  }

  function effectivePeriodicCheckSchedule(fallback: string): string {
    const val = getSetting('periodic_check_schedule');
    if (val === 'weekly' || val === 'monthly') return val;
    return fallback === 'weekly' || fallback === 'monthly' ? fallback : 'weekly';
  }

  function effectivePeriodicCheckHour(fallback: number): number {
    return getIntSetting('periodic_check_hour', 2, 5, fallback);
  }

  function effectiveBackupIntervalMinutes(fallback: number): number {
    return getIntSetting('backup_interval_minutes', 1, 525_600, fallback);
  }

  function effectiveBackupRetention(fallback: number): number {
    return getIntSetting('backup_retention', 1, 365, fallback);
  }

  function formatBackupTimestamp(now: Date): string {
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

  function escapeSqlString(input: string): string {
    return input.replace(/'/g, "''");
  }

  function pruneBackups(): void {
    try {
      if (!fs.existsSync(backupDir)) return;
      const files = fs
        .readdirSync(backupDir)
        .filter((f: string) => /^backup_\d{8}_\d{6}\.db$/i.test(f))
        .sort()
        .reverse();

      const retention = effectiveBackupRetention(backupRetention);

      const keep = files.slice(0, retention);
      const del = files.slice(retention);
      for (const f of del) {
        try {
          fs.unlinkSync(path.join(backupDir, f));
        } catch {
        }
      }

      if (keep.length === 0) return;
    } catch {
    }
  }

  function runBackupNow(manual: boolean = false): { fileName: string; fullPath: string; skipped?: boolean } {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM bookmarks').get() as { cnt: number };
    if (countRow.cnt === 0) {
      return { fileName: '', fullPath: '', skipped: true };
    }
    
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = formatBackupTimestamp(new Date());
    const prefix = manual ? 'manual_' : 'backup_';
    const fileName = prefix + ts + '.db';
    const fullPath = path.join(backupDir, fileName);
    const sqlPath = escapeSqlString(fullPath);
    db.exec('VACUUM INTO \'' + sqlPath + '\'');
    if (!manual) {
      pruneBackups();
    }
    return { fileName, fullPath };
  }

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
    genReqId: () => randomUUID(),
  });

  setJobQueueLogger(app.log);

  // 定期清理过期的 API Tokens（每小时）
  const staticApiToken = process.env.API_TOKEN || '';
  setInterval(() => {
    try {
      const cleaned = cleanupExpiredTokens(db);
      if (cleaned > 0) {
        app.log.info({ count: cleaned }, 'cleaned up expired API tokens');
      }
    } catch (e) {
      app.log.warn({ err: e }, 'failed to cleanup expired API tokens');
    }
  }, 60 * 60 * 1000);

  // CORS 支持（在所有请求之前）
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  await app.register(cookie);
  await app.register(session, {
    secret: process.env.SESSION_SECRET || 'a-very-secret-key-change-in-production',
    cookie: {
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });

  await app.register(formbody);
  await app.register(multipart);

  await app.register(view, {
    engine: { ejs },
    root: path.join(__dirname, '..', 'views'),
  });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/public/',
  });

  // API Token 认证 + Session 认证（在 session 插件注册之后）
  app.addHook('preHandler', async (req, reply) => {
    // 跳过静态资源和登录页面
    if (req.url.startsWith('/public/') || req.url === '/login' || req.url === '/favicon.ico') {
      return;
    }
    
    // 检查 Authorization header 进行 API Token 认证
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      
      // 先检查静态 Token（环境变量）
      if (staticApiToken && token === staticApiToken) {
        (req as any).apiTokenAuth = true;
        return;
      }
      
      // 再检查数据库中的动态 Token
      const tokenResult = validateApiToken(db, token);
      if (tokenResult.valid) {
        (req as any).apiTokenAuth = true;
        (req as any).apiTokenId = tokenResult.tokenId;
        return;
      }
      
      // Token 无效或已过期 - 对于 API 请求直接返回错误
      if (req.url.startsWith('/api/')) {
        if (tokenResult.expired) {
          return reply.code(401).send({ error: 'API token has expired' });
        }
        return reply.code(401).send({ error: 'Invalid API token' });
      }
    }
    
    // 对于 API 请求，如果没有有效 Token 且没有 session，返回 401
    if (req.url.startsWith('/api/') && !req.session?.authenticated) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    // 非 API 请求走正常的 session 认证（重定向到登录页）
    if (!req.session?.authenticated) {
      return reply.redirect('/login');
    }
  });

  app.get('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.session.authenticated) {
      return reply.redirect('/');
    }
    return reply.view('login.ejs', { error: null });
  });

  app.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any;
    const username = (body.username || '').trim();
    const password = (body.password || '').trim();
    const clientIp = getClientIp(req);

    const result = validateCredentials(db, username, password, clientIp);
    if (result.valid) {
      req.session.authenticated = true;
      req.session.username = username;
      req.log.info({ username, ip: clientIp }, 'user logged in');
      return reply.redirect('/');
    }

    req.log.warn({ username, ip: clientIp, error: result.error }, 'login failed');
    return reply.view('login.ejs', { error: result.error || '登录失败' });
  });

  app.post('/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    req.session.destroy();
    return reply.redirect('/login');
  });

  // 修改密码API
  app.post('/api/change-password', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any;
    const oldPassword = (body.old_password || '').trim();
    const newPassword = (body.new_password || '').trim();
    const confirmPassword = (body.confirm_password || '').trim();
    const username = req.session.username || '';

    if (!username) {
      return reply.code(401).send({ error: '请先登录' });
    }

    if (newPassword !== confirmPassword) {
      return reply.code(400).send({ error: '两次输入的新密码不一致' });
    }

    const result = changePassword(db, username, oldPassword, newPassword);
    if (result.success) {
      req.log.info({ username }, 'password changed');
      return reply.send({ success: true, message: '密码修改成功' });
    } else {
      return reply.code(400).send({ error: result.error || '修改密码失败' });
    }
  });

  // 获取当前用户信息API
  app.get('/api/user-info', async (req: FastifyRequest, reply: FastifyReply) => {
    const username = req.session.username || '';
    if (!username) {
      return reply.code(401).send({ error: '请先登录' });
    }
    const info = getUserInfo(db, username);
    if (info) {
      return reply.send(info);
    }
    return reply.send({ username });
  });

  // ==================== API Token 管理 ====================
  
  // 列出所有 API Tokens
  app.get('/api/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const tokens = listApiTokens(db);
      return reply.send({ tokens });
    } catch (e: any) {
      req.log.error({ err: e }, 'failed to list API tokens');
      return reply.code(500).send({ error: '获取 Token 列表失败' });
    }
  });

  // 创建新的 API Token
  app.post('/api/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any;
    const name = (body.name || '').trim();
    const expiresInDays = toInt(body.expires_in_days);

    if (!name) {
      return reply.code(400).send({ error: 'Token 名称不能为空' });
    }

    try {
      const result = createApiToken(db, name, expiresInDays || undefined);
      req.log.info({ tokenId: result.id, name }, 'API token created');
      return reply.send({
        success: true,
        token: result.token,
        id: result.id,
        prefix: result.prefix,
        message: '请立即保存此 Token，它只会显示一次！',
      });
    } catch (e: any) {
      req.log.error({ err: e }, 'failed to create API token');
      return reply.code(400).send({ error: e.message || '创建 Token 失败' });
    }
  });

  // 删除 API Token
  app.delete('/api/tokens/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as any;
    const id = toInt(params.id);

    if (id === null) {
      return reply.code(400).send({ error: '无效的 Token ID' });
    }

    try {
      const deleted = deleteApiToken(db, id);
      if (deleted) {
        req.log.info({ tokenId: id }, 'API token deleted');
        return reply.send({ success: true });
      } else {
        return reply.code(404).send({ error: 'Token 不存在' });
      }
    } catch (e: any) {
      req.log.error({ err: e }, 'failed to delete API token');
      return reply.code(500).send({ error: '删除 Token 失败' });
    }
  });

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
    const backupEnvOverride =
      process.env.BACKUP_ENABLED !== undefined ||
      process.env.BACKUP_INTERVAL_MINUTES !== undefined ||
      process.env.BACKUP_RETENTION !== undefined;

    const aiBaseUrl = getSetting('ai_base_url') ?? '';
    const aiApiKey = getSetting('ai_api_key') ?? '';
    const aiModel = getSetting('ai_model') ?? '';
    const aiBatchSize = getSetting('ai_batch_size') ?? '30';

    const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>设置 - 书签管理器</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="/public/app.css" />
  </head>
  <body class="bg-slate-50 text-slate-900">
    <div class="border-b bg-white">
      <div class="mx-auto max-w-screen-2xl px-2 py-2">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-lg font-semibold">设置</div>
            <div class="text-xs text-slate-500">说明：如同时配置了环境变量，则以环境变量为准（本应用启动时也会读取 .env）。</div>
          </div>
          <a class="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" href="/">返回</a>
        </div>
      </div>
    </div>

    <div id="settings-toast" class="fixed top-4 right-4 z-50 hidden rounded border px-4 py-2 text-sm shadow-lg"></div>

    <div class="mx-auto max-w-screen-2xl px-2 py-2">

      <form id="settings-form" method="post" action="/settings" class="space-y-2">
        <div class="rounded-lg border bg-white p-3 shadow-sm">
          <div class="text-sm font-semibold text-slate-700">检查默认参数</div>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <label class="block">
              <div class="text-xs text-slate-600">默认重试次数</div>
              <input name="check_retries" value="${escapeHtml(String(curCheckRetries))}" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label class="block">
              <div class="text-xs text-slate-600">默认重试间隔(ms)</div>
              <input name="check_retry_delay_ms" value="${escapeHtml(String(curCheckRetryDelayMs))}" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
          </div>
          <div class="mt-3 text-xs text-slate-500">这些默认值会用于：主页检查弹窗默认选项、导入后自动检查的重试参数、以及未显式传参的检查接口。</div>
          <div class="mt-1 text-xs text-slate-500">保存后即时生效，并同步写入 .env（${escapeHtml(envFilePath)}）供下次启动使用。</div>
          ${checkEnvOverride ? `<div class="mt-1 text-xs text-amber-600">提示：检测到已配置 CHECK_* 环境变量，本次保存会覆盖数据库默认值并立即生效；环境变量仅作为启动时的初始值。</div>` : ''}
        </div>

        <div class="rounded-lg border bg-white p-3 shadow-sm">
          <div class="text-sm font-semibold text-slate-700">备份参数</div>
          <div class="mt-3 grid grid-cols-3 gap-3">
            <label class="block col-span-1">
              <div class="text-xs text-slate-600">启用备份</div>
              <select name="backup_enabled" class="mt-1 w-full rounded border px-3 py-2 text-sm">
                <option value="0" ${curBackupEnabled ? '' : 'selected'}>关闭</option>
                <option value="1" ${curBackupEnabled ? 'selected' : ''}>开启</option>
              </select>
            </label>
            <label class="block col-span-1">
              <div class="text-xs text-slate-600">间隔(分钟)</div>
              <input name="backup_interval_minutes" value="${escapeHtml(String(curBackupIntervalMinutes))}" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label class="block col-span-1">
              <div class="text-xs text-slate-600">保留份数</div>
              <input name="backup_retention" value="${escapeHtml(String(curBackupRetention))}" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
          </div>
          <div class="mt-3 text-xs text-slate-500">修改后需重启生效（定时器在启动时创建）。</div>
          ${backupEnvOverride ? `<div class="mt-1 text-xs text-amber-600">提示：检测到已配置 BACKUP_* 环境变量，运行时将以环境变量为准。</div>` : ''}
        </div>

        <div class="rounded-lg border bg-white p-3 shadow-sm">
          <div class="text-sm font-semibold text-slate-700">定期检查</div>
          <div class="mt-3 grid grid-cols-3 gap-3">
            <label class="block">
              <div class="text-xs text-slate-600">启用定期检查</div>
              <select name="periodic_check_enabled" class="mt-1 w-full rounded border px-3 py-2 text-sm">
                <option value="0" ${curPeriodicCheckEnabled ? '' : 'selected'}>关闭</option>
                <option value="1" ${curPeriodicCheckEnabled ? 'selected' : ''}>开启</option>
              </select>
            </label>
            <label class="block">
              <div class="text-xs text-slate-600">检查周期</div>
              <select name="periodic_check_schedule" class="mt-1 w-full rounded border px-3 py-2 text-sm">
                <option value="weekly" ${curPeriodicCheckSchedule === 'weekly' ? 'selected' : ''}>每周（周一）</option>
                <option value="monthly" ${curPeriodicCheckSchedule === 'monthly' ? 'selected' : ''}>每月（1号）</option>
              </select>
            </label>
            <label class="block">
              <div class="text-xs text-slate-600">执行时间</div>
              <select name="periodic_check_hour" class="mt-1 w-full rounded border px-3 py-2 text-sm">
                <option value="2" ${curPeriodicCheckHour === 2 ? 'selected' : ''}>凌晨2点</option>
                <option value="3" ${curPeriodicCheckHour === 3 ? 'selected' : ''}>凌晨3点</option>
                <option value="4" ${curPeriodicCheckHour === 4 ? 'selected' : ''}>凌晨4点</option>
                <option value="5" ${curPeriodicCheckHour === 5 ? 'selected' : ''}>凌晨5点</option>
              </select>
            </label>
          </div>
          <div class="mt-3 text-xs text-slate-500">开启后系统会在指定时间自动检查所有书签的有效性。修改后需重启生效。</div>
        </div>

        <div class="rounded-lg border bg-white p-3 shadow-sm">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold text-slate-700">AI 自动分类（OpenAI 兼容）</div>
            <button id="ai-test-btn" type="button" class="rounded border px-3 py-1 text-xs hover:bg-slate-50">测试连接</button>
          </div>
          <div class="mt-3 space-y-3">
            <label class="block">
              <div class="text-xs text-slate-600">Base URL（例如 https://api.openai.com）</div>
              <input name="ai_base_url" value="${escapeHtml(aiBaseUrl)}" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label class="block">
              <div class="text-xs text-slate-600">API Key</div>
              <input name="ai_api_key" value="${escapeHtml(aiApiKey)}" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label class="block">
              <div class="text-xs text-slate-600">Model（例如 gpt-4o-mini）</div>
              <input name="ai_model" value="${escapeHtml(aiModel)}" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label class="block">
              <div class="text-xs text-slate-600">每批分类数量</div>
              <select name="ai_batch_size" class="mt-1 w-full rounded border px-3 py-2 text-sm">
                <option value="15" ${aiBatchSize === '15' ? 'selected' : ''}>15</option>
                <option value="30" ${aiBatchSize === '30' || !aiBatchSize ? 'selected' : ''}>30（默认）</option>
                <option value="50" ${aiBatchSize === '50' ? 'selected' : ''}>50</option>
                <option value="100" ${aiBatchSize === '100' ? 'selected' : ''}>100</option>
              </select>
            </label>
          </div>
          <div class="mt-3 text-xs text-slate-500">配置后可调用 /api/ai/classify 获取分类建议（先输出分类路径）。</div>
        </div>

        <div class="flex items-center justify-between gap-2">
          <button id="settings-reset" type="button" class="rounded border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50">恢复默认设置</button>
          <button id="settings-save" type="submit" class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">保存</button>
        </div>
      </form>

      <div class="mt-2 rounded-lg border bg-white p-3 shadow-sm">
        <div class="text-sm font-semibold text-slate-700">账号安全</div>
        <div class="mt-3 space-y-3">
          <label class="block">
            <div class="text-xs text-slate-600">原密码</div>
            <input id="old-password" type="password" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <label class="block">
            <div class="text-xs text-slate-600">新密码（至少6位）</div>
            <input id="new-password" type="password" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <label class="block">
            <div class="text-xs text-slate-600">确认新密码</div>
            <input id="confirm-password" type="password" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <button id="change-password-btn" type="button" class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">修改密码</button>
        </div>
        <div class="mt-3 text-xs text-slate-500">密码错误10次后账号将被锁定15分钟。</div>
      </div>

      <div class="mt-2 rounded-lg border bg-white p-3 shadow-sm">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold text-slate-700">API Tokens</div>
          <button id="create-token-btn" type="button" class="rounded border px-3 py-1 text-xs hover:bg-slate-50">创建 Token</button>
        </div>
        <div class="mt-3 text-xs text-slate-500">API Tokens 用于浏览器扩展或第三方应用访问 API。Token 只在创建时显示一次，请妥善保存。</div>
        <div id="token-list" class="mt-3">
          <div class="text-xs text-slate-400">加载中...</div>
        </div>
        <div id="new-token-display" class="mt-3 hidden rounded border border-emerald-200 bg-emerald-50 p-3">
          <div class="text-xs font-semibold text-emerald-700">新 Token 已创建（仅显示一次）：</div>
          <div class="mt-2 flex items-center gap-2">
            <input id="new-token-value" type="text" readonly class="flex-1 rounded border bg-white px-3 py-2 font-mono text-xs" />
            <button id="copy-token-btn" type="button" class="rounded border px-3 py-2 text-xs hover:bg-white">复制</button>
          </div>
        </div>
      </div>

      <div id="create-token-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/50">
        <div class="w-full max-w-md rounded-lg bg-white p-4 shadow-xl">
          <div class="text-sm font-semibold text-slate-700">创建 API Token</div>
          <div class="mt-3 space-y-3">
            <label class="block">
              <div class="text-xs text-slate-600">Token 名称</div>
              <input id="token-name" type="text" placeholder="例如：浏览器扩展" class="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label class="block">
              <div class="text-xs text-slate-600">有效期</div>
              <select id="token-expires" class="mt-1 w-full rounded border px-3 py-2 text-sm">
                <option value="">永不过期</option>
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">1 年</option>
              </select>
            </label>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button id="cancel-token-btn" type="button" class="rounded border px-4 py-2 text-sm hover:bg-slate-50">取消</button>
            <button id="confirm-token-btn" type="button" class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">创建</button>
          </div>
        </div>
      </div>

      <div class="mt-2 rounded-lg border bg-white p-3 shadow-sm">
        <div class="text-sm font-semibold text-slate-700">系统信息</div>
        <div class="mt-2 overflow-hidden rounded border">
          <table class="w-full table-fixed">
            <thead class="bg-slate-50">
              <tr>
                <th class="w-[35%] px-3 py-2 text-left text-xs font-semibold text-slate-600">Key</th>
                <th class="w-[65%] px-3 py-2 text-left text-xs font-semibold text-slate-600">Value</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr><td class="px-3 py-2 font-mono text-xs text-slate-700">DB_PATH</td><td class="px-3 py-2 font-mono text-xs text-slate-700">${escapeHtml(dbPath)}</td></tr>
              <tr><td class="px-3 py-2 font-mono text-xs text-slate-700">BACKUP_DIR</td><td class="px-3 py-2 font-mono text-xs text-slate-700">${escapeHtml(backupDir)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <script>
      (function () {
        var form = document.getElementById('settings-form');
        var toast = document.getElementById('settings-toast');
        var btn = document.getElementById('settings-save');

        function showToast(msg, type) {
          if (!toast) return;
          toast.classList.remove('hidden');
          toast.classList.remove('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
          toast.classList.remove('border-amber-200', 'bg-amber-50', 'text-amber-800');
          toast.classList.remove('border-rose-200', 'bg-rose-50', 'text-rose-700');
          if (type === 'success') {
            toast.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
          } else if (type === 'warn') {
            toast.classList.add('border-amber-200', 'bg-amber-50', 'text-amber-800');
          } else {
            toast.classList.add('border-rose-200', 'bg-rose-50', 'text-rose-700');
          }
          toast.textContent = msg;
          try {
            clearTimeout(showToast._t);
            showToast._t = setTimeout(function () {
              toast.classList.add('hidden');
              toast.textContent = '';
            }, 2500);
          } catch {}
        }

        if (!form) return;
        form.addEventListener('submit', async function (e) {
          e.preventDefault();
          if (btn) {
            btn.disabled = true;
            btn.classList.add('opacity-60');
          }
          try {
            var fd = new FormData(form);
            var body = new URLSearchParams();
            fd.forEach(function (v, k) { body.append(k, String(v)); });

            var res = await fetch(form.action || '/settings', {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
              },
              body: body.toString()
            });
            var data = await res.json().catch(function () { return null; });
            if (res.ok) {
              try {
                var saved = data && data.saved ? data.saved : null;
                if (saved) {
                  if (saved.check_retries != null) {
                    var el1 = form.querySelector('input[name="check_retries"]');
                    if (el1) el1.value = String(saved.check_retries);
                  }
                  if (saved.check_retry_delay_ms != null) {
                    var el2 = form.querySelector('input[name="check_retry_delay_ms"]');
                    if (el2) el2.value = String(saved.check_retry_delay_ms);
                  }
                  if (saved.backup_enabled != null) {
                    var el3 = form.querySelector('select[name="backup_enabled"]');
                    if (el3) el3.value = saved.backup_enabled ? '1' : '0';
                  }
                  if (saved.backup_interval_minutes != null) {
                    var el4 = form.querySelector('input[name="backup_interval_minutes"]');
                    if (el4) el4.value = String(saved.backup_interval_minutes);
                  }
                  if (saved.backup_retention != null) {
                    var el5 = form.querySelector('input[name="backup_retention"]');
                    if (el5) el5.value = String(saved.backup_retention);
                  }
                  if (saved.ai_base_url != null) {
                    var el6 = form.querySelector('input[name="ai_base_url"]');
                    if (el6) el6.value = String(saved.ai_base_url);
                  }
                  if (saved.ai_model != null) {
                    var el7 = form.querySelector('input[name="ai_model"]');
                    if (el7) el7.value = String(saved.ai_model);
                  }
                }
              } catch {}
              try {
                var env = data && data.env ? data.env : null;
                if (env && env.success === false) {
                  showToast('设置已保存，但 .env 同步失败：' + (env.error || ''), 'warn');
                } else if (env && env.success === true) {
                  showToast('设置已保存（已同步到 .env）', 'success');
                } else {
                  showToast('设置已保存', 'success');
                }
              } catch {
                showToast('设置已保存', 'success');
              }
            } else {
              showToast((data && data.error) ? data.error : '保存失败', 'error');
            }
          } catch (err) {
            showToast('保存失败', 'error');
          } finally {
            if (btn) {
              btn.disabled = false;
              btn.classList.remove('opacity-60');
            }
          }
        });

        var resetBtn = document.getElementById('settings-reset');
        if (resetBtn) {
          resetBtn.addEventListener('click', async function () {
            if (!confirm('确定要恢复默认设置吗？这将清空 AI 配置并重置所有参数为默认值。')) return;
            resetBtn.disabled = true;
            resetBtn.classList.add('opacity-60');
            try {
              var res = await fetch('/api/settings/reset', {
                method: 'POST',
                headers: { 'Accept': 'application/json' }
              });
              var data = await res.json().catch(function () { return null; });
              if (res.ok && data && data.defaults) {
                var d = data.defaults;
                var el1 = form.querySelector('input[name="check_retries"]');
                if (el1) el1.value = d.check_retries || '2';
                var el2 = form.querySelector('input[name="check_retry_delay_ms"]');
                if (el2) el2.value = d.check_retry_delay_ms || '1000';
                var el3 = form.querySelector('select[name="backup_enabled"]');
                if (el3) el3.value = d.backup_enabled === '1' ? '1' : '0';
                var el4 = form.querySelector('input[name="backup_interval_minutes"]');
                if (el4) el4.value = d.backup_interval_minutes || '60';
                var el5 = form.querySelector('input[name="backup_retention"]');
                if (el5) el5.value = d.backup_retention || '7';
                var el6 = form.querySelector('input[name="ai_base_url"]');
                if (el6) el6.value = d.ai_base_url || '';
                var el7 = form.querySelector('input[name="ai_api_key"]');
                if (el7) el7.value = d.ai_api_key || '';
                var el8 = form.querySelector('input[name="ai_model"]');
                if (el8) el8.value = d.ai_model || '';
                showToast('已恢复默认设置', 'success');
              } else {
                showToast((data && data.error) ? data.error : '重置失败', 'error');
              }
            } catch {
              showToast('重置失败', 'error');
            } finally {
              resetBtn.disabled = false;
              resetBtn.classList.remove('opacity-60');
            }
          });
        }

        var aiTestBtn = document.getElementById('ai-test-btn');
        if (aiTestBtn) {
          aiTestBtn.addEventListener('click', async function () {
            var baseUrl = form.querySelector('input[name="ai_base_url"]').value.trim();
            var apiKey = form.querySelector('input[name="ai_api_key"]').value.trim();
            var model = form.querySelector('input[name="ai_model"]').value.trim();
            
            if (!baseUrl || !apiKey || !model) {
              showToast('请先填写完整的 AI 配置', 'error');
              return;
            }
            
            aiTestBtn.disabled = true;
            aiTestBtn.textContent = '测试中...';
            
            try {
              var res = await fetch('/api/ai/test', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, model: model })
              });
              var data = await res.json().catch(function () { return null; });
              if (res.ok && data && data.success) {
                showToast('AI 连接测试成功！', 'success');
              } else {
                showToast('AI 连接测试失败：' + ((data && data.error) || '未知错误'), 'error');
              }
            } catch (err) {
              showToast('AI 连接测试失败：网络错误', 'error');
            } finally {
              aiTestBtn.disabled = false;
              aiTestBtn.textContent = '测试连接';
            }
          });
        }
        // 修改密码
        var changePwdBtn = document.getElementById('change-password-btn');
        if (changePwdBtn) {
          changePwdBtn.addEventListener('click', async function () {
            var oldPwd = document.getElementById('old-password').value;
            var newPwd = document.getElementById('new-password').value;
            var confirmPwd = document.getElementById('confirm-password').value;
            
            if (!oldPwd || !newPwd || !confirmPwd) {
              showToast('请填写完整的密码信息', 'error');
              return;
            }
            
            if (newPwd !== confirmPwd) {
              showToast('两次输入的新密码不一致', 'error');
              return;
            }
            
            if (newPwd.length < 6) {
              showToast('新密码长度至少6位', 'error');
              return;
            }
            
            changePwdBtn.disabled = true;
            changePwdBtn.textContent = '修改中...';
            
            try {
              var res = await fetch('/api/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ old_password: oldPwd, new_password: newPwd, confirm_password: confirmPwd })
              });
              var data = await res.json().catch(function () { return null; });
              if (res.ok && data && data.success) {
                showToast('密码修改成功', 'success');
                document.getElementById('old-password').value = '';
                document.getElementById('new-password').value = '';
                document.getElementById('confirm-password').value = '';
              } else {
                showToast((data && data.error) ? data.error : '修改密码失败', 'error');
              }
            } catch {
              showToast('修改密码失败', 'error');
            } finally {
              changePwdBtn.disabled = false;
              changePwdBtn.textContent = '修改密码';
            }
          });
        }

        // ==================== API Token 管理 ====================
        var tokenList = document.getElementById('token-list');
        var createTokenBtn = document.getElementById('create-token-btn');
        var createTokenModal = document.getElementById('create-token-modal');
        var cancelTokenBtn = document.getElementById('cancel-token-btn');
        var confirmTokenBtn = document.getElementById('confirm-token-btn');
        var tokenNameInput = document.getElementById('token-name');
        var tokenExpiresSelect = document.getElementById('token-expires');
        var newTokenDisplay = document.getElementById('new-token-display');
        var newTokenValue = document.getElementById('new-token-value');
        var copyTokenBtn = document.getElementById('copy-token-btn');

        function formatDate(dateStr) {
          if (!dateStr) return '-';
          var d = new Date(dateStr);
          return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }

        async function loadTokens() {
          if (!tokenList) return;
          try {
            var res = await fetch('/api/tokens');
            var data = await res.json();
            if (data.tokens && data.tokens.length > 0) {
              var html = '<div class="overflow-hidden rounded border"><table class="w-full"><thead class="bg-slate-50"><tr>';
              html += '<th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">名称</th>';
              html += '<th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">Token</th>';
              html += '<th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">创建时间</th>';
              html += '<th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">最后使用</th>';
              html += '<th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">过期时间</th>';
              html += '<th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">操作</th>';
              html += '</tr></thead><tbody class="divide-y">';
              for (var i = 0; i < data.tokens.length; i++) {
                var t = data.tokens[i];
                var isExpired = t.expires_at && new Date(t.expires_at) < new Date();
                html += '<tr class="' + (isExpired ? 'bg-rose-50' : '') + '">';
                html += '<td class="px-3 py-2 text-xs text-slate-700">' + t.name + '</td>';
                html += '<td class="px-3 py-2 font-mono text-xs text-slate-500">' + t.token_prefix + '</td>';
                html += '<td class="px-3 py-2 text-xs text-slate-500">' + formatDate(t.created_at) + '</td>';
                html += '<td class="px-3 py-2 text-xs text-slate-500">' + formatDate(t.last_used_at) + '</td>';
                html += '<td class="px-3 py-2 text-xs ' + (isExpired ? 'text-rose-600' : 'text-slate-500') + '">' + (t.expires_at ? formatDate(t.expires_at) + (isExpired ? ' (已过期)' : '') : '永不过期') + '</td>';
                html += '<td class="px-3 py-2"><button data-token-id="' + t.id + '" class="delete-token-btn rounded border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">删除</button></td>';
                html += '</tr>';
              }
              html += '</tbody></table></div>';
              tokenList.innerHTML = html;

              // 绑定删除按钮事件
              var deleteBtns = tokenList.querySelectorAll('.delete-token-btn');
              deleteBtns.forEach(function(btn) {
                btn.addEventListener('click', async function() {
                  var tokenId = this.getAttribute('data-token-id');
                  if (!confirm('确定要删除此 Token 吗？删除后使用此 Token 的应用将无法访问 API。')) return;
                  try {
                    var res = await fetch('/api/tokens/' + tokenId, { method: 'DELETE' });
                    if (res.ok) {
                      showToast('Token 已删除', 'success');
                      loadTokens();
                    } else {
                      var data = await res.json().catch(function() { return null; });
                      showToast((data && data.error) || '删除失败', 'error');
                    }
                  } catch {
                    showToast('删除失败', 'error');
                  }
                });
              });
            } else {
              tokenList.innerHTML = '<div class="text-xs text-slate-400">暂无 API Token</div>';
            }
          } catch {
            tokenList.innerHTML = '<div class="text-xs text-rose-500">加载失败</div>';
          }
        }

        if (createTokenBtn && createTokenModal) {
          createTokenBtn.addEventListener('click', function() {
            createTokenModal.classList.remove('hidden');
            createTokenModal.classList.add('flex');
            if (tokenNameInput) tokenNameInput.value = '';
            if (tokenExpiresSelect) tokenExpiresSelect.value = '';
            if (newTokenDisplay) newTokenDisplay.classList.add('hidden');
          });
        }

        if (cancelTokenBtn && createTokenModal) {
          cancelTokenBtn.addEventListener('click', function() {
            createTokenModal.classList.add('hidden');
            createTokenModal.classList.remove('flex');
          });
        }

        if (confirmTokenBtn) {
          confirmTokenBtn.addEventListener('click', async function() {
            var name = tokenNameInput ? tokenNameInput.value.trim() : '';
            var expires = tokenExpiresSelect ? tokenExpiresSelect.value : '';
            
            if (!name) {
              showToast('请输入 Token 名称', 'error');
              return;
            }

            confirmTokenBtn.disabled = true;
            confirmTokenBtn.textContent = '创建中...';

            try {
              var body = { name: name };
              if (expires) body.expires_in_days = parseInt(expires, 10);
              
              var res = await fetch('/api/tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
              });
              var data = await res.json();
              
              if (res.ok && data.token) {
                createTokenModal.classList.add('hidden');
                createTokenModal.classList.remove('flex');
                
                if (newTokenValue) newTokenValue.value = data.token;
                if (newTokenDisplay) newTokenDisplay.classList.remove('hidden');
                
                showToast('Token 创建成功，请立即复制保存！', 'success');
                loadTokens();
              } else {
                showToast((data && data.error) || '创建失败', 'error');
              }
            } catch {
              showToast('创建失败', 'error');
            } finally {
              confirmTokenBtn.disabled = false;
              confirmTokenBtn.textContent = '创建';
            }
          });
        }

        if (copyTokenBtn && newTokenValue) {
          copyTokenBtn.addEventListener('click', function() {
            newTokenValue.select();
            document.execCommand('copy');
            showToast('Token 已复制到剪贴板', 'success');
          });
        }

        // 页面加载时获取 Token 列表
        loadTokens();
      })();
    </script>
  </body>
</html>`;

    return reply.type('text/html; charset=utf-8').send(html);
  });

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
      const periodicCheckSchedule = periodicCheckScheduleVal === 'monthly' ? 'monthly' : 'weekly';
      const periodicCheckHourVal = toIntClamp(body.periodic_check_hour, 2, 5, 2);
      setSetting('periodic_check_enabled', periodicCheckEnabledBool ? '1' : '0');
      setSetting('periodic_check_schedule', periodicCheckSchedule);
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
          PERIODIC_CHECK_SCHEDULE: periodicCheckSchedule,
          PERIODIC_CHECK_HOUR: String(periodicCheckHourVal),
        };
        envResult.updatedKeys = Object.keys(updates);
        writeDotEnvFile(envFilePath, updates);
      } catch (e: any) {
        envResult = {
          success: false,
          path: envFilePath,
          error: typeof e?.message === 'string' ? e.message : '写入失败',
        };
        req.log.warn({ err: e, envFilePath }, 'write .env failed');
      }

      if (wantsJson) {
        return reply.send({
          success: true,
          env: envResult,
          saved: {
            check_retries: retries,
            check_retry_delay_ms: delayMs,
            backup_enabled: backupEnabledBool,
            backup_interval_minutes: backupInterval,
            backup_retention: backupRet,
            periodic_check_enabled: periodicCheckEnabledBool,
            periodic_check_schedule: periodicCheckSchedule,
            periodic_check_hour: periodicCheckHourVal,
            ai_base_url: aiBaseUrl,
            ai_model: aiModel,
          },
        });
      }
      return reply.redirect('/settings');
    } catch (e: any) {
      req.log.error({ err: e }, 'save settings failed');
      if (wantsJson) return reply.code(500).send({ error: 'Operation failed' });
      return reply.redirect('/settings');
    }
  });

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

  app.get('/api/jobs/current', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const row = db.prepare(`
        SELECT id, type, status, total, processed, inserted, skipped, failed, message, created_at, updated_at
        FROM jobs
        WHERE status IN ('running', 'pending', 'queued')
        ORDER BY created_at DESC
        LIMIT 1
      `).get() as any;
      
      if (row) {
        return reply.send({ job: row });
      }
      return reply.send({ job: null });
    } catch (e: any) {
      return reply.send({ job: null });
    }
  });

  app.post('/api/settings/reset', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const defaults = {
        check_retries: '2',
        check_retry_delay_ms: '1000',
        backup_enabled: '1',
        backup_interval_minutes: '60',
        backup_retention: '7',
        ai_base_url: '',
        ai_api_key: '',
        ai_model: '',
        ai_batch_size: '30',
      };
      for (const [key, value] of Object.entries(defaults)) {
        setSetting(key, value);
      }
      req.log.info('settings reset to defaults');
      return reply.send({ success: true, defaults });
    } catch (e: any) {
      req.log.error({ err: e }, 'reset settings failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.post('/api/ai/classify', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const baseUrl = (getSetting('ai_base_url') ?? '').trim();
    const apiKey = (getSetting('ai_api_key') ?? '').trim();
    const model = (getSetting('ai_model') ?? '').trim();

    if (!baseUrl || !apiKey || !model) {
      return reply.code(400).send({ error: '请先在设置页配置 AI（Base URL、API Key、Model）' });
    }

    if (!title && !url) {
      return reply.code(400).send({ error: '请提供标题或URL' });
    }

    // 获取已有分类的一级分类
    const existingCategories = db.prepare('SELECT name FROM categories').all() as { name: string }[];
    const topLevelCategories = new Set<string>();
    existingCategories.forEach(c => {
      const first = c.name.split('/')[0];
      if (first) topLevelCategories.add(first);
    });
    const topCategoriesHint = topLevelCategories.size > 0
      ? `\n已有一级分类：${Array.from(topLevelCategories).slice(0, 15).join('、')}`
      : '';

    const prompt =
      '你是书签分类助手。通过联网访问网页了解内容后分类。\n' +
      '规则：1.分类最多3级(如:技术/开发/前端)，禁止4级！2.优先使用已有一级分类\n' +
      '标准一级分类：技术开发、学习资源、工具软件、购物电商、娱乐影音、社交媒体、新闻资讯、设计素材、生活服务、游戏、成人内容、其他' +
      topCategoriesHint + '\n' +
      '只输出分类路径，不要解释。\n' +
      (title ? '标题: ' + title + '\n' : '') +
      (url ? '网址: ' + url + '\n' : '');

    try {
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseUrl.replace(/\/+$/, ''),
        timeout: 60000,
      });

      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: '只输出分类路径（最多3级），不要解释。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      });

      let content = completion.choices?.[0]?.message?.content?.trim() || '';
      if (!content) {
        return reply.code(502).send({ error: 'AI 未返回分类结果' });
      }
      
      // 限制层级不超过3级
      const parts = content.split('/').filter((p: string) => p.trim());
      if (parts.length > 3) {
        content = parts.slice(0, 3).join('/');
      }
      
      return reply.send({ category: content });
    } catch (e: any) {
      req.log.error({ err: e }, 'ai classify failed');
      const errorMsg = e.message || 'AI 请求失败';
      return reply.code(500).send({ error: errorMsg });
    }
  });

  app.post('/api/ai/test', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const baseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : '';
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    const model = typeof body.model === 'string' ? body.model.trim() : '';

    if (!baseUrl || !apiKey || !model) {
      return reply.code(400).send({ error: '请填写完整的 AI 配置' });
    }

    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseUrl.replace(/\/+$/, ''),
        timeout: 15000,
      });

      const completion = await openai.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      });

      if (completion.choices && completion.choices.length > 0) {
        return reply.send({ success: true });
      } else {
        return reply.code(400).send({ error: 'AI 未返回有效响应' });
      }
    } catch (e: any) {
      req.log.error({ err: e }, 'ai test failed');
      const errorMsg = e.message || '连接失败';
      return reply.code(500).send({ error: errorMsg });
    }
  });

  app.post('/api/ai/classify-batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const scope = typeof body.scope === 'string' ? body.scope : 'uncategorized';
    const categoryId = toInt(body.categoryId) ?? undefined;
    const autoApply = body.autoApply === true || body.autoApply === 'true';
    const settingsBatchSize = toInt(getSetting('ai_batch_size')) ?? 30;
    const batchSizeRaw = toInt(body.batchSize) ?? settingsBatchSize;
    const batchSize = [15, 30, 50, 100].includes(batchSizeRaw) ? batchSizeRaw : settingsBatchSize;
    const bookmarkIdsRaw = typeof body.bookmarkIds === 'string' ? body.bookmarkIds : '';
    const bookmarkIds = bookmarkIdsRaw
      .split(',')
      .map((s: string) => toInt(s.trim()))
      .filter((n: number | null): n is number => n !== null);

    const baseUrl = (getSetting('ai_base_url') ?? '').trim();
    const apiKey = (getSetting('ai_api_key') ?? '').trim();
    const model = (getSetting('ai_model') ?? '').trim();

    if (!baseUrl || !apiKey || !model) {
      return reply.code(400).send({ error: 'AI config incomplete, please fill in Base URL / API Key / Model in settings' });
    }

    if (!['all', 'uncategorized', 'category', 'selected'].includes(scope)) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    if (scope === 'category' && !categoryId) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    if (scope === 'selected' && bookmarkIds.length === 0) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    // 清空旧的分类建议
    try {
      db.prepare('DELETE FROM ai_classification_suggestions').run();
    } catch {}

    const job = createJob(db, 'ai_classify', autoApply ? '批量 AI 分类（自动应用）' : '批量 AI 分类（仅建议）');

    jobQueue.enqueue(job.id, async () => {
      try {
        await runAIClassifyJob(db, job.id, { scope, categoryId, autoApply, bookmarkIds, batchSize }, { baseUrl, apiKey, model });
      } catch (e: any) {
        req.log.error({ err: e, jobId: job.id }, 'ai classify job failed');
        updateJob(db, job.id, { status: 'failed', message: 'Classification failed: ' + (e.message || 'Unknown error') });
      }
    });

    return reply.send({ jobId: job.id });
  });

  app.get('/api/ai/suggestions', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const q: any = (req as any).query || {};
      const limit = toInt(q.limit) || 100;
      const offset = toInt(q.offset) || 0;
      
      // 确保表有applied字段
      try {
        db.exec('ALTER TABLE ai_classification_suggestions ADD COLUMN applied INTEGER DEFAULT 0');
      } catch {}
      
      const rows = db.prepare(`
        SELECT s.id, s.bookmark_id, s.suggested_category, s.confidence, s.created_at, s.applied,
               b.title, b.url
        FROM ai_classification_suggestions s
        JOIN bookmarks b ON b.id = s.bookmark_id
        ORDER BY s.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset) as Array<{
        id: number;
        bookmark_id: number;
        suggested_category: string;
        confidence: string;
        created_at: string;
        applied: number;
        title: string;
        url: string;
      }>;
      
      const totalRow = db.prepare('SELECT COUNT(*) as count FROM ai_classification_suggestions').get() as { count: number };
      
      return reply.send({ suggestions: rows, total: totalRow?.count || 0 });
    } catch (e: any) {
      return reply.send({ suggestions: [], total: 0 });
    }
  });

  app.post('/api/ai/apply-suggestion', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    // 支持字符串或数字类型的bookmark_id
    const bookmarkIdRaw = body.bookmark_id;
    const bookmarkId = typeof bookmarkIdRaw === 'number' ? bookmarkIdRaw : toInt(bookmarkIdRaw);
    const categoryPath = typeof body.category === 'string' ? body.category.trim() : '';

    req.log.info({ bookmarkId, categoryPath, body }, 'apply-suggestion request');

    if (!bookmarkId || !categoryPath) {
      return reply.code(400).send({ error: '参数错误: bookmark_id=' + bookmarkIdRaw + ', category=' + categoryPath });
    }

    try {
      // 检查书签是否存在
      const bookmark = db.prepare('SELECT id FROM bookmarks WHERE id = ?').get(bookmarkId);
      if (!bookmark) {
        return reply.code(400).send({ error: '书签不存在' });
      }

      // 限制分类层级不超过3级
      let normalizedPath = categoryPath.replace(/[\\]/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
      const parts = normalizedPath.split('/').filter((p: string) => p.trim());
      if (parts.length > 3) {
        normalizedPath = parts.slice(0, 3).join('/');
      }
      const categoryName = normalizedPath;
      let categoryId: number;
      
      const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(categoryName) as { id: number } | undefined;
      if (existing) {
        categoryId = existing.id;
      } else {
        const result = db.prepare('INSERT INTO categories (name, parent_id, created_at) VALUES (?, NULL, ?)').run(categoryName, new Date().toISOString());
        categoryId = result.lastInsertRowid as number;
      }

      db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?').run(categoryId, bookmarkId);
      
      // 标记为已应用而不是删除
      try {
        db.exec('ALTER TABLE ai_classification_suggestions ADD COLUMN applied INTEGER DEFAULT 0');
      } catch {}
      db.prepare('UPDATE ai_classification_suggestions SET applied = 1 WHERE bookmark_id = ?').run(bookmarkId);

      return reply.send({ success: true, categoryId, categoryName });
    } catch (e: any) {
      req.log.error({ err: e }, 'apply suggestion failed');
      return reply.code(500).send({ error: '应用分类失败: ' + (e.message || '未知错误') });
    }
  });

  app.post('/api/ai/apply-all-suggestions', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // 确保表有applied字段
      try {
        db.exec('ALTER TABLE ai_classification_suggestions ADD COLUMN applied INTEGER DEFAULT 0');
      } catch {}

      // 先查询所有建议，不过滤applied
      const allSuggestions = db.prepare(`
        SELECT id, bookmark_id, suggested_category FROM ai_classification_suggestions
      `).all() as Array<{ id: number; bookmark_id: number; suggested_category: string }>;
      
      req.log.info({ totalSuggestions: allSuggestions.length }, 'apply-all-suggestions: total suggestions');
      
      const suggestions = allSuggestions;

      // 预编译SQL语句以提升性能
      const selectBookmarkStmt = db.prepare('SELECT id FROM bookmarks WHERE id = ?');
      const selectCategoryStmt = db.prepare('SELECT id FROM categories WHERE name = ?');
      const insertCategoryStmt = db.prepare('INSERT INTO categories (name, parent_id, created_at) VALUES (?, NULL, ?)');
      const updateBookmarkStmt = db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?');
      const updateSuggestionStmt = db.prepare('UPDATE ai_classification_suggestions SET applied = 1 WHERE id = ?');

      let applied = 0;
      let failed = 0;
      const errors: string[] = [];
      
      // 使用事务包裹批量操作以提升性能
      const applyAll = db.transaction(() => {
        for (const s of suggestions) {
          try {
            if (!s.suggested_category) {
              errors.push(`书签${s.bookmark_id}: 分类为空`);
              failed++;
              continue;
            }
            
            const parts = s.suggested_category.split('/').map((p: string) => p.trim()).filter((p: string) => p);
            if (parts.length === 0) {
              errors.push(`书签${s.bookmark_id}: 分类路径无效 "${s.suggested_category}"`);
              failed++;
              continue;
            }

            // 检查书签是否存在
            const bookmark = selectBookmarkStmt.get(s.bookmark_id);
            if (!bookmark) {
              errors.push(`书签${s.bookmark_id}: 书签不存在`);
              failed++;
              continue;
            }

            // 使用完整路径作为分类名称
            const categoryName = s.suggested_category;
            let categoryId: number;
            
            const existing = selectCategoryStmt.get(categoryName) as { id: number } | undefined;
            if (existing) {
              categoryId = existing.id;
            } else {
              const result = insertCategoryStmt.run(categoryName, new Date().toISOString());
              categoryId = result.lastInsertRowid as number;
            }

            updateBookmarkStmt.run(categoryId, s.bookmark_id);
            updateSuggestionStmt.run(s.id);
            applied++;
          } catch (err: any) {
            req.log.error({ err, suggestion: s }, 'apply suggestion failed');
            errors.push(`书签${s.bookmark_id}: ${err.message || '未知错误'}`);
            failed++;
            continue;
          }
        }
      });
      
      applyAll();
      
      if (errors.length > 0) {
        req.log.warn({ errors: errors.slice(0, 10) }, 'some suggestions failed to apply');
      }

      return reply.send({ success: true, applied, failed });
    } catch (e: any) {
      req.log.error({ err: e }, 'apply all suggestions failed');
      return reply.code(500).send({ error: '批量应用分类失败: ' + (e.message || '') });
    }
  });

  // AI 类型精简功能
  app.post('/api/ai/simplify-categories', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const autoApply = body.autoApply === true || body.autoApply === 'true';

    const baseUrl = (getSetting('ai_base_url') ?? '').trim();
    const apiKey = (getSetting('ai_api_key') ?? '').trim();
    const model = (getSetting('ai_model') ?? '').trim();

    if (!baseUrl || !apiKey || !model) {
      return reply.code(400).send({ error: '请先在设置页配置 AI（Base URL、API Key、Model）' });
    }

    const job = createJob(db, 'ai_simplify', autoApply ? 'AI 类型精简（自动应用）' : 'AI 类型精简（仅建议）');

    jobQueue.enqueue(job.id, async () => {
      try {
        await runAISimplifyJob(db, job.id, { autoApply }, { baseUrl, apiKey, model });
      } catch (e: any) {
        req.log.error({ err: e, jobId: job.id }, 'ai simplify job failed');
        updateJob(db, job.id, { status: 'failed', message: '精简失败: ' + (e.message || '未知错误') });
      }
    });

    return reply.send({ jobId: job.id });
  });

  app.get('/api/ai/simplify-suggestions', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query: any = req.query || {};
      const jobId = query.job_id as string;
      
      if (!jobId) {
        return reply.code(400).send({ error: '缺少job_id参数' });
      }
      
      const mappings = getSimplifyMappingsByJobId(db, jobId);
      
      // 按新分类名分组
      const grouped: Record<string, Array<{ oldCategoryId: number; oldCategoryName: string; bookmarkCount: number; applied: boolean }>> = {};
      for (const m of mappings) {
        if (!grouped[m.newCategoryName]) {
          grouped[m.newCategoryName] = [];
        }
        grouped[m.newCategoryName].push({
          oldCategoryId: m.oldCategoryId,
          oldCategoryName: m.oldCategoryName,
          bookmarkCount: m.bookmarkCount,
          applied: m.applied || false,
        });
      }
      
      const result = Object.entries(grouped).map(([newCategory, oldCategories]) => ({
        newCategory,
        oldCategories,
        totalBookmarks: oldCategories.reduce((sum, c) => sum + c.bookmarkCount, 0),
        allApplied: oldCategories.every(c => c.applied),
      }));
      
      return reply.send({ suggestions: result, total: mappings.length });
    } catch (e: any) {
      req.log.error({ err: e }, 'get simplify suggestions failed');
      return reply.code(500).send({ error: '获取精简建议失败' });
    }
  });

  app.post('/api/ai/apply-simplify', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body: any = req.body || {};
      const oldCategoryId = toInt(body.old_category_id);
      const jobId = typeof body.job_id === 'string' ? body.job_id : '';

      req.log.info({ body, oldCategoryId, jobId }, 'apply-simplify request');

      if (!oldCategoryId || !jobId) {
        return reply.code(400).send({ error: '参数错误：缺少old_category_id或job_id' });
      }

      const result = applyOneSimplifyMapping(db, oldCategoryId, jobId);
      req.log.info({ result }, 'apply-simplify result');
      
      if (result.success) {
        return reply.send({ success: true });
      } else {
        return reply.code(400).send({ error: result.error || '应用失败' });
      }
    } catch (e: any) {
      req.log.error({ err: e }, 'apply-simplify error');
      return reply.code(500).send({ error: e.message || '服务器错误' });
    }
  });

  app.post('/api/ai/apply-all-simplify', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      req.log.info('apply-all-simplify request');
      const result = applyAllSimplifyMappings(db);
      req.log.info({ result }, 'apply-all-simplify result');
      
      if (result.success) {
        return reply.send({ success: true, applied: result.applied });
      } else {
        return reply.code(500).send({ error: result.error || '应用失败' });
      }
    } catch (e: any) {
      req.log.error({ err: e }, 'apply-all-simplify error');
      return reply.code(500).send({ error: e.message || '服务器错误' });
    }
  });

  app.post('/api/check/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : typeof body.id === 'string' ? body.id.trim() : '';
    if (!jobId) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    try {
      const job = getJob(db, jobId);
      if (!job) {
        return reply.code(404).send({ error: 'Operation failed' });
      }
      if (job.type !== 'check') {
        return reply.code(400).send({ error: 'Operation failed' });
      }
      if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
        return reply.send({ success: true, status: job.status });
      }
      const next = updateJob(db, jobId, { status: 'canceled', message: '已取消' });
      return reply.send({ success: true, status: next.status });
    } catch (e: any) {
      req.log.error({ err: e, jobId }, 'cancel check failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.post('/api/ai/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : typeof body.id === 'string' ? body.id.trim() : '';
    if (!jobId) {
      return reply.code(400).send({ error: '缺少任务ID' });
    }

    try {
      const job = getJob(db, jobId);
      if (!job) {
        return reply.code(404).send({ error: '任务不存在' });
      }
      if (job.type !== 'ai_classify') {
        return reply.code(400).send({ error: '任务类型错误' });
      }
      if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
        return reply.send({ success: true, status: job.status });
      }
      
      // 标记任务为取消状态
      const next = updateJob(db, jobId, { status: 'canceled', message: '已取消，正在回滚...' });
      
      // 清除该任务产生的分类建议
      db.prepare('DELETE FROM ai_classification_suggestions').run();
      
      updateJob(db, jobId, { message: '已取消' });
      
      return reply.send({ success: true, status: 'canceled' });
    } catch (e: any) {
      req.log.error({ err: e, jobId }, 'cancel ai classify failed');
      return reply.code(500).send({ error: '取消失败' });
    }
  });

  app.get('/jobs/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const jobId = req.params.id;
    const job = getJob(db, jobId);
    if (!job) {
      return reply.code(404).type('text/plain').send('not found');
    }

    const q: any = (req as any).query || {};
    const failPage = toIntClamp(q.fail_page, 1, 10_000, 1);
    const failPageSize = toIntClamp(q.fail_page_size, 10, 200, 20);
    const failureTotal = countJobFailures(db, jobId);
    const failTotalPages = Math.max(1, Math.ceil(failureTotal / failPageSize));
    const failPageClamped = Math.min(Math.max(1, failPage), failTotalPages);
    const failOffset = (failPageClamped - 1) * failPageSize;

    const failures = listJobFailuresPaged(db, jobId, failPageSize, failOffset);
    const failPageUrlPrefix = '/jobs/' + jobId + '?fail_page_size=' + failPageSize + '&fail_page=';

    // 获取AI分类建议（如果是AI分类任务）- 支持分页
    let suggestions: any[] = [];
    let suggestionTotal = 0;
    let suggestionPage = 1;
    let suggestionTotalPages = 1;
    let suggestionPageSize = toIntClamp(q.sug_page_size, 10, 100, 20);
    
    if (job.type === 'ai_classify') {
      try {
        // 确保表有applied字段
        try {
          db.exec('ALTER TABLE ai_classification_suggestions ADD COLUMN applied INTEGER DEFAULT 0');
        } catch {}
        
        suggestionPage = toIntClamp(q.sug_page, 1, 10_000, 1);
        const countRow = db.prepare('SELECT COUNT(*) as cnt FROM ai_classification_suggestions').get() as { cnt: number };
        suggestionTotal = countRow.cnt;
        suggestionTotalPages = Math.max(1, Math.ceil(suggestionTotal / suggestionPageSize));
        const suggestionPageClamped = Math.min(Math.max(1, suggestionPage), suggestionTotalPages);
        const suggestionOffset = (suggestionPageClamped - 1) * suggestionPageSize;
        suggestionPage = suggestionPageClamped;
        
        suggestions = db.prepare(`
          SELECT s.id, s.bookmark_id, s.suggested_category, s.confidence, s.created_at,
                 b.title, b.url, COALESCE(s.applied, 0) as applied
          FROM ai_classification_suggestions s
          JOIN bookmarks b ON b.id = s.bookmark_id
          ORDER BY s.applied ASC, s.created_at DESC
          LIMIT ? OFFSET ?
        `).all(suggestionPageSize, suggestionOffset) as any[];
      } catch {}
    }

    // 获取AI类型精简建议（如果是AI精简任务）
    let simplifySuggestions: any[] = [];
    if (job.type === 'ai_simplify') {
      try {
        // 首先尝试获取当前任务的建议
        let mappings = getSimplifyMappingsByJobId(db, jobId);
        
        // 如果当前任务没有建议，尝试获取legacy数据（兼容旧数据）
        if (mappings.length === 0) {
          mappings = getSimplifyMappings(db);
        }
        
        // 按新分类名分组
        const grouped: Record<string, Array<{ oldCategoryId: number; oldCategoryName: string; bookmarkCount: number; applied: boolean }>> = {};
        for (const m of mappings) {
          if (!grouped[m.newCategoryName]) {
            grouped[m.newCategoryName] = [];
          }
          grouped[m.newCategoryName].push({
            oldCategoryId: m.oldCategoryId,
            oldCategoryName: m.oldCategoryName,
            bookmarkCount: m.bookmarkCount,
            applied: m.applied || false,
          });
        }
        
        simplifySuggestions = Object.entries(grouped).map(([newCategory, oldCategories]) => ({
          newCategory,
          oldCategories,
          totalBookmarks: oldCategories.reduce((sum, c) => sum + c.bookmarkCount, 0),
          allApplied: oldCategories.every(c => c.applied),
        }));
      } catch {}
    }

    return reply.view('job.ejs', {
      job,
      failures,
      failureTotal,
      failPage: failPageClamped,
      failTotalPages,
      failPageSize,
      failPageUrlPrefix,
      suggestions,
      suggestionTotal,
      suggestionPage,
      suggestionTotalPages,
      suggestionPageSize,
      simplifySuggestions,
    });
  });

  // 获取任务失败项API
  app.get('/api/jobs/:id/failures', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const jobId = req.params.id;
    const q: any = (req as any).query || {};
    const limit = toInt(q.limit) || 20;
    const offset = toInt(q.offset) || 0;
    
    try {
      const failures = db.prepare('SELECT * FROM job_failures WHERE job_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(jobId, limit, offset) as Array<{ id: number; job_id: string; input: string; reason: string }>;
      const totalRow = db.prepare('SELECT COUNT(*) as count FROM job_failures WHERE job_id = ?').get(jobId) as { count: number };
      return reply.send({ failures, total: totalRow?.count || 0 });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.get('/jobs/:id/events', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const jobId = req.params.id;
    const job = getJob(db, jobId);
    if (!job) {
      return reply.code(404).type('text/plain').send('not found');
    }

    req.log.info({ jobId }, 'sse connected');

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    reply.raw.write('data: ' + JSON.stringify(job) + '\n\n');

    const unsubscribe = subscribeJob(jobId, (next) => {
      reply.raw.write('data: ' + JSON.stringify(next) + '\n\n');
    });

    req.raw.on('close', () => {
      unsubscribe();
      req.log.info({ jobId }, 'sse disconnected');
      reply.raw.end();
    });
  });

  app.get('/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const q: any = (req as any).query || {};
    const category = typeof q.category === 'string' ? q.category : undefined;
    const scope = typeof q.scope === 'string' ? q.scope : undefined;
    const categoryIds = typeof q.categoryIds === 'string' ? q.categoryIds : '';
    const format = typeof q.format === 'string' ? q.format : 'html';

    let rows = queryExportRows(db);
    
    if (scope === 'uncategorized') {
      rows = rows.filter((r) => r.category_name === null);
    } else if (scope === 'categories' && categoryIds) {
      const ids = categoryIds.split(',').map((s: string) => toInt(s.trim())).filter((n: number | null): n is number => n !== null);
      if (ids.length > 0) {
        const catNames = new Set<string>();
        for (const id of ids) {
          const nameRow = db.prepare('SELECT name FROM categories WHERE id = ?').get(id) as { name: string } | undefined;
          if (nameRow) catNames.add(nameRow.name);
        }
        rows = rows.filter((r) => r.category_name !== null && catNames.has(r.category_name));
      }
    } else if (category === 'uncategorized') {
      rows = rows.filter((r) => r.category_name === null);
    } else if (category) {
      const catId = toInt(category);
      if (catId !== null) {
        const nameRow = db.prepare('SELECT name FROM categories WHERE id = ?').get(catId) as { name: string } | undefined;
        if (!nameRow) {
          rows = [];
        } else {
          const catName = nameRow.name;
          rows = rows.filter((r) => r.category_name === catName);
        }
      }
    }

    req.log.info({ rowCount: rows.length, category, scope, format }, 'export requested');

    const fileName = 'bookmarks_' + formatBackupTimestamp(new Date());

    if (format === 'json') {
      const jsonData = rows.map((r) => ({
        url: r.url,
        title: r.title,
        category: r.category_name || null,
        created_at: r.created_at,
      }));
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="' + fileName + '.json"');
      return reply.send(JSON.stringify(jsonData, null, 2));
    }

    const html = buildNetscapeHtml(rows);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="' + fileName + '.html"');
    return reply.send(html);
  });

  app.post(
    '/check/all',
    async (req: FastifyRequest<{ Body: { redirect?: string; scope?: string; retries?: string; retry_delay_ms?: string } }>, reply: FastifyReply) => {
      const body: any = (req as any).body || {};
      const redirectTo = safeRedirectTarget(body.redirect, '/');

      const scope = typeof body.scope === 'string' ? body.scope : 'all';
      const retries = toIntClamp(body.retries, 0, 5, effectiveCheckRetries(checkRetries));
      const retryDelayMs = toIntClamp(body.retry_delay_ms, 0, 10_000, effectiveCheckRetryDelayMs(checkRetryDelayMs));

      let ids: Array<{ id: number }>;
      if (scope === 'not_checked') {
        ids = db.prepare("SELECT id FROM bookmarks WHERE check_status = 'not_checked' AND skip_check = 0 ORDER BY id").all() as Array<{ id: number }>;
      } else if (scope === 'failed') {
        ids = db.prepare("SELECT id FROM bookmarks WHERE check_status = 'fail' AND skip_check = 0 ORDER BY id").all() as Array<{ id: number }>;
      } else {
        ids = db.prepare('SELECT id FROM bookmarks WHERE skip_check = 0 ORDER BY id').all() as Array<{ id: number }>;
      }
      const bookmarkIds = ids.map((x) => x.id);

      req.log.info({ scope, bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check all requested');

      if (bookmarkIds.length === 0) {
        const msg = scope === 'failed' ? '暂无失败书签可重试' : scope === 'not_checked' ? '暂无未检查书签' : '暂无可检查书签';
        return reply.redirect(withFlash(redirectTo, 'msg', msg));
      }

      const job = createJob(db, 'check', '等待检查');
      req.log.info({ jobId: job.id }, 'check job queued');
      jobQueue.enqueue(job.id, async () => {
        const log = app.log.child({ jobId: job.id, jobType: 'check' });
        const startedAt = Date.now();
        try {
          log.info({ bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check job started');
          await runCheckJob(db, job.id, bookmarkIds, {
            concurrency: checkConcurrency,
            timeoutMs: checkTimeoutMs,
            retries,
            retryDelayMs,
            logger: log,
          });
          log.info({ durationMs: Date.now() - startedAt }, 'check job done');
        } catch (err) {
          log.error({ err, durationMs: Date.now() - startedAt }, 'check job failed');
          updateJob(db, job.id, { status: 'failed', message: '检查失败' });
        }
      });

      return reply.redirect('/jobs/' + job.id);
    },
  );

  app.get('/api/backups', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!fs.existsSync(backupDir)) return reply.send({ backups: [] });
      const backups = fs
        .readdirSync(backupDir)
        .filter((f: string) => /^(backup|manual)_\d{8}_\d{6}\.db$/i.test(f))
        .map((f: string) => {
          const full = path.join(backupDir, f);
          const stat = fs.statSync(full);
          const isManual = f.startsWith('manual_');
          return { name: f, size: stat.size, mtimeMs: stat.mtimeMs, type: isManual ? 'manual' : 'auto' };
        })
        .sort((a: { mtimeMs: number }, b: { mtimeMs: number }) => b.mtimeMs - a.mtimeMs);
      return reply.send({ backups });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.post('/api/bookmarks/move', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};

    const raw = body['bookmark_ids[]'] ?? body.bookmark_ids;
    const ids: number[] = Array.isArray(raw)
      ? raw.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
      : typeof raw === 'string'
        ? [toInt(raw)].filter((n): n is number => n !== null)
        : [];

    if (ids.length === 0) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    const rawTarget = body.target_category ?? body.targetCategory ?? body.category ?? body.category_id;
    const targetStr = typeof rawTarget === 'string' ? rawTarget : typeof rawTarget === 'number' ? String(rawTarget) : '';
    if (!targetStr) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    const targetCategoryId = targetStr === 'uncategorized' ? null : toInt(targetStr);
    if (targetStr !== 'uncategorized' && targetCategoryId === null) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    if (typeof targetCategoryId === 'number') {
      const exists = db.prepare('SELECT 1 AS ok FROM categories WHERE id = ?').get(targetCategoryId) as { ok: 1 } | undefined;
      if (!exists) {
        return reply.code(404).send({ error: 'Operation failed' });
      }
    }

    try {
      const placeholders = ids.map(() => '?').join(',');
      const res = db
        .prepare('UPDATE bookmarks SET category_id = ? WHERE id IN (' + placeholders + ')')
        .run(targetCategoryId, ...ids);
      req.log.info({ count: res.changes, ids, targetCategoryId }, 'move bookmarks');
      return reply.send({ success: true, updated: res.changes });
    } catch (e: any) {
      req.log.error({ err: e }, 'move bookmarks failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.post('/api/backups/run', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const res = runBackupNow(true);
      req.log.info({ fileName: res.fileName }, 'manual backup created');
      return reply.send({ success: true, backup: res.fileName });
    } catch (e: any) {
      req.log.error({ err: e }, 'backup failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.get('/backups/:name', async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const name = req.params.name;
    if (!/^(backup|manual)_\d{8}_\d{6}\.db$/i.test(name)) {
      return reply.code(400).type('text/plain').send('bad request');
    }
    const fullPath = path.join(backupDir, name);
    if (!fs.existsSync(fullPath)) {
      return reply.code(404).type('text/plain').send('not found');
    }
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="' + name + '"');
    return reply.send(fs.createReadStream(fullPath));
  });

  app.delete('/api/backups/:name', async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const name = req.params.name;
    if (!/^(backup|manual)_\d{8}_\d{6}\.db$/i.test(name)) {
      return reply.code(400).send({ error: 'Operation failed' });
    }
    const fullPath = path.join(backupDir, name);
    if (!fs.existsSync(fullPath)) {
      return reply.code(404).send({ error: 'Operation failed' });
    }
    try {
      fs.unlinkSync(fullPath);
      req.log.info({ fileName: name }, 'backup deleted');
      return reply.send({ success: true });
    } catch (e: any) {
      req.log.error({ err: e, fileName: name }, 'delete backup failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.get('/api/categories', async (_req: FastifyRequest, reply: FastifyReply) => {
    const categories = db
      .prepare(
        'SELECT c.id AS id, c.name AS name, COUNT(b.id) AS count FROM categories c LEFT JOIN bookmarks b ON b.category_id = c.id GROUP BY c.id ORDER BY c.name',
      )
      .all() as CategoryRow[];

    const totalCount = (db.prepare('SELECT COUNT(1) AS cnt FROM bookmarks').get() as { cnt: number }).cnt;
    const uncategorizedCount = (
      db.prepare('SELECT COUNT(1) AS cnt FROM bookmarks WHERE category_id IS NULL').get() as { cnt: number }
    ).cnt;

    return reply.send({ categories, totalCount, uncategorizedCount });
  });

  app.post('/api/categories', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    try {
      db.prepare('INSERT INTO categories (name, parent_id, created_at) VALUES (?, NULL, ?)').run(
        name,
        new Date().toISOString(),
      );

      const row = db.prepare('SELECT id, name FROM categories WHERE name = ?').get(name) as { id: number; name: string } | undefined;
      if (!row) return reply.code(500).send({ error: 'Operation failed' });

      return reply.send({ category: { id: row.id, name: row.name, count: 0 } });
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : '创建分类失败';
      if (message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'Operation failed' });
      }
      req.log.error({ err: e }, 'api create category failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.post(
    '/check',
    async (
      req: FastifyRequest<{ Body: { bookmark_ids?: string | string[]; redirect?: string; retries?: string; retry_delay_ms?: string } }>,
      reply: FastifyReply,
    ) => {
      const body = req.body || {};
      const raw = body.bookmark_ids;
      const redirectTo = safeRedirectTarget((body as any).redirect, '/');

      const retries = toIntClamp((body as any).retries, 0, 5, effectiveCheckRetries(checkRetries));
      const retryDelayMs = toIntClamp((body as any).retry_delay_ms, 0, 10_000, effectiveCheckRetryDelayMs(checkRetryDelayMs));

      const bookmarkIds: number[] = Array.isArray(raw)
        ? raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
        : typeof raw === 'string'
          ? [Number(raw)].filter((n) => Number.isInteger(n) && n > 0)
          : [];

      req.log.info({ bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check requested');

      if (bookmarkIds.length === 0) {
        return reply.redirect(withFlash(redirectTo, 'msg', '请选择要检查的书签'));
      }

      const job = createJob(db, 'check', '等待检查');
      req.log.info({ jobId: job.id }, 'check job queued');
      jobQueue.enqueue(job.id, async () => {
        const log = app.log.child({ jobId: job.id, jobType: 'check' });
        const startedAt = Date.now();
        try {
          log.info({ bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check job started');
          await runCheckJob(db, job.id, bookmarkIds, {
            concurrency: checkConcurrency,
            timeoutMs: checkTimeoutMs,
            retries,
            retryDelayMs,
            logger: log,
          });
          log.info({ durationMs: Date.now() - startedAt }, 'check job done');
        } catch (err) {
          log.error({ err, durationMs: Date.now() - startedAt }, 'check job failed');
          updateJob(db, job.id, { status: 'failed', message: '检查失败' });
        }
      });

      return reply.redirect('/jobs/' + job.id);
    },
  );

  type JobListRow = {
    id: string;
    type: string;
    status: string;
    total: number;
    processed: number;
    inserted: number;
    skipped: number;
    failed: number;
    message: string | null;
    created_at: string;
    updated_at: string;
  };

  app.get(
    '/jobs',
    async (req: FastifyRequest<{ Querystring: { page?: string } }>, reply: FastifyReply) => {
      try {
        pruneJobsToRecent(db, 10);
      } catch (e) {
        req.log.warn({ err: e }, 'prune jobs failed');
      }

      const pageParam = typeof req.query.page === 'string' ? req.query.page : '';
      const pageParsed = Number(pageParam);
      const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;
      const pageSize = 10;

      const total = (db.prepare('SELECT COUNT(1) AS cnt FROM jobs').get() as { cnt: number }).cnt;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const pageClamped = Math.min(Math.max(1, page), totalPages);
      const offset = (pageClamped - 1) * pageSize;

      const jobs = db
        .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(pageSize, offset) as JobListRow[];

      const pageUrlPrefix = '/jobs?page=';

      return reply.view('jobs.ejs', {
        jobs,
        page: pageClamped,
        totalPages,
        total,
        pageUrlPrefix,
      });
    },
  );

  app.get(
    '/api/jobs',
    async (req: FastifyRequest<{ Querystring: { page?: string } }>, reply: FastifyReply) => {
      const pageParam = typeof req.query.page === 'string' ? req.query.page : '';
      const pageParsed = Number(pageParam);
      const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;
      const pageSize = 10;

      const total = (db.prepare('SELECT COUNT(1) AS cnt FROM jobs').get() as { cnt: number }).cnt;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const pageClamped = Math.min(Math.max(1, page), totalPages);
      const offset = (pageClamped - 1) * pageSize;

      const jobs = db
        .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(pageSize, offset) as JobListRow[];

      return reply.send({ jobs, page: pageClamped, totalPages, total, pageSize });
    },
  );

  // 清理已完成任务
  app.post('/api/jobs/clear-completed', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // 获取要删除的任务ID
      const jobsToDelete = db.prepare(`SELECT id FROM jobs WHERE status IN ('done', 'failed', 'canceled')`).all() as Array<{ id: string }>;
      
      // 取消这些任务（如果还在队列中）
      for (const job of jobsToDelete) {
        jobQueue.cancelJob(job.id);
      }
      
      // 删除数据库记录
      const result = db.prepare(`DELETE FROM jobs WHERE status IN ('done', 'failed', 'canceled')`).run();
      // 同时清理相关的失败记录
      db.prepare(`DELETE FROM job_failures WHERE job_id NOT IN (SELECT id FROM jobs)`).run();
      
      return reply.send({ success: true, deleted: result.changes });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // 清空全部任务
  app.post('/api/jobs/clear-all', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // 取消所有任务
      jobQueue.cancelAll();
      
      // 将所有queued和running状态的任务标记为canceled
      db.prepare(`UPDATE jobs SET status = 'canceled', message = '已取消' WHERE status IN ('queued', 'running')`).run();
      
      // 删除所有任务记录
      const result = db.prepare(`DELETE FROM jobs`).run();
      db.prepare(`DELETE FROM job_failures`).run();
      
      return reply.send({ success: true, deleted: result.changes });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  type MultipartRequest = FastifyRequest & { file: () => Promise<MultipartFile | undefined> };

  app.post('/import', async (req: MultipartRequest, reply: FastifyReply) => {
    const wantsJson = /application\/json/i.test((req.headers as any)?.accept || '');
    let fileName: string | null = null;
    let fileMime: string | null = null;
    let fileBuf: Buffer | null = null;
    let checkAfterImport = false;
    let createCategories = false;
    let defaultCategoryId: number | null = null;
    try {
      // 使用 parts() 可靠读取 multipart 字段（避免 req.file() 读取后 body 字段缺失）
      const parts: any = (req as any).parts();
      for await (const part of parts) {
        if (part && part.type === 'file') {
          // 必须消费文件流，否则后续字段可能读取不到
          if (!fileBuf) {
            fileName = part.filename;
            fileMime = part.mimetype;
            fileBuf = await part.toBuffer();
          } else {
            // ignore extra files
            await part.toBuffer();
          }
          continue;
        }
        if (part && typeof part.fieldname === 'string' && part.fieldname === 'checkAfterImport') {
          const v = part.value;
          checkAfterImport = v === '1' || v === 'on' || v === true;
        }
        if (part && typeof part.fieldname === 'string' && part.fieldname === 'createCategories') {
          const v = part.value;
          createCategories = v === '1' || v === 'on' || v === true;
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
    req.log.info(
      {
        filename: fileName,
        mimetype: fileMime,
        size: buf.length,
      },
      'import file received',
    );

    const content = decodeImportBuffer(buf);
    const contentPreview = content.substring(0, 200).replace(/\s+/g, ' ');
    const items = parseImportContent(content);

    req.log.info(
      {
        filename: fileName,
        contentLength: content.length,
        contentPreview,
        itemCount: items.length,
      },
      'import parsed',
    );

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

    req.log.info({ checkAfterImport, createCategories }, 'import options parsed');

    const job = createJob(db, 'import', '已接收文件：' + fileName);
    req.log.info({ jobId: job.id }, 'import job queued');

    jobQueue.enqueue(job.id, async () => {
      const log = app.log.child({ jobId: job.id, jobType: 'import' });
      const startedAt = Date.now();
      try {
        log.info({ itemCount: items.length, checkAfterImport }, 'import job started');
        const res = await runImportJob(db, job.id, items, {
          defaultCategoryId,
          checkAfterImport,
          createCategories,
          logger: log,
        });

        log.info({ durationMs: Date.now() - startedAt, insertedCount: res.insertedIds.length }, 'import job done');

        if (checkAfterImport && res.insertedIds.length > 0) {
          const checkJob = createJob(db, 'check', '等待检查');
          // 更新导入任务消息，包含检查任务ID以便前端切换
          updateJob(db, job.id, { message: `导入完成，已创建检查任务：${checkJob.id}` });
          const checkLog = app.log.child({ jobId: checkJob.id, jobType: 'check' });
          try {
            const checkStartedAt = Date.now();
            checkLog.info({ bookmarkCount: res.insertedIds.length }, 'check job started (after import)');
            await runCheckJob(db, checkJob.id, res.insertedIds, {
              concurrency: checkConcurrency,
              timeoutMs: checkTimeoutMs,
              retries: effectiveCheckRetries(checkRetries),
              retryDelayMs: effectiveCheckRetryDelayMs(checkRetryDelayMs),
              logger: checkLog,
            });
            
            // 检查任务完成后，检查是否被取消
            const finalCheckJob = getJob(db, checkJob.id);
            if (finalCheckJob && finalCheckJob.status === 'canceled') {
              // 检查任务被取消，撤销已导入的书签
              checkLog.info({ bookmarkCount: res.insertedIds.length }, 'check canceled, rolling back imported bookmarks');
              const placeholders = res.insertedIds.map(() => '?').join(',');
              db.prepare(`DELETE FROM bookmarks WHERE id IN (${placeholders})`).run(...res.insertedIds);
              updateJob(db, job.id, { status: 'canceled', message: `检查已取消，已撤销导入的 ${res.insertedIds.length} 个书签` });
              return;
            }
            
            checkLog.info({ durationMs: Date.now() - checkStartedAt }, 'check job done (after import)');
          } catch (err) {
            checkLog.error({ err }, 'check job failed (after import)');
            updateJob(db, checkJob.id, { status: 'failed', message: '检查失败' });
          }
        }

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

  app.get(
    '/',
    async (
      req: FastifyRequest<{ Querystring: { category?: string; q?: string; page?: string; edit_bookmark?: string; edit_category?: string; msg?: string; err?: string } }>,
      reply: FastifyReply,
    ) => {
      const q = req.query;
      const categoryParam = typeof q.category === 'string' ? q.category : undefined;

      const keyword = typeof q.q === 'string' ? q.q.trim() : '';
      const pageParam = typeof q.page === 'string' ? q.page : '';
      const pageParsed = Number(pageParam);
      const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;
      const pageSize = 50;

      const activeCategoryId = categoryParam === 'uncategorized' ? 'uncategorized' : toInt(categoryParam);

      const categories = db
        .prepare(
          'SELECT c.id AS id, c.name AS name, COUNT(b.id) AS count FROM categories c LEFT JOIN bookmarks b ON b.category_id = c.id GROUP BY c.id ORDER BY c.name',
        )
        .all() as CategoryRow[];

      const totalCount = (db.prepare('SELECT COUNT(1) AS cnt FROM bookmarks').get() as { cnt: number }).cnt;
      const uncategorizedCount = (
        db.prepare('SELECT COUNT(1) AS cnt FROM bookmarks WHERE category_id IS NULL').get() as { cnt: number }
      ).cnt;

      const whereParts: string[] = [];
      const whereArgs: any[] = [];

      if (activeCategoryId === 'uncategorized') {
        whereParts.push('b.category_id IS NULL');
      } else if (typeof activeCategoryId === 'number') {
        whereParts.push('b.category_id = ?');
        whereArgs.push(activeCategoryId);
      }

      if (keyword) {
        whereParts.push('(b.title LIKE ? OR b.url LIKE ?)');
        whereArgs.push('%' + keyword + '%', '%' + keyword + '%');
      }

      const whereSql = whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : '';
      const offset = (page - 1) * pageSize;

      const totalMatches = (
        db
          .prepare('SELECT COUNT(1) AS cnt FROM bookmarks b ' + whereSql)
          .get(...whereArgs) as { cnt: number }
      ).cnt;

      const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));
      const pageClamped = Math.min(Math.max(1, page), totalPages);
      const offsetClamped = (pageClamped - 1) * pageSize;

      const bookmarkSqlBase = 'SELECT b.id AS id, b.url AS url, b.title AS title, b.created_at AS created_at, b.check_status AS check_status, b.last_checked_at AS last_checked_at, b.check_http_code AS check_http_code, b.check_error AS check_error, c.name AS category_name FROM bookmarks b LEFT JOIN categories c ON c.id = b.category_id ';

      const bookmarks = db
        .prepare(bookmarkSqlBase + whereSql + ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?')
        .all(...whereArgs, pageSize, offsetClamped) as BookmarkRow[];

      const selectedCategoryName =
        activeCategoryId === 'uncategorized'
          ? '未分类'
          : typeof activeCategoryId === 'number'
            ? (categories.find((c) => c.id === activeCategoryId)?.name ?? '分类')
            : '全部';

      const flash = req.query || {};

      const editBookmarkId = toInt(q.edit_bookmark);
      const editCategoryId = toInt(q.edit_category);

      const editBookmark =
        typeof editBookmarkId === 'number'
          ? (db
              .prepare('SELECT id, url, title, category_id FROM bookmarks WHERE id = ?')
              .get(editBookmarkId) as BookmarkEditRow | undefined)
          : undefined;

      const editCategory =
        typeof editCategoryId === 'number'
          ? (db.prepare('SELECT id, name FROM categories WHERE id = ?').get(editCategoryId) as CategoryEditRow | undefined)
          : undefined;

      const listQuery = new URLSearchParams();
      if (typeof q.category === 'string' && q.category) listQuery.set('category', q.category);
      if (keyword) listQuery.set('q', keyword);
      listQuery.set('page', String(pageClamped));

      const listUrl = '/?' + listQuery.toString();

      const pageQuery = new URLSearchParams();
      if (typeof q.category === 'string' && q.category) pageQuery.set('category', q.category);
      if (keyword) pageQuery.set('q', keyword);
      const pageUrlPrefix = '/?' + (pageQuery.toString() ? pageQuery.toString() + '&page=' : 'page=');

      const editBookmarkQuery = new URLSearchParams(listQuery);
      editBookmarkQuery.delete('msg');
      editBookmarkQuery.delete('err');
      editBookmarkQuery.delete('edit_category');
      const editBookmarkUrlPrefix = '/?' + editBookmarkQuery.toString() + '&edit_bookmark=';

      const editCategoryQuery = new URLSearchParams(listQuery);
      editCategoryQuery.delete('msg');
      editCategoryQuery.delete('err');
      editCategoryQuery.delete('edit_bookmark');
      const editCategoryUrlPrefix = '/?' + editCategoryQuery.toString() + '&edit_category=';

      return reply.view('index-new.ejs', {
        categories,
        totalCount,
        uncategorizedCount,
        bookmarks,
        activeCategoryId,
        selectedCategoryName,
        keyword,
        page: pageClamped,
        pageSize,
        totalMatches,
        totalPages,
        pageUrlPrefix,
        listUrl,
        editBookmarkUrlPrefix,
        editCategoryUrlPrefix,
        editBookmark: editBookmark || null,
        editCategory: editCategory || null,
        msg: flash.msg || null,
        err: flash.err || null,
      });
    },
  );

  app.post(
    '/categories',
    async (req: FastifyRequest<{ Body: { name?: string; redirect?: string } }>, reply: FastifyReply) => {
      const body = req.body || {};

      const redirectTo = safeRedirectTarget(body.redirect, '/');

      const name = (body.name || '').trim();

      if (!name) {
        return reply.redirect(withFlash(redirectTo, 'err', '分类名称不能为空'));
      }

      try {
        validateStringLength(name, 200, '分类名称');
        db.prepare('INSERT INTO categories (name, parent_id, created_at) VALUES (?, NULL, ?)').run(
          name,
          new Date().toISOString(),
        );
        req.log.info({ categoryName: name }, 'category created');
        return reply.redirect(withFlash(redirectTo, 'msg', '分类已创建'));
      } catch (e: any) {
        const message = typeof e?.message === 'string' ? e.message : '创建分类失败';
        if (message.includes('UNIQUE')) {
          return reply.redirect(withFlash(redirectTo, 'err', '分类已存在'));
        }
        req.log.error({ err: e }, 'create category failed');
        return reply.redirect(withFlash(redirectTo, 'err', '创建分类失败'));
      }
    },
  );

  app.post(
    '/categories/:id/update',
    async (req: FastifyRequest<{ Params: { id: string }; Body: { name?: string; redirect?: string } }>, reply: FastifyReply) => {
      const categoryId = toInt(req.params.id);
      const body = req.body || {};
      const redirectTo = safeRedirectTarget(body.redirect, '/');

      if (typeof categoryId !== 'number') {
        return reply.redirect(withFlash(redirectTo, 'err', '分类不存在'));
      }

      const name = (body.name || '').trim();
      if (!name) {
        return reply.redirect(withFlash(redirectTo, 'err', '分类名称不能为空'));
      }

      try {
        validateStringLength(name, 200, '分类名称');
        const res = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, categoryId);
        if (res.changes === 0) {
          req.log.warn({ categoryId }, 'category update failed: not found');
          return reply.redirect(withFlash(redirectTo, 'err', '分类不存在'));
        }
        req.log.info({ categoryId, newName: name }, 'category updated');
        return reply.redirect(withFlash(redirectTo, 'msg', '分类已更新'));
      } catch (e: any) {
        const message = typeof e?.message === 'string' ? e.message : '更新分类失败';
        if (message.includes('UNIQUE')) {
          return reply.redirect(withFlash(redirectTo, 'err', '分类已存在'));
        }
        req.log.error({ err: e }, 'update category failed');
        return reply.redirect(withFlash(redirectTo, 'err', '更新分类失败'));
      }
    },
  );

  app.post(
    '/categories/:id/delete',
    async (req: FastifyRequest<{ Params: { id: string }; Body: { redirect?: string } }>, reply: FastifyReply) => {
      const categoryId = toInt(req.params.id);
      const body = req.body || {};
      const redirectTo = safeRedirectTarget(body.redirect, '/');

      if (typeof categoryId !== 'number') {
        return reply.redirect(withFlash(redirectTo, 'err', '分类不存在'));
      }

      try {
        const res = db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
        if (res.changes === 0) {
          req.log.warn({ categoryId }, 'category delete failed: not found');
          return reply.redirect(withFlash(redirectTo, 'err', '分类不存在'));
        }
        req.log.info({ categoryId }, 'category deleted');
        return reply.redirect(withFlash(redirectTo, 'msg', '分类已删除'));
      } catch (e: any) {
        req.log.error({ err: e }, 'delete category failed');
        return reply.redirect(withFlash(redirectTo, 'err', '删除分类失败'));
      }
    },
  );

  app.post('/categories/batch-delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const raw = body['category_ids[]'] ?? body.category_ids;
    const ids: number[] = Array.isArray(raw)
      ? raw.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
      : typeof raw === 'string'
        ? [toInt(raw)].filter((n): n is number => n !== null)
        : [];

    if (ids.length === 0) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    if (ids.length > 100) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    try {
      const placeholders = ids.map(() => '?').join(',');
      const res = db.prepare('DELETE FROM categories WHERE id IN (' + placeholders + ')').run(...ids);
      req.log.info({ count: res.changes, ids }, 'batch delete categories');
      return reply.send({ success: true, deleted: res.changes });
    } catch (e: any) {
      req.log.error({ err: e }, 'batch delete categories failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.post(
    '/bookmarks',
    async (
      req: FastifyRequest<{ Body: { url?: string; title?: string; category_id?: string; redirect?: string } }>,
      reply: FastifyReply,
    ) => {
      const body = req.body || {};

      const redirectTo = safeRedirectTarget(body.redirect, '/');

      const urlInput = (body.url || '').trim();
      const titleInput = (body.title || '').trim();
      const categoryId = toInt(body.category_id);

      if (!urlInput) {
        return reply.redirect(withFlash(redirectTo, 'err', 'URL不能为空'));
      }

      const canon = canonicalizeUrl(urlInput);
      if (!canon.ok) {
        return reply.redirect(withFlash(redirectTo, 'err', canon.reason));
      }

      const title = titleInput || canon.normalizedUrl;

      try {
        validateStringLength(title, 500, '书签标题');
        const res = db.prepare(
          'INSERT INTO bookmarks (url, canonical_url, title, category_id, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(canon.normalizedUrl, canon.canonicalUrl, title, categoryId, new Date().toISOString());
        req.log.info({ bookmarkId: res.lastInsertRowid, url: urlInput, title, categoryId }, 'bookmark created');
        return reply.redirect(withFlash(redirectTo, 'msg', '书签已添加'));
      } catch (e: any) {
        const message = typeof e?.message === 'string' ? e.message : '添加失败';
        if (message.includes('UNIQUE')) {
          return reply.redirect(withFlash(redirectTo, 'msg', '书签已存在（按规范化URL去重）'));
        }
        req.log.error({ err: e }, 'create bookmark failed');
        return reply.redirect(withFlash(redirectTo, 'err', '添加书签失败'));
      }
    },
  );

  app.post(
    '/bookmarks/:id/update',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { url?: string; title?: string; category_id?: string; redirect?: string } }>,
      reply: FastifyReply,
    ) => {
      const bookmarkId = toInt(req.params.id);
      const body = req.body || {};

      const redirectTo = safeRedirectTarget(body.redirect, '/');

      if (typeof bookmarkId !== 'number') {
        return reply.redirect(withFlash(redirectTo, 'err', '书签不存在'));
      }

      const urlInput = (body.url || '').trim();
      const titleInput = (body.title || '').trim();
      const categoryId = toInt(body.category_id);

      if (!urlInput) {
        return reply.redirect(withFlash(redirectTo, 'err', 'URL不能为空'));
      }

      const canon = canonicalizeUrl(urlInput);
      if (!canon.ok) {
        return reply.redirect(withFlash(redirectTo, 'err', canon.reason));
      }

      const title = titleInput || canon.normalizedUrl;

      try {
        const res = db
          .prepare('UPDATE bookmarks SET url = ?, canonical_url = ?, title = ?, category_id = ?, last_checked_at = NULL, check_status = \'not_checked\', check_http_code = NULL, check_error = NULL WHERE id = ?')
          .run(canon.normalizedUrl, canon.canonicalUrl, title, categoryId, bookmarkId);

        if (res.changes === 0) {
          req.log.warn({ bookmarkId }, 'bookmark update failed: not found');
          return reply.redirect(withFlash(redirectTo, 'err', '书签不存在'));
        }
        req.log.info({ bookmarkId, url: urlInput, title, categoryId }, 'bookmark updated');
        return reply.redirect(withFlash(redirectTo, 'msg', '书签已更新'));
      } catch (e: any) {
        const message = typeof e?.message === 'string' ? e.message : '更新失败';
        if (message.includes('UNIQUE')) {
          return reply.redirect(withFlash(redirectTo, 'err', '该URL已存在（按规范化URL去重）'));
        }
        req.log.error({ err: e }, 'update bookmark failed');
        return reply.redirect(withFlash(redirectTo, 'err', '更新书签失败'));
      }
    },
  );

  app.post(
    '/bookmarks/:id/delete',
    async (req: FastifyRequest<{ Params: { id: string }; Body: { redirect?: string } }>, reply: FastifyReply) => {
      const bookmarkId = toInt(req.params.id);
      const wantsJson = /application\/json/i.test((req.headers as any)?.accept || '');
      const body = req.body || {};
      const redirectTo = safeRedirectTarget(body.redirect, '/');

      if (typeof bookmarkId !== 'number') {
        if (wantsJson) return reply.code(404).send({ error: 'Operation failed' });
        return reply.redirect(withFlash(redirectTo, 'err', '书签不存在'));
      }

      try {
        const res = db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);
        if (res.changes === 0) {
          req.log.warn({ bookmarkId }, 'bookmark delete failed: not found');
          if (wantsJson) return reply.code(404).send({ error: 'Operation failed' });
          return reply.redirect(withFlash(redirectTo, 'err', '书签不存在'));
        }
        req.log.info({ bookmarkId }, 'bookmark deleted');
        if (wantsJson) return reply.send({ success: true });
        return reply.redirect(withFlash(redirectTo, 'msg', '书签已删除'));
      } catch (e: any) {
        req.log.error({ err: e }, 'delete bookmark failed');
        if (wantsJson) return reply.code(500).send({ error: 'Operation failed' });
        return reply.redirect(withFlash(redirectTo, 'err', '删除书签失败'));
      }
    },
  );

  app.post('/bookmarks/batch-delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const raw = body['bookmark_ids[]'] ?? body.bookmark_ids;
    const ids: number[] = Array.isArray(raw)
      ? raw.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
      : typeof raw === 'string'
        ? [toInt(raw)].filter((n): n is number => n !== null)
        : [];

    if (ids.length === 0) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    if (ids.length > 1000) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    try {
      const placeholders = ids.map(() => '?').join(',');
      const res = db.prepare('DELETE FROM bookmarks WHERE id IN (' + placeholders + ')').run(...ids);
      req.log.info({ count: res.changes, ids }, 'batch delete bookmarks');
      return reply.send({ success: true, deleted: res.changes });
    } catch (e: any) {
      req.log.error({ err: e }, 'batch delete failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.get(
    '/api/bookmarks',
    async (
      req: FastifyRequest<{ Querystring: { 
        category?: string; 
        q?: string; 
        status?: string; 
        page?: string; 
        pageSize?: string;
        skip_check?: string;
        sort?: string;
        order?: string;
        date_from?: string;
        date_to?: string;
        domain?: string;
      } }>,
      reply: FastifyReply,
    ) => {
      const { category, q, status, skip_check, sort, order, date_from, date_to, domain } = req.query;
      const page = toIntClamp(req.query.page, 1, 10_000, 1);
      const pageSize = toIntClamp(req.query.pageSize, 10, 200, 50);

      let sql = 'SELECT b.id, b.url, b.title, b.created_at, b.check_status, b.last_checked_at, b.check_http_code, b.check_error, b.skip_check, b.category_id, c.name as category_name FROM bookmarks b LEFT JOIN categories c ON b.category_id = c.id ';
      const conditions: string[] = [];
      const params: any[] = [];

      // 分类筛选
      if (category === 'uncategorized') {
        conditions.push('b.category_id IS NULL');
      } else if (category) {
        const catId = toInt(category);
        if (catId !== null) {
          conditions.push('b.category_id = ?');
          params.push(catId);
        }
      }

      // 关键词搜索（支持多关键词，空格分隔）
      if (q) {
        const keywords = q.trim().split(/\s+/).filter(k => k.length > 0);
        if (keywords.length > 0) {
          const keywordConditions = keywords.map(() => '(b.title LIKE ? OR b.url LIKE ?)');
          conditions.push('(' + keywordConditions.join(' AND ') + ')');
          keywords.forEach(keyword => {
            params.push('%' + keyword + '%', '%' + keyword + '%');
          });
        }
      }

      // 状态筛选
      if (status && status !== 'all') {
        if (status === 'not_checked' || status === 'ok' || status === 'fail') {
          conditions.push('b.check_status = ?');
          params.push(status);
        }
      }

      // 忽略检查筛选
      if (skip_check === '1' || skip_check === 'true') {
        conditions.push('b.skip_check = 1');
      } else if (skip_check === '0' || skip_check === 'false') {
        conditions.push('b.skip_check = 0');
      }

      // 日期范围筛选
      if (date_from) {
        conditions.push('b.created_at >= ?');
        params.push(date_from);
      }
      if (date_to) {
        conditions.push('b.created_at <= ?');
        params.push(date_to + 'T23:59:59.999Z');
      }

      // 域名筛选
      if (domain) {
        conditions.push('b.url LIKE ?');
        params.push('%' + domain + '%');
      }

      const whereSql = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

      const total = (
        db.prepare('SELECT COUNT(1) AS cnt FROM bookmarks b' + whereSql).get(...params) as { cnt: number }
      ).cnt;

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const pageClamped = Math.min(Math.max(1, page), totalPages);
      const offset = (pageClamped - 1) * pageSize;

      sql += whereSql;
      
      // 排序
      const validSorts = ['id', 'title', 'url', 'created_at', 'check_status', 'last_checked_at'];
      const sortField = validSorts.includes(sort || '') ? sort : 'id';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
      sql += ` ORDER BY b.${sortField} ${sortOrder} LIMIT ? OFFSET ?`;
      
      const bookmarks = db.prepare(sql).all(...params, pageSize, offset);

      return reply.send({ bookmarks, total, page: pageClamped, pageSize, totalPages });
    },
  );

  app.post('/api/bookmarks', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const urlInput = typeof body.url === 'string' ? body.url.trim() : '';
    const titleInput = typeof body.title === 'string' ? body.title.trim() : '';
    const categoryId = toInt(body.category_id);

    if (!urlInput) return reply.code(400).send({ error: 'Operation failed' });

    const canon = canonicalizeUrl(urlInput);
    if (!canon.ok) return reply.code(400).send({ error: canon.reason });

    const title = titleInput || canon.normalizedUrl;

    try {
      const res = db
        .prepare('INSERT INTO bookmarks (url, canonical_url, title, category_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(canon.normalizedUrl, canon.canonicalUrl, title, categoryId, new Date().toISOString());

      const id = Number(res.lastInsertRowid);
      const row = db
        .prepare('SELECT b.id, b.url, b.title, b.created_at, b.check_status, b.last_checked_at, b.check_http_code, b.check_error, c.name as category_name FROM bookmarks b LEFT JOIN categories c ON b.category_id = c.id WHERE b.id = ?')
        .get(id);

      return reply.send({ bookmark: row });
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : '添加失败';
      if (message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'Operation failed' });
      }
      req.log.error({ err: e }, 'api create bookmark failed');
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.post(
    '/api/bookmarks/:id/update',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const bookmarkId = toInt(req.params.id);
      const body: any = req.body || {};
      if (typeof bookmarkId !== 'number') return reply.code(404).send({ error: 'Operation failed' });

      const urlInput = typeof body.url === 'string' ? body.url.trim() : '';
      const titleInput = typeof body.title === 'string' ? body.title.trim() : '';
      if (!urlInput) return reply.code(400).send({ error: 'Operation failed' });

      const canon = canonicalizeUrl(urlInput);
      if (!canon.ok) return reply.code(400).send({ error: canon.reason });

      const title = titleInput || canon.normalizedUrl;

      try {
        const prev = db
          .prepare('SELECT canonical_url FROM bookmarks WHERE id = ?')
          .get(bookmarkId) as { canonical_url: string } | undefined;
        if (!prev) return reply.code(404).send({ error: 'Operation failed' });

        const urlChanged = String(prev.canonical_url || '') !== String(canon.canonicalUrl || '');

        const sql = urlChanged
          ? 'UPDATE bookmarks SET url = ?, canonical_url = ?, title = ?, last_checked_at = NULL, check_status = \'not_checked\', check_http_code = NULL, check_error = NULL WHERE id = ?'
          : 'UPDATE bookmarks SET url = ?, canonical_url = ?, title = ? WHERE id = ?';

        const res = db.prepare(sql).run(canon.normalizedUrl, canon.canonicalUrl, title, bookmarkId);
        if (res.changes === 0) return reply.code(404).send({ error: 'Operation failed' });
        return reply.send({ success: true });
      } catch (e: any) {
        const message = typeof e?.message === 'string' ? e.message : '更新失败';
        if (message.includes('UNIQUE')) {
          return reply.code(409).send({ error: 'Operation failed' });
        }
        req.log.error({ err: e }, 'api update bookmark failed');
        return reply.code(500).send({ error: 'Operation failed' });
      }
    },
  );

  app.patch('/api/bookmarks/:id/status', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const bookmarkId = toInt(req.params.id);
    const body: any = req.body || {};
    if (typeof bookmarkId !== 'number') return reply.code(404).send({ error: '书签不存在' });

    const newStatus = body.status;
    if (!newStatus || !['not_checked', 'ok', 'fail'].includes(newStatus)) {
      return reply.code(400).send({ error: '无效的状态值' });
    }

    try {
      const res = db.prepare(
        'UPDATE bookmarks SET check_status = ? WHERE id = ?'
      ).run(newStatus, bookmarkId);
      
      if (res.changes === 0) return reply.code(404).send({ error: '书签不存在' });
      return reply.send({ success: true });
    } catch (e: any) {
      req.log.error({ err: e }, 'update bookmark status failed');
      return reply.code(500).send({ error: '更新失败' });
    }
  });

  app.patch('/api/bookmarks/:id/skip-check', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const bookmarkId = toInt(req.params.id);
    const body: any = req.body || {};
    if (typeof bookmarkId !== 'number') return reply.code(404).send({ error: '书签不存在' });

    const skipCheck = body.skip_check === true || body.skip_check === 1 || body.skip_check === '1';

    try {
      const res = db.prepare(
        'UPDATE bookmarks SET skip_check = ? WHERE id = ?'
      ).run(skipCheck ? 1 : 0, bookmarkId);
      
      if (res.changes === 0) return reply.code(404).send({ error: '书签不存在' });
      return reply.send({ success: true, skip_check: skipCheck });
    } catch (e: any) {
      req.log.error({ err: e }, 'update bookmark skip_check failed');
      return reply.code(500).send({ error: '更新失败' });
    }
  });

  app.post('/api/bookmarks/delete-all', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const res = db.prepare('DELETE FROM bookmarks').run();
      return reply.send({ success: true, deleted: res.changes });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Operation failed' });
    }
  });

  app.post('/api/check/start', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = req.body || {};
    const scope = typeof body.scope === 'string' ? body.scope : 'all';
    const retries = toIntClamp(body.retries, 0, 5, effectiveCheckRetries(checkRetries));
    const retryDelayMs = toIntClamp(body.retry_delay_ms, 0, 10_000, effectiveCheckRetryDelayMs(checkRetryDelayMs));

    const rawCategory = body.category ?? body.category_id;
    const category = typeof rawCategory === 'string' ? rawCategory : typeof rawCategory === 'number' ? String(rawCategory) : '';

    // Allow selected bookmark IDs
    const rawIds = body['bookmark_ids[]'] ?? body.bookmark_ids;
    let bookmarkIds: number[] = Array.isArray(rawIds)
      ? rawIds.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
      : typeof rawIds === 'string'
        ? [toInt(rawIds)].filter((n): n is number => n !== null)
        : [];

    // 支持多个分类ID
    const rawCategoryIds = body['category_ids[]'] ?? body.category_ids;
    let categoryIds: number[] = Array.isArray(rawCategoryIds)
      ? rawCategoryIds.map((x: any) => toInt(x)).filter((n: number | null): n is number => n !== null)
      : typeof rawCategoryIds === 'string'
        ? rawCategoryIds.split(',').map((s: string) => toInt(s.trim())).filter((n: number | null): n is number => n !== null)
        : [];

    if (bookmarkIds.length === 0) {
      let rows: Array<{ id: number }>;
      if (scope === 'selected') {
        return reply.code(400).send({ error: 'Operation failed' });
      } else if (scope === 'categories' && categoryIds.length > 0) {
        // 按多个分类检查
        const placeholders = categoryIds.map(() => '?').join(',');
        rows = db.prepare(`SELECT id FROM bookmarks WHERE category_id IN (${placeholders}) AND skip_check = 0 ORDER BY id`).all(...categoryIds) as Array<{ id: number }>;
      } else if (scope === 'category') {
        if (!category) {
          return reply.code(400).send({ error: 'Operation failed' });
        }
        if (category === 'uncategorized') {
          rows = db.prepare('SELECT id FROM bookmarks WHERE category_id IS NULL AND skip_check = 0 ORDER BY id').all() as Array<{ id: number }>;
        } else {
          const catId = toInt(category);
          if (catId === null) {
            return reply.code(400).send({ error: 'Operation failed' });
          }
          rows = db.prepare('SELECT id FROM bookmarks WHERE category_id = ? AND skip_check = 0 ORDER BY id').all(catId) as Array<{ id: number }>;
        }
      } else if (scope === 'not_checked') {
        rows = db.prepare("SELECT id FROM bookmarks WHERE check_status = 'not_checked' AND skip_check = 0 ORDER BY id").all() as Array<{ id: number }>;
      } else if (scope === 'failed') {
        rows = db.prepare("SELECT id FROM bookmarks WHERE check_status = 'fail' AND skip_check = 0 ORDER BY id").all() as Array<{ id: number }>;
      } else {
        rows = db.prepare('SELECT id FROM bookmarks WHERE skip_check = 0 ORDER BY id').all() as Array<{ id: number }>;
      }
      bookmarkIds = rows.map((x) => x.id);
    }

    if (bookmarkIds.length === 0) {
      return reply.code(400).send({ error: 'Operation failed' });
    }

    const job = createJob(db, 'check', '等待检查');
    req.log.info({ jobId: job.id }, 'check job queued via API');
    jobQueue.enqueue(job.id, async () => {
      const log = app.log.child({ jobId: job.id, jobType: 'check' });
      const startedAt = Date.now();
      try {
        log.info({ bookmarkCount: bookmarkIds.length, retries, retryDelayMs }, 'check job started');
        await runCheckJob(db, job.id, bookmarkIds, {
          concurrency: checkConcurrency,
          timeoutMs: checkTimeoutMs,
          retries,
          retryDelayMs,
          logger: log,
        });
        log.info({ durationMs: Date.now() - startedAt }, 'check job done');
      } catch (err) {
        log.error({ err, durationMs: Date.now() - startedAt }, 'check job failed');
        updateJob(db, job.id, { status: 'failed', message: '检查失败' });
      }
    });

    return reply.send({ jobId: job.id });
  });

  await app.listen({
    port,
    host: '0.0.0.0',
  });
  
  app.log.info({ port }, 'server started');

  const enabled = effectiveBackupEnabled(backupEnabled);
  if (enabled) {
    const interval = effectiveBackupIntervalMinutes(backupIntervalMinutes);
    const retention = effectiveBackupRetention(backupRetention);
    app.log.info({ backupDir, intervalMinutes: interval, retention }, 'auto backup enabled');
    const timer: any = setInterval(() => {
      try {
        const res = runBackupNow();
        if (res.skipped) {
          app.log.info('auto backup skipped: no bookmarks');
        } else {
          app.log.info({ fileName: res.fileName }, 'auto backup done');
        }
      } catch (err) {
        app.log.error({ err }, 'auto backup failed');
      }
    }, interval * 60 * 1000);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  // 启动定期检查定时器
  const isPeriodicCheckEnabled = effectivePeriodicCheckEnabled(periodicCheckEnabled);
  if (isPeriodicCheckEnabled) {
    const schedule = effectivePeriodicCheckSchedule(periodicCheckSchedule);
    const hour = effectivePeriodicCheckHour(periodicCheckHour);
    app.log.info({ schedule, hour }, 'periodic check enabled');
    
    let lastCheckDate = '';
    
    // 每小时检查一次是否到了执行时间
    const periodicCheckTimer: any = setInterval(async () => {
      try {
        const now = new Date();
        const currentHour = now.getHours();
        const currentDate = now.toISOString().split('T')[0];
        
        // 检查是否在指定小时
        if (currentHour !== hour) {
          return;
        }
        
        // 检查是否已经在今天执行过
        if (lastCheckDate === currentDate) {
          return;
        }
        
        // 检查是否符合周期（每周或每月）
        const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ...
        const dayOfMonth = now.getDate();
        
        if (schedule === 'weekly') {
          // 每周一执行
          if (dayOfWeek !== 1) {
            return;
          }
        } else if (schedule === 'monthly') {
          // 每月1号执行
          if (dayOfMonth !== 1) {
            return;
          }
        }
        
        // 获取所有书签ID（跳过标记为忽略检查的书签）
        const ids = db.prepare('SELECT id FROM bookmarks WHERE skip_check = 0 ORDER BY id').all() as Array<{ id: number }>;
        const bookmarkIds = ids.map(x => x.id);
        
        if (bookmarkIds.length > 0) {
          lastCheckDate = currentDate;
          
          // 创建定期检查任务
          const job = createJob(db, 'check', `定期检查中（${schedule === 'weekly' ? '每周' : '每月'}）`, bookmarkIds.length);
          app.log.info({ jobId: job.id, bookmarkCount: bookmarkIds.length, schedule }, 'periodic check job queued');
          
          jobQueue.enqueue(job.id, async () => {
            const log = app.log.child({ jobId: job.id, jobType: 'check' });
            try {
              await runCheckJob(db, job.id, bookmarkIds, {
                concurrency: checkConcurrency,
                timeoutMs: checkTimeoutMs,
                retries: effectiveCheckRetries(checkRetries),
                retryDelayMs: effectiveCheckRetryDelayMs(checkRetryDelayMs),
                logger: log,
              });
              
              updateJob(db, job.id, {
                status: 'done',
                message: `定期检查完成，共检查 ${bookmarkIds.length} 个书签`,
              });
              
              log.info('periodic check job completed');
            } catch (error: any) {
              log.error({ err: error }, 'periodic check job failed');
              updateJob(db, job.id, {
                status: 'failed',
                message: `定期检查失败: ${error.message || '未知错误'}`,
              });
            }
          });
        }
      } catch (err) {
        app.log.error({ err }, 'periodic check failed to start');
      }
    }, 60 * 60 * 1000); // 每小时检查一次
    
    if (typeof periodicCheckTimer?.unref === 'function') periodicCheckTimer.unref();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
