import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { createOpenAIClient } from '../src/ai-client';
import { getPlan } from '../src/ai-organize-plan';
import { buildApp } from '../src/app';
import type { Db } from '../src/db';
import { getJob } from '../src/jobs';
import {
    loadValidationAIConfig,
    parseValidationProviderName,
    type ValidationAIConfig,
    type ValidationProviderName,
    type ValidationProviderSource,
} from '../src/provider-validation-config';
import { applyTemplate, createTemplate, type CategoryNode } from '../src/template-service';

interface SampleBookmark {
    id: string;
    title: string;
    url: string;
    acceptedCategories: string[];
}

interface ValidationDataset {
    template: {
        name: string;
        tree: CategoryNode[];
    };
    singleClassify: string[];
    bookmarks: SampleBookmark[];
}

interface RouteAttemptResult {
    attempt: number;
    durationMs: number;
    statusCode: number;
    ok: boolean;
    body: unknown;
}

interface DirectDiagnosticAttempt {
    attempt: number;
    durationMs: number;
    ok: boolean;
    statusCode: number | null;
    contentType: string | null;
    errorName: string | null;
    errorMessage: string | null;
    bodyPreview: string | null;
    modelFound?: boolean | null;
    modelCount?: number | null;
    replyPreview?: string | null;
}

interface ClassifyAttemptResult {
    attempt: number;
    durationMs: number;
    statusCode: number;
    actualCategory: string | null;
    accepted: boolean;
    body: unknown;
}

interface ClassifySampleSummary {
    id: string;
    title: string;
    url: string;
    acceptedCategories: string[];
    attempts: ClassifyAttemptResult[];
    distinctCategories: string[];
    allAccepted: boolean;
}

interface PlanJobSnapshot {
    elapsedMs: number;
    planStatus: string | null;
    jobStatus: string | null;
    jobMessage: string | null;
    assignedCount: number;
    needsReviewCount: number | null;
}

interface OrganizeSnapshot extends PlanJobSnapshot {
    activePlanId: string | null;
    pendingCount: number;
    pendingContainsPlan: boolean;
    detailStatus: string | null;
    detailAssignmentCount: number;
}

interface BatchFlowResult {
    request: {
        durationMs: number;
        statusCode: number;
        ok: boolean;
        body: unknown;
    };
    planId: string | null;
    jobId: string | null;
    timeline: PlanJobSnapshot[];
    timeToPreviewMs: number | null;
    timeToJobDoneMs: number | null;
    finalPlanStatus: string | null;
    finalJobStatus: string | null;
    needsReviewCount: number | null;
    assignedCount: number;
    acceptedCount: number;
    totalCount: number;
}

interface OrganizeFlowResult {
    request: {
        durationMs: number;
        statusCode: number;
        ok: boolean;
        body: unknown;
    };
    planId: string | null;
    jobId: string | null;
    timeline: OrganizeSnapshot[];
    activeObserved: boolean;
    pendingObserved: boolean;
    timeToActiveMs: number | null;
    timeToPendingMs: number | null;
    timeToPreviewMs: number | null;
    timeToJobDoneMs: number | null;
    timingNotes: string[];
    finalPlanStatus: string | null;
    finalJobStatus: string | null;
    needsReviewCount: number | null;
    assignedCount: number;
    acceptedCount: number;
    totalCount: number;
    apply: {
        durationMs: number;
        statusCode: number;
        ok: boolean;
        body: unknown;
        needsConfirm: boolean;
    } | null;
    rollback: {
        durationMs: number;
        statusCode: number;
        ok: boolean;
        body: unknown;
        restoredAllBookmarks: boolean;
    } | null;
}

interface ProviderRunReport {
    provider: {
        selected: ValidationProviderName;
        source: ValidationProviderSource;
        baseUrlMasked: string;
        modelMasked: string;
        batchSize: string;
    };
    tempDir: string | null;
    tempDirCleaned: boolean;
    directDiagnose: {
        models: DirectDiagnosticAttempt[];
        chatCompletions: DirectDiagnosticAttempt[];
    };
    routeTest: RouteAttemptResult[];
    classify: ClassifySampleSummary[];
    classifyBatch: BatchFlowResult | null;
    organize: OrganizeFlowResult | null;
    failures: string[];
}

interface SkippedProvider {
    provider: ValidationProviderName;
    reason: string;
}

interface TimingReport {
    startedAt: string;
    finishedAt: string | null;
    sourceDbPath: string;
    datasetPath: string;
    reportPath: string;
    providersRequested: ValidationProviderName[];
    providersRun: ProviderRunReport[];
    skippedProviders: SkippedProvider[];
    settings: {
        diagnoseAttempts: number;
        testAttempts: number;
        classifyAttempts: number;
        timeoutCapMs: number;
        pollIntervalMs: number;
    };
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

function isAcceptedCategory(actual: string | null, acceptedCategories: string[]): boolean {
    const normalized = normalizeCategoryPath(actual);
    return acceptedCategories.some((candidate) => normalizeCategoryPath(candidate) === normalized);
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

function parseProviders(rawValue: string): ValidationProviderName[] {
    const parsed = rawValue
        .split(',')
        .map((value) => parseValidationProviderName(value))
        .filter((value, index, array) => array.indexOf(value) === index);

    if (parsed.length > 0) return parsed;
    return ['grok', 'current'];
}

function parseArgs(argv: string[]) {
    const defaults = {
        sourceDbPath: path.resolve(process.cwd(), 'data', 'app.db'),
        datasetPath: path.resolve(process.cwd(), 'docs', 'planning', 'functional-hardening-and-ai-validation', 'fixtures', 'ai-h1-samples.json'),
        reportPath: path.join(os.tmpdir(), `bookmarks-ai-h1-timing-report-${Date.now()}.json`),
        providers: parseProviders(process.env.H1_AI_PROVIDERS ?? 'grok,current'),
        diagnoseAttempts: 2,
        testAttempts: 2,
        classifyAttempts: 2,
        timeoutCapMs: 45_000,
        pollIntervalMs: 250,
        keepTemp: false,
    };

    const args = { ...defaults };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--source-db') args.sourceDbPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--dataset') args.datasetPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--report') args.reportPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--providers') args.providers = parseProviders(argv[++index]);
        else if (arg === '--diagnose-attempts') args.diagnoseAttempts = Number(argv[++index]) || defaults.diagnoseAttempts;
        else if (arg === '--test-attempts') args.testAttempts = Number(argv[++index]) || defaults.testAttempts;
        else if (arg === '--classify-attempts') args.classifyAttempts = Number(argv[++index]) || defaults.classifyAttempts;
        else if (arg === '--timeout-cap-ms') args.timeoutCapMs = Number(argv[++index]) || defaults.timeoutCapMs;
        else if (arg === '--poll-interval-ms') args.pollIntervalMs = Number(argv[++index]) || defaults.pollIntervalMs;
        else if (arg === '--keep-temp') args.keepTemp = true;
        else if (arg === '--help') {
            console.log(
                'Usage: npx tsx scripts/ai-h1-timing-validate.ts ' +
                '[--source-db data/app.db] [--dataset path] [--report /tmp/report.json] ' +
                '[--providers grok,current] [--diagnose-attempts 2] [--test-attempts 2] [--classify-attempts 2] ' +
                '[--timeout-cap-ms 45000] [--poll-interval-ms 250] [--keep-temp]',
            );
            process.exit(0);
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    return args;
}

function loadDataset(datasetPath: string): ValidationDataset {
    return JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as ValidationDataset;
}

function persistReport(reportPath: string, report: TimingReport): void {
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

function previewBody(body: unknown, maxChars = 400): string | null {
    if (body === null || body === undefined) return null;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function extractSsePreview(text: string): string | null {
    const chunks: string[] = [];

    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
            const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string }; message?: { content?: string }; text?: string }>;
            };
            const content = parsed.choices?.[0]?.delta?.content
                ?? parsed.choices?.[0]?.message?.content
                ?? parsed.choices?.[0]?.text
                ?? '';
            if (content) chunks.push(content);
        } catch {
            continue;
        }
    }

    const combined = chunks.join('').trim();
    return combined || null;
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

async function runModelsCheck(config: ValidationAIConfig, timeoutMs: number): Promise<DirectDiagnosticAttempt> {
    const startedAt = Date.now();

    try {
        const response = await fetch(withPath(config.baseUrl, '/models'), {
            method: 'GET',
            headers: buildBaseHeaders(config.apiKey),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        const body = parseBody(text);
        const data = body && typeof body === 'object' && Array.isArray((body as { data?: unknown[] }).data)
            ? (body as { data: Array<{ id?: unknown }> }).data
            : null;
        const ids = data?.map((entry) => (typeof entry?.id === 'string' ? entry.id : '')).filter(Boolean) ?? [];

        return {
            attempt: 0,
            durationMs: Date.now() - startedAt,
            ok: response.ok,
            statusCode: response.status,
            contentType: response.headers.get('content-type'),
            errorName: null,
            errorMessage: null,
            bodyPreview: previewBody(body),
            modelFound: data ? ids.includes(config.model) : null,
            modelCount: data ? ids.length : null,
        };
    } catch (error) {
        return {
            attempt: 0,
            durationMs: Date.now() - startedAt,
            ok: false,
            statusCode: null,
            contentType: null,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : String(error),
            bodyPreview: null,
            modelFound: null,
            modelCount: null,
        };
    }
}

async function runChatCompletionCheck(config: ValidationAIConfig, timeoutMs: number): Promise<DirectDiagnosticAttempt> {
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
        const contentType = response.headers.get('content-type');
        const body = parseBody(text);
        const replyPreview = contentType?.includes('text/event-stream')
            ? extractSsePreview(text)
            : previewBody(
                body && typeof body === 'object'
                    ? (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content ?? null
                    : null,
            );

        return {
            attempt: 0,
            durationMs: Date.now() - startedAt,
            ok: response.ok,
            statusCode: response.status,
            contentType,
            errorName: null,
            errorMessage: null,
            bodyPreview: previewBody(body),
            replyPreview,
        };
    } catch (error) {
        return {
            attempt: 0,
            durationMs: Date.now() - startedAt,
            ok: false,
            statusCode: null,
            contentType: null,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : String(error),
            bodyPreview: null,
            replyPreview: null,
        };
    }
}

function createBearerHeaders(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function upsertSetting(db: Db, key: string, value: string): void {
    db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
}

function insertBookmarks(db: Db, bookmarks: SampleBookmark[]) {
    const insert = db.prepare(`
        INSERT INTO bookmarks (url, canonical_url, title, category_id, created_at, check_status)
        VALUES (?, ?, ?, NULL, datetime('now'), 'not_checked')
    `);

    const ids = new Map<string, number>();
    for (const bookmark of bookmarks) {
        const result = insert.run(bookmark.url, bookmark.url, bookmark.title);
        ids.set(bookmark.id, Number(result.lastInsertRowid));
    }

    return ids;
}

function parseAssignments(raw: string | null | undefined): Array<{ bookmark_id: number; category_path: string; status: string }> {
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as Array<{ bookmark_id: number; category_path: string; status: string }> : [];
}

function assignedCountFromPlan(plan: ReturnType<typeof getPlan> | null): number {
    const assignments = parseAssignments(plan?.assignments);
    return assignments.filter((assignment) => assignment.status === 'assigned').length;
}

function evaluateAcceptedCount(
    assignments: Array<{ bookmark_id: number; category_path: string; status: string }>,
    sampleByBookmarkId: Map<number, SampleBookmark>,
): { acceptedCount: number; totalCount: number } {
    let acceptedCount = 0;

    for (const assignment of assignments) {
        const sample = sampleByBookmarkId.get(assignment.bookmark_id);
        const actualCategory = assignment.status === 'needs_review' ? null : normalizeCategoryPath(assignment.category_path);
        if (sample && isAcceptedCategory(actualCategory, sample.acceptedCategories)) {
            acceptedCount += 1;
        }
    }

    return { acceptedCount, totalCount: assignments.length };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function injectTimed(
    app: Awaited<ReturnType<typeof buildApp>>['app'],
    request: Parameters<Awaited<ReturnType<typeof buildApp>>['app']['inject']>[0],
) {
    const startedAt = Date.now();
    const response = await app.inject(request);
    return {
        response,
        durationMs: Date.now() - startedAt,
        body: safeJson(response.body),
    };
}

function snapshotsEqual<T extends Record<string, unknown>>(left: T | null, right: T): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function getTimelineTimeoutMs(timeoutCapMs: number, sampleCount: number): number {
    return Math.max(120_000, timeoutCapMs * Math.max(sampleCount, 1) * 5);
}

async function collectPlanJobTimeline(args: {
    db: Db;
    planId: string;
    jobId: string | null;
    pollIntervalMs: number;
    timeoutMs: number;
}) {
    const startedAt = Date.now();
    const timeline: PlanJobSnapshot[] = [];
    let lastSnapshot: PlanJobSnapshot | null = null;
    let timeToPreviewMs: number | null = null;
    let timeToJobDoneMs: number | null = null;

    while (Date.now() - startedAt <= args.timeoutMs) {
        const plan = getPlan(args.db, args.planId);
        const job = args.jobId ? getJob(args.db, args.jobId) : null;
        const snapshot: PlanJobSnapshot = {
            elapsedMs: Date.now() - startedAt,
            planStatus: plan?.status ?? null,
            jobStatus: job?.status ?? null,
            jobMessage: job?.message ?? null,
            assignedCount: assignedCountFromPlan(plan),
            needsReviewCount: plan?.needs_review_count ?? null,
        };

        if (!snapshotsEqual(lastSnapshot, snapshot)) {
            timeline.push(snapshot);
            lastSnapshot = snapshot;
        }

        if (timeToPreviewMs === null && snapshot.planStatus === 'preview') {
            timeToPreviewMs = snapshot.elapsedMs;
        }
        if (timeToJobDoneMs === null && snapshot.jobStatus === 'done') {
            timeToJobDoneMs = snapshot.elapsedMs;
        }

        if (
            snapshot.planStatus !== 'assigning' &&
            (!args.jobId || ['done', 'failed', 'canceled'].includes(snapshot.jobStatus ?? ''))
        ) {
            return { timeline, timeToPreviewMs, timeToJobDoneMs };
        }

        await sleep(args.pollIntervalMs);
    }

    return { timeline, timeToPreviewMs, timeToJobDoneMs };
}

async function collectOrganizeTimeline(args: {
    app: Awaited<ReturnType<typeof buildApp>>['app'];
    db: Db;
    headers: Record<string, string>;
    planId: string;
    jobId: string | null;
    pollIntervalMs: number;
    timeoutMs: number;
}) {
    const startedAt = Date.now();
    const timeline: OrganizeSnapshot[] = [];
    let lastSnapshot: OrganizeSnapshot | null = null;
    let timeToActiveMs: number | null = null;
    let timeToPendingMs: number | null = null;
    let timeToPreviewMs: number | null = null;
    let timeToJobDoneMs: number | null = null;

    while (Date.now() - startedAt <= args.timeoutMs) {
        const plan = getPlan(args.db, args.planId);
        const job = args.jobId ? getJob(args.db, args.jobId) : null;

        const active = await args.app.inject({
            method: 'GET',
            url: '/api/ai/organize/active',
            headers: args.headers,
        });
        const activeBody = safeJson(active.body) as Record<string, unknown>;
        const activePlanId = typeof activeBody.id === 'string'
            ? activeBody.id
            : activeBody.active && typeof activeBody.active === 'object' && activeBody.active && typeof (activeBody.active as Record<string, unknown>).id === 'string'
                ? (activeBody.active as Record<string, unknown>).id as string
                : null;

        const pending = await args.app.inject({
            method: 'GET',
            url: '/api/ai/organize/pending',
            headers: args.headers,
        });
        const pendingBody = safeJson(pending.body) as { plans?: Array<{ id?: unknown }> };
        const pendingPlanIds = Array.isArray(pendingBody.plans)
            ? pendingBody.plans.map((entry) => (typeof entry.id === 'string' ? entry.id : '')).filter(Boolean)
            : [];

        const detail = await args.app.inject({
            method: 'GET',
            url: `/api/ai/organize/${args.planId}`,
            headers: args.headers,
        });
        const detailBody = safeJson(detail.body) as Record<string, unknown>;
        const detailAssignments = Array.isArray(detailBody.assignments) ? detailBody.assignments.length : 0;

        const snapshot: OrganizeSnapshot = {
            elapsedMs: Date.now() - startedAt,
            planStatus: plan?.status ?? null,
            jobStatus: job?.status ?? null,
            jobMessage: job?.message ?? null,
            assignedCount: assignedCountFromPlan(plan),
            needsReviewCount: plan?.needs_review_count ?? null,
            activePlanId,
            pendingCount: pendingPlanIds.length,
            pendingContainsPlan: pendingPlanIds.includes(args.planId),
            detailStatus: typeof detailBody.status === 'string' ? detailBody.status : null,
            detailAssignmentCount: detailAssignments,
        };

        if (!snapshotsEqual(lastSnapshot, snapshot)) {
            timeline.push(snapshot);
            lastSnapshot = snapshot;
        }

        if (timeToActiveMs === null && snapshot.activePlanId === args.planId) {
            timeToActiveMs = snapshot.elapsedMs;
        }
        if (timeToPendingMs === null && snapshot.pendingContainsPlan) {
            timeToPendingMs = snapshot.elapsedMs;
        }
        if (timeToPreviewMs === null && snapshot.planStatus === 'preview') {
            timeToPreviewMs = snapshot.elapsedMs;
        }
        if (timeToJobDoneMs === null && snapshot.jobStatus === 'done') {
            timeToJobDoneMs = snapshot.elapsedMs;
        }

        if (
            snapshot.planStatus !== 'assigning' &&
            (!args.jobId || ['done', 'failed', 'canceled'].includes(snapshot.jobStatus ?? '')) &&
            snapshot.activePlanId === null
        ) {
            return { timeline, timeToActiveMs, timeToPendingMs, timeToPreviewMs, timeToJobDoneMs };
        }

        await sleep(args.pollIntervalMs);
    }

    return { timeline, timeToActiveMs, timeToPendingMs, timeToPreviewMs, timeToJobDoneMs };
}

async function runProviderValidation(args: {
    provider: ValidationProviderName;
    loaded: {
        provider: ValidationProviderName;
        source: ValidationProviderSource;
        config: ValidationAIConfig;
    };
    dataset: ValidationDataset;
    sourceDbPath: string;
    diagnoseAttempts: number;
    testAttempts: number;
    classifyAttempts: number;
    timeoutCapMs: number;
    pollIntervalMs: number;
    keepTemp: boolean;
}) {
    const providerReport: ProviderRunReport = {
        provider: {
            selected: args.provider,
            source: args.loaded.source,
            baseUrlMasked: maskBaseUrl(args.loaded.config.baseUrl),
            modelMasked: maskText(args.loaded.config.model, 6, 3),
            batchSize: args.loaded.config.batchSize,
        },
        tempDir: null,
        tempDirCleaned: false,
        directDiagnose: {
            models: [],
            chatCompletions: [],
        },
        routeTest: [],
        classify: [],
        classifyBatch: null,
        organize: null,
        failures: [],
    };

    for (let attempt = 1; attempt <= args.diagnoseAttempts; attempt += 1) {
        const models = await runModelsCheck(args.loaded.config, args.timeoutCapMs);
        models.attempt = attempt;
        providerReport.directDiagnose.models.push(models);
        if (!models.ok) {
            providerReport.failures.push(`${args.provider} /models attempt ${attempt} failed: ${models.errorMessage ?? `status ${models.statusCode ?? 'unknown'}`}`);
        } else if (models.modelFound === false) {
            providerReport.failures.push(`${args.provider} /models attempt ${attempt} did not include configured model`);
        }

        const chat = await runChatCompletionCheck(args.loaded.config, args.timeoutCapMs);
        chat.attempt = attempt;
        providerReport.directDiagnose.chatCompletions.push(chat);
        if (!chat.ok) {
            providerReport.failures.push(`${args.provider} /chat/completions attempt ${attempt} failed: ${chat.errorMessage ?? `status ${chat.statusCode ?? 'unknown'}`}`);
        }
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `bookmarks-ai-h1-timing-${args.provider}-`));
    providerReport.tempDir = tempDir;

    const envFilePath = path.join(tempDir, '.env.h1');
    const dbPath = path.join(tempDir, 'data', 'app.db');
    const backupDir = path.join(tempDir, 'data', 'backups');
    const snapshotsDir = path.join(tempDir, 'data', 'snapshots');
    const apiToken = `h1-timing-token-${args.provider}-${randomUUID()}`;

    let appResult: Awaited<ReturnType<typeof buildApp>> | null = null;

    try {
        appResult = await buildApp({
            dbPath,
            envFilePath,
            backupDir,
            snapshotsDir,
            staticApiToken: apiToken,
            sessionSecret: `h1-timing-session-${randomUUID()}-${randomUUID()}`,
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
            ai_base_url: args.loaded.config.baseUrl,
            ai_api_key: args.loaded.config.apiKey,
            ai_model: args.loaded.config.model,
            ai_batch_size: args.loaded.config.batchSize,
        })) {
            upsertSetting(db, key, value);
        }

        const template = createTemplate(db, `${args.dataset.template.name} (${args.provider})`, args.dataset.template.tree);
        applyTemplate(db, template.id);
        const bookmarkIds = insertBookmarks(db, args.dataset.bookmarks);
        const sampleByBookmarkId = new Map<number, SampleBookmark>();
        for (const sample of args.dataset.bookmarks) {
            sampleByBookmarkId.set(bookmarkIds.get(sample.id)!, sample);
        }

        const headers = createBearerHeaders(apiToken);

        for (let attempt = 1; attempt <= args.testAttempts; attempt += 1) {
            const result = await injectTimed(app, {
                method: 'POST',
                url: '/api/ai/test',
                headers,
                payload: {
                    base_url: args.loaded.config.baseUrl,
                    api_key: args.loaded.config.apiKey,
                    model: args.loaded.config.model,
                },
            });
            providerReport.routeTest.push({
                attempt,
                durationMs: result.durationMs,
                statusCode: result.response.statusCode,
                ok: result.response.statusCode === 200,
                body: result.body,
            });

            if (result.response.statusCode !== 200) {
                providerReport.failures.push(`${args.provider} /api/ai/test attempt ${attempt} failed with status ${result.response.statusCode}`);
            }
        }

        for (const sample of args.dataset.bookmarks) {
            const summary: ClassifySampleSummary = {
                id: sample.id,
                title: sample.title,
                url: sample.url,
                acceptedCategories: sample.acceptedCategories,
                attempts: [],
                distinctCategories: [],
                allAccepted: true,
            };

            for (let attempt = 1; attempt <= args.classifyAttempts; attempt += 1) {
                const result = await injectTimed(app, {
                    method: 'POST',
                    url: '/api/ai/classify',
                    headers,
                    payload: {
                        title: sample.title,
                        url: sample.url,
                    },
                });
                const body = result.body as Record<string, unknown>;
                const actualCategory = result.response.statusCode === 200 && typeof body.category === 'string'
                    ? normalizeCategoryPath(body.category)
                    : null;
                const accepted = isAcceptedCategory(actualCategory, sample.acceptedCategories);

                summary.attempts.push({
                    attempt,
                    durationMs: result.durationMs,
                    statusCode: result.response.statusCode,
                    actualCategory,
                    accepted,
                    body: result.body,
                });

                if (actualCategory && !summary.distinctCategories.includes(actualCategory)) {
                    summary.distinctCategories.push(actualCategory);
                }
                if (result.response.statusCode !== 200) {
                    summary.allAccepted = false;
                    providerReport.failures.push(`${args.provider} classify ${sample.id} attempt ${attempt} failed with status ${result.response.statusCode}`);
                } else if (!accepted) {
                    summary.allAccepted = false;
                    providerReport.failures.push(`${args.provider} classify ${sample.id} attempt ${attempt} returned unaccepted category ${actualCategory ?? '[missing]'}`);
                }
            }

            providerReport.classify.push(summary);
        }

        {
            const batch = await injectTimed(app, {
                method: 'POST',
                url: '/api/ai/classify-batch',
                headers,
                payload: {
                    bookmark_ids: args.dataset.bookmarks.map((sample) => bookmarkIds.get(sample.id)),
                    template_id: template.id,
                },
            });
            const batchBody = batch.body as Record<string, unknown>;
            const planId = typeof batchBody.planId === 'string' ? batchBody.planId : null;
            const jobId = typeof batchBody.jobId === 'string' ? batchBody.jobId : null;
            const timeline = planId
                ? await collectPlanJobTimeline({
                    db,
                    planId,
                    jobId,
                    pollIntervalMs: args.pollIntervalMs,
                    timeoutMs: getTimelineTimeoutMs(args.timeoutCapMs, args.dataset.bookmarks.length),
                })
                : { timeline: [], timeToPreviewMs: null, timeToJobDoneMs: null };
            const plan = planId ? getPlan(db, planId) : null;
            const assignments = parseAssignments(plan?.assignments);
            const quality = evaluateAcceptedCount(assignments, sampleByBookmarkId);

            providerReport.classifyBatch = {
                request: {
                    durationMs: batch.durationMs,
                    statusCode: batch.response.statusCode,
                    ok: batch.response.statusCode === 200,
                    body: batch.body,
                },
                planId,
                jobId,
                timeline: timeline.timeline,
                timeToPreviewMs: timeline.timeToPreviewMs,
                timeToJobDoneMs: timeline.timeToJobDoneMs,
                finalPlanStatus: plan?.status ?? null,
                finalJobStatus: jobId ? getJob(db, jobId)?.status ?? null : null,
                needsReviewCount: plan?.needs_review_count ?? null,
                assignedCount: assignedCountFromPlan(plan),
                acceptedCount: quality.acceptedCount,
                totalCount: quality.totalCount,
            };

            if (batch.response.statusCode !== 200) {
                providerReport.failures.push(`${args.provider} classify-batch failed with status ${batch.response.statusCode}`);
            } else {
                if (!planId) providerReport.failures.push(`${args.provider} classify-batch response missing planId`);
                if (!jobId) providerReport.failures.push(`${args.provider} classify-batch response missing jobId`);
                if (plan?.status !== 'preview') providerReport.failures.push(`${args.provider} classify-batch plan did not reach preview (actual: ${plan?.status ?? 'missing'})`);
                if ((jobId ? getJob(db, jobId)?.status : null) !== 'done') providerReport.failures.push(`${args.provider} classify-batch job did not finish done`);
                if (quality.acceptedCount !== quality.totalCount) providerReport.failures.push(`${args.provider} classify-batch accepted ${quality.acceptedCount}/${quality.totalCount}`);
            }
        }

        {
            const organize = await injectTimed(app, {
                method: 'POST',
                url: '/api/ai/organize',
                headers,
                payload: { scope: 'all' },
            });
            const organizeBody = organize.body as Record<string, unknown>;
            const planId = typeof organizeBody.planId === 'string' ? organizeBody.planId : null;
            const jobId = typeof organizeBody.jobId === 'string' ? organizeBody.jobId : null;
            const timing = planId
                ? await collectOrganizeTimeline({
                    app,
                    db,
                    headers,
                    planId,
                    jobId,
                    pollIntervalMs: args.pollIntervalMs,
                    timeoutMs: getTimelineTimeoutMs(args.timeoutCapMs, args.dataset.bookmarks.length),
                })
                : {
                    timeline: [],
                    timeToActiveMs: null,
                    timeToPendingMs: null,
                    timeToPreviewMs: null,
                    timeToJobDoneMs: null,
                };
            const plan = planId ? getPlan(db, planId) : null;
            const assignments = parseAssignments(plan?.assignments);
            const quality = evaluateAcceptedCount(assignments, sampleByBookmarkId);
            const timingNotes: string[] = [];

            if (timing.timeToActiveMs !== null) {
                timingNotes.push(`observed assigning plan in /api/ai/organize/active after ${timing.timeToActiveMs}ms`);
            } else if (timing.timeToPendingMs !== null || timing.timeToPreviewMs !== null) {
                timingNotes.push('did not observe assigning state in /api/ai/organize/active; treat as acceptable fast transition because preview/pending became observable');
            } else {
                timingNotes.push('did not observe assigning state or stable preview state during the polling window');
            }

            if (timing.timeToPendingMs !== null) {
                timingNotes.push(`observed preview plan in /api/ai/organize/pending after ${timing.timeToPendingMs}ms`);
            } else {
                timingNotes.push('did not observe preview plan in /api/ai/organize/pending during the polling window');
            }

            if (timing.timeToPreviewMs !== null) {
                timingNotes.push(`plan status reached preview after ${timing.timeToPreviewMs}ms`);
            }

            if (timing.timeToJobDoneMs !== null) {
                timingNotes.push(`job status reached done after ${timing.timeToJobDoneMs}ms`);
            }

            providerReport.organize = {
                request: {
                    durationMs: organize.durationMs,
                    statusCode: organize.response.statusCode,
                    ok: organize.response.statusCode === 200,
                    body: organize.body,
                },
                planId,
                jobId,
                timeline: timing.timeline,
                activeObserved: timing.timeToActiveMs !== null,
                pendingObserved: timing.timeToPendingMs !== null,
                timeToActiveMs: timing.timeToActiveMs,
                timeToPendingMs: timing.timeToPendingMs,
                timeToPreviewMs: timing.timeToPreviewMs,
                timeToJobDoneMs: timing.timeToJobDoneMs,
                timingNotes,
                finalPlanStatus: plan?.status ?? null,
                finalJobStatus: jobId ? getJob(db, jobId)?.status ?? null : null,
                needsReviewCount: plan?.needs_review_count ?? null,
                assignedCount: assignedCountFromPlan(plan),
                acceptedCount: quality.acceptedCount,
                totalCount: quality.totalCount,
                apply: null,
                rollback: null,
            };

            if (organize.response.statusCode !== 200) {
                providerReport.failures.push(`${args.provider} organize failed with status ${organize.response.statusCode}`);
            } else {
                if (!planId) providerReport.failures.push(`${args.provider} organize response missing planId`);
                if (!jobId) providerReport.failures.push(`${args.provider} organize response missing jobId`);
                if (plan?.status !== 'preview') providerReport.failures.push(`${args.provider} organize plan did not reach preview (actual: ${plan?.status ?? 'missing'})`);
                if ((jobId ? getJob(db, jobId)?.status : null) !== 'done') providerReport.failures.push(`${args.provider} organize job did not finish done`);
                if (quality.acceptedCount !== quality.totalCount) providerReport.failures.push(`${args.provider} organize accepted ${quality.acceptedCount}/${quality.totalCount}`);
                if (!providerReport.organize.pendingObserved) providerReport.failures.push(`${args.provider} organize never became visible in /api/ai/organize/pending during timeline capture`);
                if (providerReport.organize.timeToJobDoneMs !== null && providerReport.organize.timeToPreviewMs !== null && providerReport.organize.timeToPreviewMs > providerReport.organize.timeToJobDoneMs) {
                    providerReport.failures.push(`${args.provider} organize preview appeared after job terminal timestamp, indicating timing drift`);
                }
            }

            if (planId && providerReport.organize.request.ok) {
                const apply = await injectTimed(app, {
                    method: 'POST',
                    url: `/api/ai/organize/${planId}/apply`,
                    headers,
                });
                const applyBody = apply.body as Record<string, unknown>;

                providerReport.organize.apply = {
                    durationMs: apply.durationMs,
                    statusCode: apply.response.statusCode,
                    ok: apply.response.statusCode === 200,
                    body: apply.body,
                    needsConfirm: Boolean(applyBody.needs_confirm),
                };

                if (apply.response.statusCode !== 200) {
                    providerReport.failures.push(`${args.provider} organize apply failed with status ${apply.response.statusCode}`);
                } else if (Boolean(applyBody.needs_confirm)) {
                    providerReport.failures.push(`${args.provider} organize apply unexpectedly required manual confirmation`);
                } else {
                    const rollback = await injectTimed(app, {
                        method: 'POST',
                        url: `/api/ai/organize/${planId}/rollback`,
                        headers,
                    });
                    const restoredAllBookmarks = (
                        db.prepare('SELECT COUNT(1) AS cnt FROM bookmarks WHERE category_id IS NOT NULL').get() as { cnt: number }
                    ).cnt === 0;

                    providerReport.organize.rollback = {
                        durationMs: rollback.durationMs,
                        statusCode: rollback.response.statusCode,
                        ok: rollback.response.statusCode === 200,
                        body: rollback.body,
                        restoredAllBookmarks,
                    };

                    if (rollback.response.statusCode !== 200) {
                        providerReport.failures.push(`${args.provider} organize rollback failed with status ${rollback.response.statusCode}`);
                    } else if (!restoredAllBookmarks) {
                        providerReport.failures.push(`${args.provider} organize rollback did not restore all bookmarks to uncategorized`);
                    }
                }
            }
        }
    } finally {
        if (appResult) {
            await Promise.race([
                appResult.app.close().catch(() => undefined),
                sleep(2_000),
            ]);
        }

        if (!args.keepTemp) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            providerReport.tempDir = null;
            providerReport.tempDirCleaned = true;
        }
    }

    return providerReport;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dataset = loadDataset(args.datasetPath);

    const report: TimingReport = {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        sourceDbPath: args.sourceDbPath,
        datasetPath: args.datasetPath,
        reportPath: args.reportPath,
        providersRequested: args.providers,
        providersRun: [],
        skippedProviders: [],
        settings: {
            diagnoseAttempts: args.diagnoseAttempts,
            testAttempts: args.testAttempts,
            classifyAttempts: args.classifyAttempts,
            timeoutCapMs: args.timeoutCapMs,
            pollIntervalMs: args.pollIntervalMs,
        },
        failures: [],
    };

    try {
        persistReport(args.reportPath, report);

        for (const provider of args.providers) {
            console.log(`[H1 timing] provider: ${provider}`);
            try {
                const loaded = loadValidationAIConfig(args.sourceDbPath, provider);
                const providerReport = await runProviderValidation({
                    provider,
                    loaded,
                    dataset,
                    sourceDbPath: args.sourceDbPath,
                    diagnoseAttempts: args.diagnoseAttempts,
                    testAttempts: args.testAttempts,
                    classifyAttempts: args.classifyAttempts,
                    timeoutCapMs: args.timeoutCapMs,
                    pollIntervalMs: args.pollIntervalMs,
                    keepTemp: args.keepTemp,
                });
                report.providersRun.push(providerReport);
                report.failures.push(...providerReport.failures);
                persistReport(args.reportPath, report);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                report.skippedProviders.push({ provider, reason });
                persistReport(args.reportPath, report);
            }
        }
    } finally {
        report.finishedAt = new Date().toISOString();
        persistReport(args.reportPath, report);
    }

    if (report.providersRun.length === 0) {
        console.error(`No provider run completed. Report: ${args.reportPath}`);
        process.exit(1);
    }

    console.log(`H1 timing validation report written to ${args.reportPath}`);
    if (report.failures.length > 0) {
        for (const failure of report.failures) {
            console.error(`FAIL: ${failure}`);
        }
        process.exit(1);
    }

    process.exit(0);
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
