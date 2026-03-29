import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import Database from 'better-sqlite3';

import { createOpenAIClient } from '../src/ai-client';
import { buildApp } from '../src/app';
import { getPlan } from '../src/ai-organize-plan';
import type { Db } from '../src/db';
import { getJob } from '../src/jobs';
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

interface AIConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    batchSize: string;
}

interface ClassifiedSampleResult {
    id: string;
    title: string;
    url: string;
    acceptedCategories: string[];
    actualCategory: string | null;
    accepted: boolean;
}

interface BatchRouteResult {
    requestOk: boolean;
    statusCode: number;
    body: unknown;
    planStatus: string | null;
    jobStatus: string | null;
    needsReviewCount: number | null;
    assignedCount: number | null;
    evaluations: ClassifiedSampleResult[];
}

interface OrganizeRouteResult {
    requestOk: boolean;
    statusCode: number;
    body: unknown;
    planStatus: string | null;
    jobStatus: string | null;
    needsReviewCount: number | null;
    evaluations: ClassifiedSampleResult[];
    apply: {
        statusCode: number | null;
        body: unknown;
    } | null;
    rollback: {
        statusCode: number | null;
        body: unknown;
        restoredAllBookmarks: boolean | null;
    } | null;
}

interface ValidationReport {
    startedAt: string;
    finishedAt: string | null;
    sourceDbPath: string;
    datasetPath: string;
    tempDir: string | null;
    tempDirCleaned: boolean;
    provider: {
        baseUrlMasked: string;
        modelMasked: string;
        batchSize: string;
        timeoutCapMs: number;
        source: 'env' | 'settings_db';
    };
    sampleCount: number;
    selectedSteps: string[];
    steps: {
        test: {
            statusCode: number;
            ok: boolean;
            body: unknown;
        };
        classify: ClassifiedSampleResult[];
        classifyBatch: BatchRouteResult;
        organize: OrganizeRouteResult;
    };
    qualitySummary: {
        singleAccepted: number;
        singleTotal: number;
        batchAccepted: number;
        batchTotal: number;
        batchNeedsReview: number;
        organizeAccepted: number;
        organizeTotal: number;
        organizeNeedsReview: number;
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

function parseArgs(argv: string[]) {
    const defaults = {
        sourceDbPath: path.resolve(process.cwd(), 'data', 'app.db'),
        datasetPath: path.resolve(process.cwd(), 'docs', 'planning', 'functional-hardening-and-ai-validation', 'fixtures', 'ai-h1-samples.json'),
        reportPath: path.join(os.tmpdir(), `bookmarks-ai-h1-report-${Date.now()}.json`),
        keepTemp: false,
        timeoutCapMs: 25_000,
        steps: ['test', 'classify', 'classify-batch', 'organize'],
    };

    const args = { ...defaults };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--source-db') args.sourceDbPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--dataset') args.datasetPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--report') args.reportPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--keep-temp') args.keepTemp = true;
        else if (arg === '--timeout-cap-ms') args.timeoutCapMs = Number(argv[++index]) || defaults.timeoutCapMs;
        else if (arg === '--steps') args.steps = argv[++index].split(',').map((step) => step.trim()).filter(Boolean);
        else if (arg === '--help') {
            console.log('Usage: npx tsx scripts/ai-h1-validate.ts [--source-db data/app.db] [--dataset path] [--report path] [--steps test,classify,classify-batch,organize] [--timeout-cap-ms 25000] [--keep-temp]');
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJobWaitTimeoutMs(timeoutCapMs: number, sampleCount: number): number {
    return Math.max(90_000, timeoutCapMs * Math.max(sampleCount, 1) * 4);
}

async function waitForJobTerminalState(db: Db, jobId: string, label: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
        const job = getJob(db, jobId);
        if (job && ['done', 'failed', 'canceled'].includes(job.status)) {
            return job;
        }
        await sleep(500);
    }

    const lastJob = getJob(db, jobId);
    throw new Error(
        `${label} job ${jobId} did not reach terminal status within ${timeoutMs}ms (last status: ${lastJob?.status ?? 'missing'})`,
    );
}

function persistReport(reportPath: string, report: ValidationReport): void {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
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

function evaluateAssignments(
    assignments: Array<{ bookmark_id: number; category_path: string; status: string }>,
    sampleByBookmarkId: Map<number, SampleBookmark>,
): ClassifiedSampleResult[] {
    return assignments.map((assignment) => {
        const sample = sampleByBookmarkId.get(assignment.bookmark_id);
        if (!sample) {
            return {
                id: String(assignment.bookmark_id),
                title: '[unknown]',
                url: '',
                acceptedCategories: [],
                actualCategory: assignment.status === 'needs_review' ? null : normalizeCategoryPath(assignment.category_path),
                accepted: false,
            };
        }

        const actualCategory = assignment.status === 'needs_review' ? null : normalizeCategoryPath(assignment.category_path);
        return {
            id: sample.id,
            title: sample.title,
            url: sample.url,
            acceptedCategories: sample.acceptedCategories,
            actualCategory,
            accepted: isAcceptedCategory(actualCategory, sample.acceptedCategories),
        };
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dataset = loadDataset(args.datasetPath);
    const { config, source } = loadAiConfig(args.sourceDbPath);

    const startedAt = new Date().toISOString();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-ai-h1-'));
    const envFilePath = path.join(tempDir, '.env.h1');
    const dbPath = path.join(tempDir, 'data', 'app.db');
    const backupDir = path.join(tempDir, 'data', 'backups');
    const snapshotsDir = path.join(tempDir, 'data', 'snapshots');
    const apiToken = `h1-token-${randomUUID()}`;

    const report: ValidationReport = {
        startedAt,
        finishedAt: null,
        sourceDbPath: args.sourceDbPath,
        datasetPath: args.datasetPath,
        tempDir,
        tempDirCleaned: false,
        provider: {
            baseUrlMasked: maskBaseUrl(config.baseUrl),
            modelMasked: maskText(config.model, 6, 3),
            batchSize: config.batchSize,
            timeoutCapMs: args.timeoutCapMs,
            source,
        },
        sampleCount: dataset.bookmarks.length,
        selectedSteps: args.steps,
        steps: {
            test: { statusCode: 0, ok: false, body: null },
            classify: [],
            classifyBatch: {
                requestOk: false,
                statusCode: 0,
                body: null,
                planStatus: null,
                jobStatus: null,
                needsReviewCount: null,
                assignedCount: null,
                evaluations: [],
            },
            organize: {
                requestOk: false,
                statusCode: 0,
                body: null,
                planStatus: null,
                jobStatus: null,
                needsReviewCount: null,
                evaluations: [],
                apply: null,
                rollback: null,
            },
        },
        qualitySummary: {
            singleAccepted: 0,
            singleTotal: 0,
            batchAccepted: 0,
            batchTotal: 0,
            batchNeedsReview: 0,
            organizeAccepted: 0,
            organizeTotal: 0,
            organizeNeedsReview: 0,
        },
        failures: [],
    };

    let appResult: Awaited<ReturnType<typeof buildApp>> | null = null;
    const selectedSteps = new Set(args.steps);

    try {
        persistReport(args.reportPath, report);
        appResult = await buildApp({
            dbPath,
            envFilePath,
            backupDir,
            snapshotsDir,
            staticApiToken: apiToken,
            sessionSecret: `h1-session-${randomUUID()}-${randomUUID()}`,
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
        const template = createTemplate(db, dataset.template.name, dataset.template.tree);
        applyTemplate(db, template.id);

        const bookmarkIds = insertBookmarks(db, dataset.bookmarks);
        const sampleByBookmarkId = new Map<number, SampleBookmark>();
        for (const bookmark of dataset.bookmarks) {
            sampleByBookmarkId.set(bookmarkIds.get(bookmark.id)!, bookmark);
        }

        const headers = createBearerHeaders(apiToken);

        if (selectedSteps.has('test')) {
            console.log('[H1] step: /api/ai/test');
            const testResponse = await app.inject({
                method: 'POST',
                url: '/api/ai/test',
                headers,
                payload: {
                    base_url: config.baseUrl,
                    api_key: config.apiKey,
                    model: config.model,
                },
            });
            report.steps.test = {
                statusCode: testResponse.statusCode,
                ok: testResponse.statusCode === 200,
                body: safeJson(testResponse.body),
            };
            if (!report.steps.test.ok) {
                report.failures.push(`ai test route failed with status ${testResponse.statusCode}`);
            }
            persistReport(args.reportPath, report);
        }

        if (selectedSteps.has('classify')) {
            console.log(`[H1] step: /api/ai/classify (${dataset.singleClassify.length} sample)`);
            for (const sampleId of dataset.singleClassify) {
                const sample = dataset.bookmarks.find((bookmark) => bookmark.id === sampleId);
                if (!sample) continue;
                const response = await app.inject({
                    method: 'POST',
                    url: '/api/ai/classify',
                    headers,
                    payload: { title: sample.title, url: sample.url },
                });

                const body = safeJson(response.body) as Record<string, unknown>;
                const actualCategory = response.statusCode === 200 && typeof body.category === 'string'
                    ? normalizeCategoryPath(body.category)
                    : null;

                report.steps.classify.push({
                    id: sample.id,
                    title: sample.title,
                    url: sample.url,
                    acceptedCategories: sample.acceptedCategories,
                    actualCategory,
                    accepted: isAcceptedCategory(actualCategory, sample.acceptedCategories),
                });
                if (response.statusCode !== 200) {
                    report.failures.push(`classify route failed for ${sample.id} with status ${response.statusCode}`);
                }
            }
            persistReport(args.reportPath, report);
        }

        if (selectedSteps.has('classify-batch')) {
            console.log(`[H1] step: /api/ai/classify-batch (${dataset.bookmarks.length} samples)`);
            const classifyBatchResponse = await app.inject({
                method: 'POST',
                url: '/api/ai/classify-batch',
                headers,
                payload: {
                    bookmark_ids: dataset.bookmarks.map((bookmark) => bookmarkIds.get(bookmark.id)),
                    template_id: template.id,
                },
            });
            report.steps.classifyBatch.statusCode = classifyBatchResponse.statusCode;
            report.steps.classifyBatch.body = safeJson(classifyBatchResponse.body);
            report.steps.classifyBatch.requestOk = classifyBatchResponse.statusCode === 200;
            persistReport(args.reportPath, report);
            if (!report.steps.classifyBatch.requestOk) {
                report.failures.push(`classify-batch route failed with status ${classifyBatchResponse.statusCode}`);
            } else {
                const body = safeJson(classifyBatchResponse.body) as Record<string, unknown>;
                const jobId = typeof body.jobId === 'string' ? body.jobId : null;
                let job = null;
                if (jobId) {
                    try {
                        job = await waitForJobTerminalState(
                            db,
                            jobId,
                            'classify-batch',
                            getJobWaitTimeoutMs(args.timeoutCapMs, dataset.bookmarks.length),
                        );
                    } catch (error) {
                        report.failures.push(error instanceof Error ? error.message : String(error));
                    }
                } else {
                    report.failures.push('classify-batch response missing jobId');
                }

                const plan = typeof body.planId === 'string' ? getPlan(db, body.planId) : null;
                const assignments = parseAssignments(plan?.assignments);

                report.steps.classifyBatch.planStatus = plan?.status ?? null;
                report.steps.classifyBatch.jobStatus = job?.status ?? null;
                report.steps.classifyBatch.needsReviewCount = plan?.needs_review_count ?? null;
                report.steps.classifyBatch.assignedCount = assignments.filter((assignment) => assignment.status === 'assigned').length;
                report.steps.classifyBatch.evaluations = evaluateAssignments(assignments, sampleByBookmarkId);

                if (plan?.status !== 'preview') report.failures.push(`classify-batch plan did not reach preview status (actual: ${plan?.status ?? 'missing'})`);
                if (job?.status !== 'done') report.failures.push(`classify-batch job did not finish successfully (actual: ${job?.status ?? 'missing'})`);
            }
            persistReport(args.reportPath, report);
        }

        if (selectedSteps.has('organize')) {
            console.log(`[H1] step: /api/ai/organize + apply/rollback (${dataset.bookmarks.length} samples)`);
            const organizeResponse = await app.inject({
                method: 'POST',
                url: '/api/ai/organize',
                headers,
                payload: { scope: 'all' },
            });
            report.steps.organize.statusCode = organizeResponse.statusCode;
            report.steps.organize.body = safeJson(organizeResponse.body);
            report.steps.organize.requestOk = organizeResponse.statusCode === 200;
            persistReport(args.reportPath, report);
            if (!report.steps.organize.requestOk) {
                report.failures.push(`organize route failed with status ${organizeResponse.statusCode}`);
            } else {
                const body = safeJson(organizeResponse.body) as Record<string, unknown>;
                const planId = typeof body.planId === 'string' ? body.planId : null;
                const jobId = typeof body.jobId === 'string' ? body.jobId : null;
                let job = null;
                if (jobId) {
                    try {
                        job = await waitForJobTerminalState(
                            db,
                            jobId,
                            'organize',
                            getJobWaitTimeoutMs(args.timeoutCapMs, dataset.bookmarks.length),
                        );
                    } catch (error) {
                        report.failures.push(error instanceof Error ? error.message : String(error));
                    }
                } else {
                    report.failures.push('organize response missing jobId');
                }

                const plan = planId ? getPlan(db, planId) : null;
                const assignments = parseAssignments(plan?.assignments);

                report.steps.organize.planStatus = plan?.status ?? null;
                report.steps.organize.jobStatus = job?.status ?? null;
                report.steps.organize.needsReviewCount = plan?.needs_review_count ?? null;
                report.steps.organize.evaluations = evaluateAssignments(assignments, sampleByBookmarkId);

                if (plan?.status !== 'preview') report.failures.push(`organize plan did not reach preview status (actual: ${plan?.status ?? 'missing'})`);
                if (job?.status !== 'done') report.failures.push(`organize job did not finish successfully (actual: ${job?.status ?? 'missing'})`);

                if (planId) {
                    const applyResponse = await app.inject({
                        method: 'POST',
                        url: `/api/ai/organize/${planId}/apply`,
                        headers,
                    });
                    report.steps.organize.apply = {
                        statusCode: applyResponse.statusCode,
                        body: safeJson(applyResponse.body),
                    };

                    const applyBody = safeJson(applyResponse.body) as Record<string, unknown>;
                    const needsConfirm = applyResponse.statusCode === 200 && Boolean(applyBody.needs_confirm);
                    if (applyResponse.statusCode !== 200) {
                        report.failures.push(`organize apply failed with status ${applyResponse.statusCode}`);
                    } else if (needsConfirm) {
                        report.failures.push('organize apply unexpectedly required manual confirmation');
                    } else {
                        const rollbackResponse = await app.inject({
                            method: 'POST',
                            url: `/api/ai/organize/${planId}/rollback`,
                            headers,
                        });
                        const restoredAllBookmarks = ((db.prepare(
                            'SELECT COUNT(1) AS cnt FROM bookmarks WHERE category_id IS NOT NULL',
                        ).get() as { cnt: number }).cnt) === 0;

                        report.steps.organize.rollback = {
                            statusCode: rollbackResponse.statusCode,
                            body: safeJson(rollbackResponse.body),
                            restoredAllBookmarks,
                        };

                        if (rollbackResponse.statusCode !== 200) {
                            report.failures.push(`organize rollback failed with status ${rollbackResponse.statusCode}`);
                        } else if (!restoredAllBookmarks) {
                            report.failures.push('organize rollback did not restore all bookmarks to uncategorized state');
                        }
                    }
                }
            }
            persistReport(args.reportPath, report);
        }

        report.qualitySummary.singleAccepted = report.steps.classify.filter((result) => result.accepted).length;
        report.qualitySummary.singleTotal = report.steps.classify.length;
        report.qualitySummary.batchAccepted = report.steps.classifyBatch.evaluations.filter((result) => result.accepted).length;
        report.qualitySummary.batchTotal = report.steps.classifyBatch.evaluations.length;
        report.qualitySummary.batchNeedsReview = report.steps.classifyBatch.needsReviewCount ?? 0;
        report.qualitySummary.organizeAccepted = report.steps.organize.evaluations.filter((result) => result.accepted).length;
        report.qualitySummary.organizeTotal = report.steps.organize.evaluations.length;
        report.qualitySummary.organizeNeedsReview = report.steps.organize.needsReviewCount ?? 0;
        persistReport(args.reportPath, report);
    } finally {
        report.finishedAt = new Date().toISOString();
        persistReport(args.reportPath, report);

        if (appResult) {
            await Promise.race([
                appResult.app.close().catch(() => undefined),
                sleep(2_000),
            ]);
        }

        if (!args.keepTemp) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            report.tempDir = null;
            report.tempDirCleaned = true;
            persistReport(args.reportPath, report);
        }
    }

    console.log(`H1 AI validation report written to ${args.reportPath}`);
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
