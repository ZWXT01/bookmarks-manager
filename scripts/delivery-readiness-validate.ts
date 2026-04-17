import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface CommandSpec {
    label: string;
    command: string;
    args: string[];
}

interface CommandResult {
    label: string;
    command: string[];
    durationMs: number;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUITE: CommandSpec[] = [
    {
        label: 'typecheck',
        command: 'npx',
        args: ['tsc', '--noEmit'],
    },
    {
        label: 'unit-and-integration',
        command: 'npm',
        args: ['test'],
    },
    {
        label: 'build',
        command: 'npm',
        args: ['run', 'build'],
    },
    {
        label: 'historical-browser-regression',
        command: 'npx',
        args: ['tsx', 'scripts/playwright-issue-regression-validate.ts'],
    },
];

function tailText(value: string, maxChars = 1200): string {
    const trimmed = value.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return trimmed.slice(trimmed.length - maxChars);
}

async function runCommand(spec: CommandSpec): Promise<CommandResult> {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
        const child = spawn(spec.command, spec.args, {
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
                reject(new Error(`${spec.label} failed with code ${code}\n${tailText(stderr || stdout)}`));
                return;
            }

            resolve({
                label: spec.label,
                command: [spec.command, ...spec.args],
                durationMs: Date.now() - startedAt,
            });
        });
    });
}

async function main() {
    const startedAt = Date.now();
    const results: CommandResult[] = [];

    for (const spec of SUITE) {
        results.push(await runCommand(spec));
    }

    console.log(JSON.stringify({
        suite: 'delivery-readiness',
        totalDurationMs: Date.now() - startedAt,
        results,
    }, null, 2));
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
