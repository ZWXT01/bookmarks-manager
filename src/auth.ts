import type { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Db } from './db';

// IP登录尝试记录（内存存储，重启后清空）
const ipAttempts: Map<string, { count: number; lockedUntil: number | null }> = new Map();

// 清理过期的IP记录（每小时清理一次）
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipAttempts.entries()) {
    if (data.lockedUntil && data.lockedUntil < now) {
      ipAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000);

// 初始化用户表
export function initUserTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )
  `);
  
  // 如果没有用户，创建默认管理员账号
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const defaultUsername = process.env.AUTH_USERNAME || 'admin';
    const defaultPassword = process.env.AUTH_PASSWORD || 'admin';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      defaultUsername, hash, now, now
    );
  }
}

export function checkAuth(req: FastifyRequest, reply: FastifyReply): void {
  // 支持 API Token 认证
  if ((req as any).apiTokenAuth) {
    return;
  }
  if (!req.session.authenticated) {
    reply.redirect('/login');
  }
}

// 获取客户端IP
export function getClientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',');
    return ips[0].trim();
  }
  return req.ip || 'unknown';
}

// 检查IP是否被锁定
export function checkIpLock(ip: string): { locked: boolean; remainingMinutes?: number } {
  const data = ipAttempts.get(ip);
  if (!data || !data.lockedUntil) return { locked: false };
  
  const now = Date.now();
  if (data.lockedUntil > now) {
    return { locked: true, remainingMinutes: Math.ceil((data.lockedUntil - now) / 60000) };
  }
  
  // 锁定已过期，清除记录
  ipAttempts.delete(ip);
  return { locked: false };
}

// 记录登录失败
export function recordLoginFailure(ip: string): { attemptsLeft: number; locked: boolean } {
  const data = ipAttempts.get(ip) || { count: 0, lockedUntil: null };
  data.count += 1;
  
  if (data.count >= 10) {
    // 10次失败后锁定该IP 30分钟
    data.lockedUntil = Date.now() + 30 * 60 * 1000;
    ipAttempts.set(ip, data);
    return { attemptsLeft: 0, locked: true };
  }
  
  ipAttempts.set(ip, data);
  return { attemptsLeft: 10 - data.count, locked: false };
}

// 登录成功后清除IP记录
export function clearIpAttempts(ip: string): void {
  ipAttempts.delete(ip);
}

// 测试辅助：清空 IP 限流状态
export function resetAuthStateForTests(): void {
  ipAttempts.clear();
}

// 验证凭据（基于IP限制，不锁定账号）
export function validateCredentials(db: Db, username: string, password: string, ip: string): { valid: boolean; error?: string; userId?: number } {
  // 先检查IP是否被锁定
  const ipLock = checkIpLock(ip);
  if (ipLock.locked) {
    return { valid: false, error: `该IP登录尝试次数过多，请 ${ipLock.remainingMinutes} 分钟后重试` };
  }

  try {
    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username) as {
      id: number;
      password_hash: string;
    } | undefined;

    if (!user) {
      // 回退到环境变量验证（兼容旧配置）
      const validUsername = process.env.AUTH_USERNAME || 'admin';
      const validPassword = process.env.AUTH_PASSWORD || 'admin';
      if (username === validUsername && password === validPassword) {
        clearIpAttempts(ip);
        return { valid: true };
      }
      const result = recordLoginFailure(ip);
      if (result.locked) {
        return { valid: false, error: '登录尝试次数过多，该IP已被锁定30分钟' };
      }
      return { valid: false, error: `用户名或密码错误，还剩 ${result.attemptsLeft} 次尝试机会` };
    }

    // 验证密码
    if (!bcrypt.compareSync(password, user.password_hash)) {
      const result = recordLoginFailure(ip);
      if (result.locked) {
        return { valid: false, error: '登录尝试次数过多，该IP已被锁定30分钟' };
      }
      return { valid: false, error: `密码错误，还剩 ${result.attemptsLeft} 次尝试机会` };
    }

    // 登录成功
    clearIpAttempts(ip);
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);
    
    return { valid: true, userId: user.id };
  } catch (e) {
    // 数据库错误时回退到环境变量验证
    const validUsername = process.env.AUTH_USERNAME || 'admin';
    const validPassword = process.env.AUTH_PASSWORD || 'admin';
    if (username === validUsername && password === validPassword) {
      clearIpAttempts(ip);
      return { valid: true };
    }
    const result = recordLoginFailure(ip);
    return { valid: false, error: `验证失败，还剩 ${result.attemptsLeft} 次尝试机会` };
  }
}

// 修改密码
export function changePassword(db: Db, username: string, oldPassword: string, newPassword: string): { success: boolean; error?: string } {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: '新密码长度至少6位' };
  }

  const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username) as {
    id: number;
    password_hash: string;
  } | undefined;

  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return { success: false, error: '原密码错误' };
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, now, user.id);

  return { success: true };
}

// 获取用户信息
export function getUserInfo(db: Db, username: string): { username: string; createdAt: string; lastLoginAt: string | null } | null {
  const user = db.prepare('SELECT username, created_at, last_login_at FROM users WHERE username = ?').get(username) as {
    username: string;
    created_at: string;
    last_login_at: string | null;
  } | undefined;

  if (!user) return null;

  return {
    username: user.username,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}


// ==================== API Token 管理 ====================

export interface ApiToken {
  id: number;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

// 生成安全的随机 Token
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// 哈希 Token（用于存储）
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// 创建新的 API Token
export function createApiToken(
  db: Db,
  name: string,
  expiresInDays?: number
): { token: string; id: number; prefix: string } {
  if (!name || name.trim().length === 0) {
    throw new Error('Token 名称不能为空');
  }
  if (name.length > 100) {
    throw new Error('Token 名称不能超过100个字符');
  }

  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const tokenPrefix = token.substring(0, 8) + '...';
  const now = new Date().toISOString();
  
  let expiresAt: string | null = null;
  if (expiresInDays && expiresInDays > 0) {
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + expiresInDays);
    expiresAt = expDate.toISOString();
  }

  const result = db.prepare(
    'INSERT INTO api_tokens (name, token_hash, token_prefix, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), tokenHash, tokenPrefix, now, expiresAt);

  return {
    token,
    id: result.lastInsertRowid as number,
    prefix: tokenPrefix,
  };
}

// 列出所有 API Tokens（不返回实际 token）
export function listApiTokens(db: Db): ApiToken[] {
  const rows = db.prepare(
    'SELECT id, name, token_prefix, created_at, last_used_at, expires_at FROM api_tokens ORDER BY created_at DESC'
  ).all() as ApiToken[];
  return rows;
}

// 删除 API Token
export function deleteApiToken(db: Db, id: number): boolean {
  const result = db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
  return result.changes > 0;
}

// 验证 API Token
export function validateApiToken(db: Db, token: string): { valid: boolean; tokenId?: number; expired?: boolean } {
  if (!token || token.length === 0) {
    return { valid: false };
  }

  const tokenHash = hashToken(token);
  const row = db.prepare(
    'SELECT id, expires_at FROM api_tokens WHERE token_hash = ?'
  ).get(tokenHash) as { id: number; expires_at: string | null } | undefined;

  if (!row) {
    return { valid: false };
  }

  // 检查是否过期
  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at);
    if (expiresAt < new Date()) {
      return { valid: false, expired: true };
    }
  }

  // 更新最后使用时间
  const now = new Date().toISOString();
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);

  return { valid: true, tokenId: row.id };
}

// 清理过期的 Tokens
export function cleanupExpiredTokens(db: Db): number {
  const now = new Date().toISOString();
  const result = db.prepare('DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < ?').run(now);
  return result.changes;
}
