import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestAppContext } from '../helpers/app';
import { createSessionHeaders } from '../helpers/auth';

const staticCssHref = '/public/tailwind.generated.css';
const runtimeTailwindHref = '/public/lib/tailwind.js';
const runtimeWarningText = 'cdn.tailwindcss.com should not be used in production';

describe('integration: page assets', () => {
    let ctx: TestAppContext;

    beforeEach(async () => {
        ctx = await createTestApp();
    });

    afterEach(async () => {
        if (ctx) await ctx.cleanup();
    });

    it('serves the login page with the static tailwind asset only', async () => {
        const response = await ctx.app.inject({
            method: 'GET',
            url: '/login',
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain(staticCssHref);
        expect(response.body).not.toContain(runtimeTailwindHref);
        expect(response.body).not.toContain(runtimeWarningText);
    });

    it('serves authenticated pages with the static tailwind asset only', async () => {
        const session = await ctx.login();
        const headers = createSessionHeaders(session.cookieHeader, ctx.auth.baseUrl);

        for (const pageUrl of ['/', '/settings', '/jobs', '/snapshots']) {
            const response = await ctx.app.inject({
                method: 'GET',
                url: pageUrl,
                headers,
            });

            expect(response.statusCode, `unexpected status for ${pageUrl}`).toBe(200);
            expect(response.body, `missing static css on ${pageUrl}`).toContain(staticCssHref);
            expect(response.body, `runtime tailwind leaked back on ${pageUrl}`).not.toContain(runtimeTailwindHref);
            expect(response.body, `runtime tailwind warning shim leaked back on ${pageUrl}`).not.toContain(runtimeWarningText);
        }
    });

    it('serves the generated tailwind asset as a static file', async () => {
        const response = await ctx.app.inject({
            method: 'GET',
            url: staticCssHref,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('.bg-slate-50');
        expect(response.body).toContain('.max-w-screen-2xl');
    });
});
