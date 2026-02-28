import path from 'path';

import fs from 'fs';

import { randomUUID } from 'crypto';

import OpenAI from 'openai';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import type { MultipartFile } from '@fastify/multipart';
import session from '@fastify/session';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import ejs from 'ejs';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';

import { toInt, toIntClamp, escapeLikePattern, validateStringLength, decodeImportBuffer, withFlash, safeRedirectTarget, escapeHtml } from './utils/helpers';

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
import {
  getCategoryTree,
  getFlatCategories,
  getOrCreateCategoryByPath,
  createTopCategory,
  createSubCategory,
  renameCategory,
  moveCategory,
  deleteCategory as deleteCategoryService,
  deleteCategories as deleteCategoriesService,
  getCategoryById,
  getCategoryFullPath,
  type CategoryTreeNode,
  type FlatCategory,
} from './category-service';

// 路由模块
import { bookmarkRoutes, categoryRoutes, snapshotRoutes, backupRoutes, aiRoutes, authRoutes, settingsRoutes, jobsRoutes, checkRoutes, importRoutes, pagesRoutes, formsRoutes, type CategoryRow, type CategoryEditRow, type BookmarkRow, type BookmarkEditRow } from './routes';



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
  const snapshotsDir = process.env.SNAPSHOTS_DIR || path.join(path.dirname(dbPath), 'snapshots');

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
    bodyLimit: 52428800, // 50MB - 支持大型快照文件
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

  // CORS 支持 - 允许扩展跨域携带 Cookie
  await app.register(cors, {
    origin: true, // 允许所有来源（生产环境可限制为特定域名）
    credentials: true, // 允许携带 Cookie
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.register(cookie);
  await app.register(session, {
    secret: process.env.SESSION_SECRET || 'a-very-secret-key-change-in-production',
    cookie: {
      secure: 'auto', // 自动检测 HTTPS
      sameSite: 'lax', // 同站请求正常工作，跨站 GET 也可以
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
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

  // 注册路由模块
  await app.register(bookmarkRoutes, { db });
  await app.register(categoryRoutes, { db });
  await app.register(snapshotRoutes, { db, snapshotsDir });
  await app.register(backupRoutes, { db, backupDir, runBackupNow });
  await app.register(aiRoutes, { db, getSetting });
  await app.register(authRoutes, { db, staticApiToken });
  await app.register(settingsRoutes, {
    db, envFilePath, dbPath, backupDir,
    checkRetries, checkRetryDelayMs, backupEnabled, backupIntervalMinutes, backupRetention,
    periodicCheckEnabled, periodicCheckSchedule, periodicCheckHour,
    getSetting, setSetting, getIntSetting, getBoolSetting,
    effectiveCheckRetries, effectiveCheckRetryDelayMs, effectiveBackupEnabled,
    effectiveBackupIntervalMinutes, effectiveBackupRetention,
    effectivePeriodicCheckSchedule, effectivePeriodicCheckHour,
    writeDotEnvFile,
  });
  await app.register(jobsRoutes, { db });
  await app.register(checkRoutes, {
    db, checkConcurrency, checkTimeoutMs, checkRetries, checkRetryDelayMs,
    effectiveCheckRetries, effectiveCheckRetryDelayMs,
    toIntClamp, safeRedirectTarget, withFlash,
  });
  await app.register(importRoutes, { db });
  await app.register(pagesRoutes, { db, toIntClamp });
  await app.register(formsRoutes, { db, safeRedirectTarget, withFlash });

  // API Token 认证 + Session 认证（在 session 插件注册之后）
  app.addHook('preHandler', async (req, reply) => {
    // 跳过静态资源、登录页面和 session 认证端点
    if (req.url.startsWith('/public/') || req.url === '/login' || req.url === '/favicon.ico' || req.url === '/api/auth/session') {
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

      return reply.view('index.ejs', {
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

  app.get(
    '/api/bookmarks',
    async (
      req: FastifyRequest<{
        Querystring: {
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
        }
      }>,
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

  app.get(
    '/export',
    async (
      req: FastifyRequest<{
        Querystring: {
          format?: string;
          scope?: string;
          category?: string;
          categoryIds?: string;
        }
      }>,
      reply: FastifyReply,
    ) => {
      const format = req.query.format === 'json' ? 'json' : 'html';
      const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
      const category = typeof req.query.category === 'string' ? req.query.category : '';

      let rows: Array<{ url: string; title: string; category_name: string | null; created_at: string }>;
      if (scope === 'all' && !category) {
        rows = queryExportRows(db);
      } else {
        let sql = `
          SELECT
            b.url AS url,
            b.title AS title,
            b.created_at AS created_at,
            c.name AS category_name
          FROM bookmarks b
          LEFT JOIN categories c ON c.id = b.category_id
        `;
        const conditions: string[] = [];
        const params: any[] = [];

        if (scope === 'uncategorized' || category === 'uncategorized') {
          conditions.push('b.category_id IS NULL');
        } else if (scope === 'categories') {
          const idsRaw = typeof req.query.categoryIds === 'string' ? req.query.categoryIds : '';
          const ids = idsRaw
            .split(',')
            .map((x) => toInt(x.trim()))
            .filter((x): x is number => x !== null);
          if (ids.length === 0) {
            return reply.code(400).send({ error: '无效的分类参数' });
          }
          conditions.push(`b.category_id IN (${ids.map(() => '?').join(',')})`);
          params.push(...ids);
        } else if (category) {
          const categoryId = toInt(category);
          if (categoryId === null) {
            return reply.code(400).send({ error: '无效的分类参数' });
          }
          conditions.push('b.category_id = ?');
          params.push(categoryId);
        }

        if (conditions.length > 0) {
          sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY c.name, b.created_at DESC';
        rows = db.prepare(sql).all(...params) as Array<{ url: string; title: string; category_name: string | null; created_at: string }>;
      }

      if (format === 'json') {
        return reply
          .header('Content-Disposition', 'attachment; filename="bookmarks.json"')
          .type('application/json; charset=utf-8')
          .send(rows);
      }

      const html = buildNetscapeHtml(rows);
      return reply
        .header('Content-Disposition', 'attachment; filename="bookmarks.html"')
        .type('text/html; charset=utf-8')
        .send(html);
    },
  );

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
