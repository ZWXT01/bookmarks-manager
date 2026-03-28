import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApiToken } from '../../src/auth';
import { createTestApp, type TestAppContext } from '../helpers/app';
import {
    createBearerHeaders,
    createOriginHeaders,
    createSessionHeaders,
    extractSessionCookie,
} from '../helpers/auth';

describe('integration: app auth and hooks', () => {
    let ctx: TestAppContext;

    beforeEach(async () => {
        ctx = await createTestApp();
    });

    afterEach(async () => {
        if (ctx) await ctx.cleanup();
    });

    it('redirects anonymous page requests and blocks anonymous API requests', async () => {
        const pageResponse = await ctx.app.inject({
            method: 'GET',
            url: '/',
        });

        expect(pageResponse.statusCode).toBe(302);
        expect(pageResponse.headers.location).toBe('/login');

        const apiResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks',
        });

        expect(apiResponse.statusCode).toBe(401);
        expect(apiResponse.json()).toEqual({ error: 'Authentication required' });
    });

    it('creates a session from a bearer token and also supports bearer-only API access', async () => {
        const { token } = createApiToken(ctx.db, 'extension', 7);

        const sessionResponse = await ctx.app.inject({
            method: 'POST',
            url: '/api/auth/session',
            headers: createBearerHeaders(token, ctx.auth.baseUrl),
        });

        expect(sessionResponse.statusCode).toBe(200);
        expect(sessionResponse.json()).toMatchObject({ success: true });

        const sessionCookie = extractSessionCookie(sessionResponse);
        const cookieHeaders = createSessionHeaders(sessionCookie, ctx.auth.baseUrl);

        const sessionApiResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks',
            headers: cookieHeaders,
        });

        expect(sessionApiResponse.statusCode).toBe(200);
        expect(sessionApiResponse.json()).toMatchObject({
            bookmarks: [],
            total: 0,
            page: 1,
            pageSize: 50,
            totalPages: 1,
        });

        const bearerApiResponse = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks',
            headers: createBearerHeaders(token, ctx.auth.baseUrl),
        });

        expect(bearerApiResponse.statusCode).toBe(200);
        expect(bearerApiResponse.json().bookmarks).toEqual([]);
    });

    it('rejects expired API tokens', async () => {
        const { id, token } = createApiToken(ctx.db, 'expired', 1);
        ctx.db.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id);

        const response = await ctx.app.inject({
            method: 'GET',
            url: '/api/bookmarks',
            headers: createBearerHeaders(token, ctx.auth.baseUrl),
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'API token has expired' });
    });

    it('rejects mutating session requests when Origin and Referer are both missing', async () => {
        const session = await ctx.login();
        const { host } = createOriginHeaders(ctx.auth.baseUrl);

        const response = await ctx.app.inject({
            method: 'POST',
            url: '/api/jobs/clear-all',
            headers: {
                host,
                cookie: session.cookieHeader,
            },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'CSRF validation failed' });
    });

    it('rejects mutating session requests when the request origin does not match the host', async () => {
        const session = await ctx.login();
        const { host } = createOriginHeaders(ctx.auth.baseUrl);

        const response = await ctx.app.inject({
            method: 'POST',
            url: '/api/jobs/clear-all',
            headers: {
                host,
                origin: 'http://evil.example',
                referer: 'http://evil.example/form',
                cookie: session.cookieHeader,
            },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'CSRF validation failed' });
    });

    it('skips CSRF validation for bearer-token requests', async () => {
        const response = await ctx.app.inject({
            method: 'POST',
            url: '/api/jobs/clear-all',
            headers: {
                authorization: `Bearer ${ctx.auth.apiToken}`,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true, deleted: 0 });
    });
});
