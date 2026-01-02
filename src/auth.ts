import type { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
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
