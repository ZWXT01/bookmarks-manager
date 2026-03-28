import type { FastifyInstance } from 'fastify';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

export interface LoginSessionOptions {
    username: string;
    password: string;
    remember?: boolean;
    baseUrl?: string;
    headers?: Record<string, string>;
}

export interface SessionAuthResult {
    response: InjectResponse;
    cookieHeader: string;
    headers: Record<string, string>;
    origin: string;
    referer: string;
}

function toBaseUrl(baseUrl: string = 'http://127.0.0.1'): URL {
    return new URL(baseUrl);
}

export function createOriginHeaders(baseUrl: string = 'http://127.0.0.1'): Record<string, string> {
    const url = toBaseUrl(baseUrl);
    return {
        host: url.host,
        origin: url.origin,
        referer: `${url.origin}/`,
    };
}

function readSetCookieHeaders(response: InjectResponse): string[] {
    const raw = response.headers['set-cookie'];
    if (Array.isArray(raw)) return raw;
    return typeof raw === 'string' ? [raw] : [];
}

export function extractSessionCookie(response: InjectResponse): string {
    const cookies = readSetCookieHeaders(response)
        .map((value) => value.split(';', 1)[0])
        .filter(Boolean);

    if (cookies.length === 0) {
        throw new Error('Login response did not include a session cookie');
    }

    return cookies.join('; ');
}

export function createSessionHeaders(cookieHeader: string, baseUrl: string = 'http://127.0.0.1', headers: Record<string, string> = {}): Record<string, string> {
    return { ...createOriginHeaders(baseUrl), ...headers, cookie: cookieHeader };
}

export function createBearerHeaders(token: string, baseUrl: string = 'http://127.0.0.1', headers: Record<string, string> = {}): Record<string, string> {
    return { ...createOriginHeaders(baseUrl), ...headers, authorization: `Bearer ${token}` };
}

export async function loginWithSession(app: FastifyInstance, options: LoginSessionOptions): Promise<SessionAuthResult> {
    const originHeaders = createOriginHeaders(options.baseUrl);
    const form = new URLSearchParams({
        username: options.username,
        password: options.password,
    });

    if (options.remember) form.set('remember', 'on');

    const response = await app.inject({
        method: 'POST',
        url: '/login',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...originHeaders, ...(options.headers ?? {}) },
        payload: form.toString(),
    });

    if (response.statusCode >= 400) {
        throw new Error(`Login failed with status ${response.statusCode}: ${response.body}`);
    }

    const cookieHeader = extractSessionCookie(response);
    return {
        response,
        cookieHeader,
        headers: createSessionHeaders(cookieHeader, options.baseUrl, options.headers),
        origin: originHeaders.origin,
        referer: originHeaders.referer,
    };
}
