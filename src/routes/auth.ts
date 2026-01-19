/**
 * Authentication Routes
 */
import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { validateCredentials, changePassword, getUserInfo, getClientIp, createApiToken, listApiTokens, deleteApiToken, validateApiToken } from '../auth';
import { toInt } from '../utils/helpers';

export interface AuthRoutesOptions {
    db: Database;
    staticApiToken: string;
}

export const authRoutes: FastifyPluginCallback<AuthRoutesOptions> = (app, opts, done) => {
    const { db, staticApiToken } = opts;

    // GET /login - 登录页面
    app.get('/login', async (req: FastifyRequest, reply: FastifyReply) => {
        if (req.session.authenticated) {
            return reply.redirect('/');
        }
        return reply.view('login.ejs', { error: null });
    });

    // POST /login - 登录处理
    app.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = req.body as any;
        const username = (body.username || '').trim();
        const password = (body.password || '').trim();
        const remember = body.remember === 'on' || body.remember === true;
        const clientIp = getClientIp(req);

        const result = validateCredentials(db, username, password, clientIp);
        if (result.valid) {
            req.session.authenticated = true;
            req.session.username = username;

            if (remember) {
                req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
            }

            req.log.info({ username, ip: clientIp, remember }, 'user logged in');
            return reply.redirect('/');
        }

        req.log.warn({ username, ip: clientIp, error: result.error }, 'login failed');
        return reply.view('login.ejs', { error: result.error || '登录失败' });
    });

    // POST /logout - 登出
    app.post('/logout', async (req: FastifyRequest, reply: FastifyReply) => {
        req.session.destroy();
        return reply.redirect('/login');
    });

    // POST /api/auth/session - Token 换 Session
    app.post('/api/auth/session', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Missing or invalid Authorization header' });
        }

        const token = authHeader.slice(7);

        if (staticApiToken && token === staticApiToken) {
            req.session.authenticated = true;
            req.session.username = 'api';
            req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
            const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
            req.log.info({ type: 'static_token' }, 'extension session created');
            return reply.send({ success: true, expiresAt });
        }

        const tokenResult = validateApiToken(db, token);
        if (tokenResult.valid) {
            req.session.authenticated = true;
            req.session.username = 'api';
            req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
            const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
            req.log.info({ tokenId: tokenResult.tokenId }, 'extension session created');
            return reply.send({ success: true, expiresAt });
        }

        if (tokenResult.expired) {
            return reply.code(401).send({ error: 'API token has expired' });
        }
        return reply.code(401).send({ error: 'Invalid API token' });
    });

    // POST /api/change-password - 修改密码
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

    // GET /api/user-info - 获取用户信息
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

    // GET /api/tokens - 列出所有 API Tokens
    app.get('/api/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const tokens = listApiTokens(db);
            return reply.send({ tokens });
        } catch (e: any) {
            req.log.error({ err: e }, 'failed to list API tokens');
            return reply.code(500).send({ error: '获取 Token 列表失败' });
        }
    });

    // POST /api/tokens - 创建新的 API Token
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

    // DELETE /api/tokens/:id - 删除 API Token
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

    done();
};
