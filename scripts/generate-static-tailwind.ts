import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const viewsDir = path.join(repoRoot, 'views');
const publicDir = path.join(repoRoot, 'public');
const outputPath = path.join(publicDir, 'tailwind.generated.css');
const runtimeBundlePath = path.join(publicDir, 'lib', 'tailwind.js');

const standaloneUtilityTokens = new Set([
    'absolute',
    'block',
    'border',
    'card',
    'contents',
    'divide-y',
    'fixed',
    'flex',
    'grid',
    'group',
    'hidden',
    'inline',
    'italic',
    'relative',
    'rounded',
    'shadow',
    'sticky',
    'table',
    'truncate',
]);

async function listFiles(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) return listFiles(entryPath);
        return [entryPath];
    }));
    return files.flat();
}

function sanitizeInterpolations(value: string): string {
    return value
        .replace(/<%[\s\S]*?%>/g, ' ')
        .replace(/\$\{[\s\S]*?\}/g, ' ')
        .replace(/\\["'`]/g, ' ');
}

function isValidTokenShape(token: string): boolean {
    if (!token) return false;
    if (token.length > 96) return false;
    if (token.startsWith('/') || token.startsWith('http')) return false;
    if (token.includes('://')) return false;
    if (token.includes('.html') || token.includes('.js') || token.includes('.css') || token.includes('.ejs')) return false;
    if (/^[0-9]+$/.test(token)) return false;
    if (!/^-?[A-Za-z0-9_:/.[\]%!-]+$/.test(token)) return false;
    return true;
}

function isUtilityToken(token: string): boolean {
    if (!isValidTokenShape(token)) return false;
    return token.includes('-')
        || token.includes(':')
        || token.includes('[')
        || token.includes('/')
        || standaloneUtilityTokens.has(token);
}

function normalizeTokens(raw: string): string[] {
    const normalized = sanitizeInterpolations(raw);
    return normalized
        .split(/\s+/)
        .map((token) => token
            .trim()
            .replace(/^[,;([{]+/, '')
            .replace(/[)\]},;]+$/, '')
            .replace(/^["'`]+/, '')
            .replace(/["'`]+$/, ''))
        .filter(Boolean);
}

function addTrustedTokens(target: Set<string>, raw: string): void {
    for (const cleaned of normalizeTokens(raw)) {
        if (isValidTokenShape(cleaned)) {
            target.add(cleaned);
        }
    }
}

function looksLikeDynamicClassList(raw: string): boolean {
    const tokens = normalizeTokens(raw);
    if (tokens.length === 0) return false;

    if (tokens.length > 1) {
        return tokens.some((token) => isUtilityToken(token));
    }

    const [token] = tokens;
    return isUtilityToken(token) && !token.endsWith(':');
}

function addDynamicTokens(target: Set<string>, raw: string): void {
    if (!looksLikeDynamicClassList(raw)) return;

    for (const cleaned of normalizeTokens(raw)) {
        if (isUtilityToken(cleaned)) {
            target.add(cleaned);
        }
    }
}

function extractClasses(content: string): string[] {
    const classes = new Set<string>();
    const classAttrPattern = /(?:class|className|:class|x-bind:class)\s*=\s*(["'`])([\s\S]*?)\1/g;
    const quotedStringPattern = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;

    for (const match of content.matchAll(classAttrPattern)) {
        addTrustedTokens(classes, match[2]);
    }

    for (const match of content.matchAll(quotedStringPattern)) {
        addDynamicTokens(classes, match[2]);
    }

    return [...classes].sort();
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function collectClassNames(): Promise<string[]> {
    const viewFiles = (await listFiles(viewsDir)).filter((filePath) => filePath.endsWith('.ejs'));
    const sourceFiles = [
        ...viewFiles,
        path.join(publicDir, 'app.js'),
        path.join(publicDir, 'dialog.js'),
    ];

    const classNames = new Set<string>();
    for (const filePath of sourceFiles) {
        const content = await fs.readFile(filePath, 'utf8');
        for (const token of extractClasses(content)) {
            classNames.add(token);
        }
    }

    return [...classNames].sort();
}

function buildFixtureHtml(classNames: string[]): string {
    const elements = classNames
        .map((className) => `<div class="${escapeHtml(className)}"></div>`)
        .join('');

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="/tailwind.js"></script>
</head>
<body>${elements}</body>
</html>`;
}

async function generateCss(classNames: string[]): Promise<string> {
    const fixtureHtml = buildFixtureHtml(classNames);
    const bundle = await fs.readFile(runtimeBundlePath);
    const server = http.createServer((req, res) => {
        if (req.url === '/tailwind.js') {
            res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
            res.end(bundle);
            return;
        }

        if (req.url === '/fixture.html' || req.url === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(fixtureHtml);
            return;
        }

        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    assert(address && typeof address === 'object', 'Failed to bind static tailwind generator server');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', (message) => {
        if (message.type() === 'error') {
            console.error(`[tailwind-generator:console] ${message.text()}`);
        }
    });
    page.on('pageerror', (error) => {
        console.error(`[tailwind-generator:pageerror] ${error.stack || error.message}`);
    });
    page.on('requestfailed', (request) => {
        const failure = request.failure();
        console.error(`[tailwind-generator:requestfailed] ${request.url()} ${failure?.errorText || ''}`);
    });

    try {
        await page.goto(`http://127.0.0.1:${address.port}/fixture.html`, { waitUntil: 'load' });
        await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.className = 'bg-slate-50 max-w-screen-2xl';
            document.body.appendChild(probe);
            const currentConfig = (window as typeof window & { tailwind?: { config?: Record<string, unknown> } }).tailwind?.config || {};
            if ((window as typeof window & { tailwind?: { config?: Record<string, unknown> } }).tailwind) {
                (window as typeof window & { tailwind?: { config: Record<string, unknown> } }).tailwind!.config = { ...currentConfig };
            }
        });
        try {
            await page.waitForFunction(() => {
                const styles = Array.from(document.querySelectorAll('style'));
                return styles.some((style) => {
                    const css = style.textContent || '';
                    return css.includes('.bg-slate-50') && css.includes('.px-4') && css.includes('.rounded-lg');
                });
            }, undefined, { timeout: 120000 });
        } catch (error) {
            const debug = await page.evaluate(() => {
                const styles = Array.from(document.querySelectorAll('style')).map((style) => style.textContent || '');
                const longest = styles.sort((left, right) => right.length - left.length)[0] || '';
                return {
                    classElementCount: document.querySelectorAll('[class]').length,
                    styleCount: styles.length,
                    longestStylePreview: longest.slice(0, 1000),
                };
            });
            console.error('[tailwind-generator:debug]', JSON.stringify(debug, null, 2));
            throw error;
        }

        const css = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('style'))
                .map((style) => style.textContent || '')
                .sort((left, right) => right.length - left.length)[0] || '';
        });

        assert(css.includes('.bg-slate-50'), 'Generated CSS did not include expected utility .bg-slate-50');
        assert(css.includes('.px-4'), 'Generated CSS did not include expected utility .px-4');
        assert(css.includes('.rounded-lg'), 'Generated CSS did not include expected utility .rounded-lg');
        return css;
    } finally {
        await page.close();
        await browser.close();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

async function main(): Promise<void> {
    const classNames = await collectClassNames();
    const css = await generateCss(classNames);
    const header = [
        '/*',
        ' * Generated by scripts/generate-static-tailwind.ts',
        ' * Source: views/**/*.ejs, public/app.js, public/dialog.js',
        ' * Do not edit by hand.',
        ' */',
        '',
    ].join('\n');

    await fs.writeFile(outputPath, `${header}${css}\n`, 'utf8');
    console.log(`Generated ${path.relative(repoRoot, outputPath)} with ${classNames.length} class tokens.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
