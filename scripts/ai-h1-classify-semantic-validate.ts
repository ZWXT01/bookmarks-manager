import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import Database from 'better-sqlite3';

import { createOpenAIClient } from '../src/ai-client';
import { buildApp } from '../src/app';
import type { Db } from '../src/db';
import { applyTemplate, createTemplate, type CategoryNode, type TemplateRow } from '../src/template-service';

interface SemanticTemplate {
    id: string;
    name: string;
    tree: CategoryNode[];
}

interface SemanticSampleCase {
    id: string;
    templateId: string;
    title: string;
    url: string;
    description?: string;
    providerCategory: string;
    expectedCategory: string;
    acceptedCategories?: string[];
    notes?: string;
}

interface SemanticSampleDataset {
    templates: SemanticTemplate[];
    cases: SemanticSampleCase[];
}

interface AIConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    batchSize: string;
}

interface SemanticSampleResult {
    id: string;
    templateId: string;
    templateName: string;
    title: string;
    url: string;
    acceptedCategories: string[];
    actualCategory: string | null;
    accepted: boolean;
    attempts: number;
    statusCode: number;
    responseBody: unknown;
    notes?: string;
}

interface ValidationReport {
    startedAt: string;
    finishedAt: string | null;
    sourceDbPath: string;
    datasetPath: string;
    reportPath: string;
    tempDir: string | null;
    tempDirCleaned: boolean;
    provider: {
        baseUrlMasked: string;
        modelMasked: string;
        batchSize: string;
        timeoutCapMs: number;
        source: 'env' | 'settings_db';
    };
    totals: {
        samples: number;
        accepted: number;
        failed: number;
    };
    testRoute: {
        skipped: boolean;
        statusCode: number;
        ok: boolean;
        attempts: number;
        body: unknown;
    };
    results: SemanticSampleResult[];
    failures: string[];
}

function normalizeCategoryPath(value: string | null | undefined): string {
    return (value ?? '')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join('/');
}

function maskText(value: string, keepStart = 4, keepEnd = 3): string {
    if (!value) return '[missing]';
    if (value.length <= keepStart + keepEnd) return `${value.slice(0, 1)}***`;
    return `${value.slice(0, keepStart)}***${value.slice(-keepEnd)}`;
}

function maskBaseUrl(value: string): string {
    try {
        const parsed = new URL(value);
        return `${parsed.protocol}//${maskText(parsed.host, 2, 2)}${parsed.pathname && parsed.pathname !== '/' ? '/...' : ''}`;
    } catch {
        return '[masked-endpoint]';
    }
}

function parseArgs(argv: string[]) {
    const defaults = {
        sourceDbPath: path.resolve(process.cwd(), 'data', 'app.db'),
        datasetPath: path.resolve(process.cwd(), 'docs', 'planning', 'functional-hardening-and-ai-validation', 'fixtures', 'ai-classify-semantic-samples.json'),
        reportPath: path.join(os.tmpdir(), `bookmarks-ai-h1-classify-semantic-report-${Date.now()}.json`),
        keepTemp: false,
        timeoutCapMs: 60_000,
        retries: 2,
        skipTest: false,
        ids: [] as string[],
    };

    const args = { ...defaults };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--source-db') args.sourceDbPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--dataset') args.datasetPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--report') args.reportPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--keep-temp') args.keepTemp = true;
        else if (arg === '--timeout-cap-ms') args.timeoutCapMs = Number(argv[++index]) || defaults.timeoutCapMs;
        else if (arg === '--retries') args.retries = Number(argv[++index]) || defaults.retries;
        else if (arg === '--skip-test') args.skipTest = true;
        else if (arg === '--ids') args.ids = argv[++index].split(',').map((value) => value.trim()).filter(Boolean);
        else if (arg === '--help') {
            console.log('Usage: npx tsx scripts/ai-h1-classify-semantic-validate.ts [--source-db data/app.db] [--dataset path] [--report path] [--timeout-cap-ms 60000] [--retries 2] [--skip-test] [--ids sample-a,sample-b] [--keep-temp]');
            process.exit(0);
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    return args;
}

function loadDataset(datasetPath: string): SemanticSampleDataset {
    return JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as SemanticSampleDataset;
}

function loadAiConfig(sourceDbPath: string): { config: AIConfig; source: 'env' | 'settings_db' } {
    const envBaseUrl = process.env.H1_AI_BASE_URL?.trim();
    const envApiKey = process.env.H1_AI_API_KEY?.trim();
    const envModel = process.env.H1_AI_MODEL?.trim();
    const envBatchSize = process.env.H1_AI_BATCH_SIZE?.trim();

    if (envBaseUrl && envApiKey && envModel) {
        return {
            source: 'env',
            config: {
                baseUrl: envBaseUrl,
                apiKey: envApiKey,
                model: envModel,
                batchSize: envBatchSize || '30',
            },
        };
    }

    if (!fs.existsSync(sourceDbPath)) {
        throw new Error(`source DB not found: ${sourceDbPath}`);
    }

    const db = new Database(sourceDbPath, { readonly: true });
    try {
        const rows = db.prepare('SELECT key, value FROM settings WHERE key IN (?,?,?,?)')
            .all('ai_base_url', 'ai_api_key', 'ai_model', 'ai_batch_size') as Array<{ key: string; value: string }>;
        const map = new Map(rows.map((row) => [row.key, row.value]));
        const config = {
            baseUrl: (map.get('ai_base_url') ?? '').trim(),
            apiKey: (map.get('ai_api_key') ?? '').trim(),
            model: (map.get('ai_model') ?? '').trim(),
            batchSize: (map.get('ai_batch_size') ?? '30').trim() || '30',
        };
        if (!config.baseUrl || !config.apiKey || !config.model) {
            throw new Error('source DB does not contain a complete AI configuration');
        }
        return { config, source: 'settings_db' };
    } finally {
        db.close();
    }
}

function upsertSetting(db: Db, key: string, value: string): void {
    db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
}

function safeJson(responseBody: string): unknown {
    try {
        return JSON.parse(responseBody);
    } catch {
        return responseBody;
    }
}

function createBearerHeaders(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
}

function looksRetryableRouteError(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false;
    const error = typeof (body as Record<string, unknown>).error === 'string' ? (body as Record<string, unknown>).error : '';
    const normalized = error.toLowerCase();
    return normalized.includes('timed out') || normalized.includes('timeout') || normalized.includes('etimedout');
}

function persistReport(reportPath: string, report: ValidationReport): void {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

function refreshTotals(report: ValidationReport): void {
    report.totals.accepted = report.results.filter((entry) => entry.accepted).length;
    report.totals.failed = report.results.length - report.totals.accepted;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAcceptedCategories(sample: SemanticSampleCase): string[] {
    const accepted = sample.acceptedCategories?.map((value) => normalizeCategoryPath(value)).filter(Boolean) ?? [];
    if (accepted.length > 0) return accepted;
    return [normalizeCategoryPath(sample.expectedCategory)].filter(Boolean);
}

async function injectWithRetries(
    app: Awaited<ReturnType<typeof buildApp>>['app'],
    request: Parameters<typeof app.inject>[0],
    maxAttempts: number,
): Promise<{ response: Awaited<ReturnType<typeof app.inject>>; body: unknown; attempts: number }> {
    let lastResponse: Awaited<ReturnType<typeof app.inject>> | null = null;
    let lastBody: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await app.inject(request);
        const body = safeJson(response.body);
        lastResponse = response;
        lastBody = body;

        if (response.statusCode === 200) {
            return { response, body, attempts: attempt };
        }

        if (!looksRetryableRouteError(body) || attempt >= maxAttempts) {
            return { response, body, attempts: attempt };
        }

        await sleep(1_000);
    }

    return { response: lastResponse!, body: lastBody, attempts: maxAttempts };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dataset = loadDataset(args.datasetPath);
    const selectedIds = new Set(args.ids);
    const cases = selectedIds.size > 0
        ? dataset.cases.filter((sample) => selectedIds.has(sample.id))
        : dataset.cases;
    if (selectedIds.size > 0 && cases.length !== selectedIds.size) {
        const missing = [...selectedIds].filter((id) => !cases.some((sample) => sample.id === id));
        throw new Error(`unknown sample id(s): ${missing.join(', ')}`);
    }
    const { config, source } = loadAiConfig(args.sourceDbPath);

    const startedAt = new Date().toISOString();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-ai-h1-classify-semantic-'));
    const envFilePath = path.join(tempDir, '.env.h1');
    const dbPath = path.join(tempDir, 'data', 'app.db');
    const backupDir = path.join(tempDir, 'data', 'backups');
    const snapshotsDir = path.join(tempDir, 'data', 'snapshots');
    const apiToken = `h1-classify-token-${randomUUID()}`;

    const report: ValidationReport = {
        startedAt,
        finishedAt: null,
        sourceDbPath: args.sourceDbPath,
        datasetPath: args.datasetPath,
        reportPath: args.reportPath,
        tempDir,
        tempDirCleaned: false,
        provider: {
            baseUrlMasked: maskBaseUrl(config.baseUrl),
            modelMasked: maskText(config.model, 6, 3),
            batchSize: config.batchSize,
            timeoutCapMs: args.timeoutCapMs,
            source,
        },
        totals: {
            samples: cases.length,
            accepted: 0,
            failed: 0,
        },
        testRoute: {
            skipped: args.skipTest,
            statusCode: 0,
            ok: false,
            attempts: 0,
            body: null,
        },
        results: [],
        failures: [],
    };

    let appResult: Awaited<ReturnType<typeof buildApp>> | null = null;
    let finalizePromise: Promise<void> | null = null;

    const finalize = (failureMessage?: string) => {
        if (finalizePromise) return finalizePromise;
        finalizePromise = (async () => {
            if (failureMessage && !report.failures.includes(failureMessage)) {
                report.failures.push(failureMessage);
            }
            report.finishedAt = new Date().toISOString();
            refreshTotals(report);
            persistReport(args.reportPath, report);

            if (appResult) {
                await Promise.race([
                    appResult.app.close().catch(() => undefined),
                    sleep(2_000),
                ]);
            }

            if (!args.keepTemp && report.tempDir && !report.tempDirCleaned) {
                fs.rmSync(tempDir, { recursive: true, force: true });
                report.tempDir = null;
                report.tempDirCleaned = true;
                persistReport(args.reportPath, report);
            }
        })();
        return finalizePromise;
    };

    const handleSignal = (signal: NodeJS.Signals) => {
        void finalize(`validation interrupted by ${signal}`).finally(() => {
            process.exit(130);
        });
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    try {
        persistReport(args.reportPath, report);

        appResult = await buildApp({
            dbPath,
            envFilePath,
            backupDir,
            snapshotsDir,
            staticApiToken: apiToken,
            sessionSecret: `h1-classify-session-${randomUUID()}-${randomUUID()}`,
            backupEnabled: false,
            periodicCheckEnabled: false,
            logLevel: 'error',
            aiClientFactory: (options) => createOpenAIClient({
                ...options,
                timeout: Math.min(options.timeout, args.timeoutCapMs),
            }),
        });

        const { db, app } = appResult;

        for (const [key, value] of Object.entries({
            ai_base_url: config.baseUrl,
            ai_api_key: config.apiKey,
            ai_model: config.model,
            ai_batch_size: config.batchSize,
        })) {
            upsertSetting(db, key, value);
        }

        const templateRows = new Map<string, TemplateRow>();
        for (const template of dataset.templates) {
            const row = createTemplate(db, template.name, template.tree);
            templateRows.set(template.id, row);
        }

        const headers = createBearerHeaders(apiToken);

        if (!args.skipTest) {
            console.log('[H1 semantic] step: /api/ai/test');
            const testAttempt = await injectWithRetries(app, {
                method: 'POST',
                url: '/api/ai/test',
                headers,
                payload: {
                    base_url: config.baseUrl,
                    api_key: config.apiKey,
                    model: config.model,
                },
            }, args.retries);
            const testResponse = testAttempt.response;
            report.testRoute = {
                skipped: false,
                statusCode: testResponse.statusCode,
                ok: testResponse.statusCode === 200,
                attempts: testAttempt.attempts,
                body: testAttempt.body,
            };
            if (!report.testRoute.ok) {
                report.failures.push(`ai test route failed with status ${testResponse.statusCode} after ${testAttempt.attempts} attempt(s)`);
                persistReport(args.reportPath, report);
                throw new Error('H1 classify semantic validation aborted because /api/ai/test failed');
            }
        } else {
            report.testRoute = {
                skipped: true,
                statusCode: 0,
                ok: false,
                attempts: 0,
                body: { skipped: true },
            };
        }
        persistReport(args.reportPath, report);

        for (const sample of cases) {
            const template = templateRows.get(sample.templateId);
            if (!template) {
                report.failures.push(`sample ${sample.id} references unknown template ${sample.templateId}`);
                continue;
            }

            applyTemplate(db, template.id);

            const attempt = await injectWithRetries(app, {
                method: 'POST',
                url: '/api/ai/classify',
                headers,
                payload: {
                    title: sample.title,
                    url: sample.url,
                    description: sample.description ?? '',
                },
            }, args.retries);
            const response = attempt.response;
            const body = attempt.body;
            const jsonBody = body as Record<string, unknown>;
            const actualCategory = response.statusCode === 200 && typeof jsonBody.category === 'string'
                ? normalizeCategoryPath(jsonBody.category)
                : null;
            const acceptedCategories = getAcceptedCategories(sample);
            const accepted = acceptedCategories.includes(normalizeCategoryPath(actualCategory));

            report.results.push({
                id: sample.id,
                templateId: sample.templateId,
                templateName: template.name,
                title: sample.title,
                url: sample.url,
                acceptedCategories,
                actualCategory,
                accepted,
                attempts: attempt.attempts,
                statusCode: response.statusCode,
                responseBody: body,
                notes: sample.notes,
            });

            if (!accepted) {
                report.failures.push(
                    `sample ${sample.id} expected ${acceptedCategories.join(' | ')}, got ${actualCategory ?? `[status ${response.statusCode}]`}`,
                );
            }

            refreshTotals(report);
            persistReport(args.reportPath, report);
        }
        refreshTotals(report);
        persistReport(args.reportPath, report);
    } finally {
        process.removeListener('SIGINT', handleSignal);
        process.removeListener('SIGTERM', handleSignal);
        await finalize();
    }

    console.log(`H1 classify semantic validation report written to ${args.reportPath}`);
    console.log(`Accepted: ${report.totals.accepted}/${report.totals.samples}`);
    if (report.failures.length > 0) {
        for (const failure of report.failures) console.error(`FAIL: ${failure}`);
        process.exit(1);
    }
    process.exit(0);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
