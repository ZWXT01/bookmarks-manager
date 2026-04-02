import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ScriptSpec {
    issueIds: string[];
    script: string;
    description: string;
}

interface ScriptResult {
    issueIds: string[];
    script: string;
    description: string;
    durationMs: number;
    parsedOutput: unknown;
    stdoutTail: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxBinPath = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

const SUITE: ScriptSpec[] = [
    {
        issueIds: ['R1-QA-01', 'R2-E2E-01', 'R2-REL-03'],
        script: 'scripts/playwright-release-journeys-validate.ts',
        description: 'release journeys and core page navigation',
    },
    {
        issueIds: ['R8-QA-01'],
        script: 'scripts/backup-job-browser-validate.ts',
        description: 'backup create/restore and job detail live progress',
    },
    {
        issueIds: ['R8-QA-02'],
        script: 'scripts/jobs-snapshots-browser-validate.ts',
        description: 'jobs destructive actions and snapshots batch delete',
    },
    {
        issueIds: ['R8-QA-03'],
        script: 'scripts/import-export-browser-validate.ts',
        description: 'import progress and export download replay',
    },
    {
        issueIds: ['R3-UI-01'],
        script: 'scripts/category-nav-validate.ts',
        description: 'category nav layout and scroll recovery',
    },
    {
        issueIds: ['R3-QA-03', 'R4-QA-02'],
        script: 'scripts/category-interaction-validate.ts',
        description: 'cross-view category interaction consistency',
    },
    {
        issueIds: ['R5-AI-08'],
        script: 'scripts/settings-ai-diagnostic-validate.ts',
        description: 'settings AI diagnostic UI states',
    },
    {
        issueIds: ['R6-UI-02'],
        script: 'scripts/template-editor-validate.ts',
        description: 'template editor long-tree modal reachability',
    },
    {
        issueIds: ['R6-TPL-06'],
        script: 'scripts/preset-template-validate.ts',
        description: 'preset template copy/apply and active-template refresh',
    },
    {
        issueIds: ['R6-AI-01', 'R7-AI-01', 'R7-AI-05', 'R7-AI-06'],
        script: 'scripts/ai-organize-ui-validate.ts',
        description: 'ai organize assigning, failed/error recovery, and preview apply UI',
    },
    {
        issueIds: ['R2-EXT-02'],
        script: 'scripts/extension-roundtrip-validate.ts',
        description: 'extension popup-harness round-trip',
    },
    {
        issueIds: ['R5-EXT-02', 'R6-EXT-04', 'R6-EXT-05'],
        script: 'scripts/extension-runtime-validate.ts',
        description: 'extension runtime business flow and popup shell',
    },
    {
        issueIds: ['R5-EXT-03'],
        script: 'scripts/extension-action-popup-validate.ts',
        description: 'extension action popup binding',
    },
];

function parseJsonOutput(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    try {
        return JSON.parse(trimmed);
    } catch {
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            const candidate = trimmed.slice(firstBrace, lastBrace + 1);
            try {
                return JSON.parse(candidate);
            } catch {
                return null;
            }
        }
        return null;
    }
}

function tailText(value: string, maxChars = 1200): string {
    const trimmed = value.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return trimmed.slice(trimmed.length - maxChars);
}

async function runScript(spec: ScriptSpec): Promise<ScriptResult> {
    const startedAt = Date.now();
    const scriptPath = path.join(repoRoot, spec.script);

    return new Promise((resolve, reject) => {
        const child = spawn(tsxBinPath, [scriptPath], {
            cwd: repoRoot,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(text);
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(text);
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`${spec.script} exited with code ${code}\n${tailText(stderr || stdout)}`));
                return;
            }

            resolve({
                issueIds: spec.issueIds,
                script: spec.script,
                description: spec.description,
                durationMs: Date.now() - startedAt,
                parsedOutput: parseJsonOutput(stdout),
                stdoutTail: tailText(stdout),
            });
        });
    });
}

async function main() {
    const results: ScriptResult[] = [];
    const startedAt = Date.now();

    for (const spec of SUITE) {
        results.push(await runScript(spec));
    }

    console.log(JSON.stringify({
        suite: 'playwright-issue-regression',
        scriptCount: results.length,
        totalDurationMs: Date.now() - startedAt,
        results: results.map((result) => ({
            issueIds: result.issueIds,
            script: result.script,
            description: result.description,
            durationMs: result.durationMs,
            parsedOutput: result.parsedOutput,
        })),
    }, null, 2));
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
