import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

interface AIConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    batchSize: string;
}

interface DiagnosticStepResult {
    ok: boolean;
    statusCode: number | null;
    durationMs: number;
    contentType: string | null;
    bodyPreview: string | null;
    errorName: string | null;
    errorMessage: string | null;
    modelFound?: boolean | null;
    modelCount?: number | null;
    sampleModelIds?: string[];
    replyPreview?: string | null;
}

interface DiagnosticReport {
    startedAt: string;
    finishedAt: string | null;
    sourceDbPath: string;
    reportPath: string;
    provider: {
        baseUrlMasked: string;
        modelMasked: string;
        batchSize: string;
        source: 'env' | 'settings_db';
    };
    timeouts: {
        modelsTimeoutMs: number;
        completionTimeoutMs: number;
    };
    steps: {
        models: DiagnosticStepResult;
        chatCompletion: DiagnosticStepResult;
    };
    failures: string[];
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
        reportPath: path.join(os.tmpdir(), `bookmarks-ai-provider-diagnose-${Date.now()}.json`),
        modelsTimeoutMs: 10_000,
        completionTimeoutMs: 30_000,
    };

    const args = { ...defaults };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--source-db') args.sourceDbPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--report') args.reportPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--models-timeout-ms') args.modelsTimeoutMs = Number(argv[++index]) || defaults.modelsTimeoutMs;
        else if (arg === '--completion-timeout-ms') args.completionTimeoutMs = Number(argv[++index]) || defaults.completionTimeoutMs;
        else if (arg === '--help') {
            console.log('Usage: ./node_modules/.bin/tsx scripts/ai-provider-diagnose.ts [--source-db data/app.db] [--report /tmp/report.json] [--models-timeout-ms 10000] [--completion-timeout-ms 30000]');
            process.exit(0);
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    return args;
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

function persistReport(reportPath: string, report: DiagnosticReport): void {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

function parseBody(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function bodyPreview(body: unknown, maxChars = 400): string | null {
    if (body === null || body === undefined) return null;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function buildBaseHeaders(apiKey: string): Record<string, string> {
    return {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
    };
}

function withPath(baseUrl: string, suffix: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

async function runModelsCheck(config: AIConfig, timeoutMs: number): Promise<DiagnosticStepResult> {
    const startedAt = Date.now();

    try {
        const response = await fetch(withPath(config.baseUrl, '/models'), {
            method: 'GET',
            headers: buildBaseHeaders(config.apiKey),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        const body = parseBody(text);
        const contentType = response.headers.get('content-type');
        const data = body && typeof body === 'object' && Array.isArray((body as { data?: unknown[] }).data)
            ? (body as { data: Array<{ id?: unknown }> }).data
            : null;
        const ids = data
            ?.map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
            .filter(Boolean) ?? [];

        return {
            ok: response.ok,
            statusCode: response.status,
            durationMs: Date.now() - startedAt,
            contentType,
            bodyPreview: bodyPreview(body),
            errorName: null,
            errorMessage: null,
            modelFound: data ? ids.includes(config.model) : null,
            modelCount: data ? ids.length : null,
            sampleModelIds: ids.slice(0, 5),
        };
    } catch (error) {
        return {
            ok: false,
            statusCode: null,
            durationMs: Date.now() - startedAt,
            contentType: null,
            bodyPreview: null,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : String(error),
            modelFound: null,
            modelCount: null,
            sampleModelIds: [],
        };
    }
}

async function runChatCompletionCheck(config: AIConfig, timeoutMs: number): Promise<DiagnosticStepResult> {
    const startedAt = Date.now();

    try {
        const response = await fetch(withPath(config.baseUrl, '/chat/completions'), {
            method: 'POST',
            headers: {
                ...buildBaseHeaders(config.apiKey),
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: config.model,
                messages: [{ role: 'user', content: 'Reply with OK only.' }],
                max_tokens: 10,
                temperature: 0,
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        const body = parseBody(text);
        const contentType = response.headers.get('content-type');
        const replyPreview =
            body && typeof body === 'object'
                ? bodyPreview((body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content ?? null)
                : null;

        return {
            ok: response.ok,
            statusCode: response.status,
            durationMs: Date.now() - startedAt,
            contentType,
            bodyPreview: bodyPreview(body),
            errorName: null,
            errorMessage: null,
            replyPreview,
        };
    } catch (error) {
        return {
            ok: false,
            statusCode: null,
            durationMs: Date.now() - startedAt,
            contentType: null,
            bodyPreview: null,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : String(error),
            replyPreview: null,
        };
    }
}

function collectFailures(report: DiagnosticReport): string[] {
    const failures: string[] = [];

    if (!report.steps.models.ok) {
        failures.push(`models check failed: ${report.steps.models.errorMessage ?? `status ${report.steps.models.statusCode ?? 'unknown'}`}`);
    } else if (report.steps.models.modelFound === false) {
        failures.push('configured model not found in /models response');
    }

    if (!report.steps.chatCompletion.ok) {
        failures.push(`chat completion failed: ${report.steps.chatCompletion.errorMessage ?? `status ${report.steps.chatCompletion.statusCode ?? 'unknown'}`}`);
    }

    return failures;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const { config, source } = loadAiConfig(args.sourceDbPath);

    const report: DiagnosticReport = {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        sourceDbPath: args.sourceDbPath,
        reportPath: args.reportPath,
        provider: {
            baseUrlMasked: maskBaseUrl(config.baseUrl),
            modelMasked: maskText(config.model, 6, 3),
            batchSize: config.batchSize,
            source,
        },
        timeouts: {
            modelsTimeoutMs: args.modelsTimeoutMs,
            completionTimeoutMs: args.completionTimeoutMs,
        },
        steps: {
            models: {
                ok: false,
                statusCode: null,
                durationMs: 0,
                contentType: null,
                bodyPreview: null,
                errorName: null,
                errorMessage: null,
                modelFound: null,
                modelCount: null,
                sampleModelIds: [],
            },
            chatCompletion: {
                ok: false,
                statusCode: null,
                durationMs: 0,
                contentType: null,
                bodyPreview: null,
                errorName: null,
                errorMessage: null,
                replyPreview: null,
            },
        },
        failures: [],
    };

    try {
        report.steps.models = await runModelsCheck(config, args.modelsTimeoutMs);
        persistReport(args.reportPath, report);

        report.steps.chatCompletion = await runChatCompletionCheck(config, args.completionTimeoutMs);
        report.failures = collectFailures(report);
        persistReport(args.reportPath, report);
    } finally {
        report.finishedAt = new Date().toISOString();
        report.failures = collectFailures(report);
        persistReport(args.reportPath, report);
    }

    console.log(`AI provider diagnostic report written to ${args.reportPath}`);
    console.log(`models: ${report.steps.models.ok ? 'ok' : 'failed'}; chat: ${report.steps.chatCompletion.ok ? 'ok' : 'failed'}`);

    if (report.failures.length > 0) {
        for (const failure of report.failures) console.error(`FAIL: ${failure}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
