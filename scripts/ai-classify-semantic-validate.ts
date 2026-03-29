import fs from 'fs';
import os from 'os';
import path from 'path';

import { selectSingleClassifyCategory } from '../src/ai-classify-guardrail';
import type { CategoryNode } from '../src/template-service';

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
    notes?: string;
}

interface SemanticSampleDataset {
    templates: SemanticTemplate[];
    cases: SemanticSampleCase[];
}

interface SemanticSampleResult {
    id: string;
    templateId: string;
    templateName: string;
    providerCategory: string;
    expectedCategory: string;
    actualCategory: string | null;
    ok: boolean;
    notes?: string;
}

interface ValidationReport {
    startedAt: string;
    finishedAt: string | null;
    datasetPath: string;
    reportPath: string;
    total: number;
    passed: number;
    failed: number;
    results: SemanticSampleResult[];
}

function parseArgs(argv: string[]) {
    const defaults = {
        datasetPath: path.resolve(process.cwd(), 'docs', 'planning', 'functional-hardening-and-ai-validation', 'fixtures', 'ai-classify-semantic-samples.json'),
        reportPath: path.join(os.tmpdir(), `bookmarks-ai-classify-semantic-report-${Date.now()}.json`),
    };

    const args = { ...defaults };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dataset') args.datasetPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--report') args.reportPath = path.resolve(process.cwd(), argv[++index]);
        else if (arg === '--help') {
            console.log('Usage: npx tsx scripts/ai-classify-semantic-validate.ts [--dataset path] [--report path]');
            process.exit(0);
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    return args;
}

function normalizePath(value: string | null | undefined): string {
    return (value ?? '')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join('/');
}

function loadDataset(datasetPath: string): SemanticSampleDataset {
    return JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as SemanticSampleDataset;
}

function treeToPaths(tree: CategoryNode[]): string[] {
    return tree.flatMap((node) => {
        const top = node.name.trim();
        const childPaths = (node.children ?? []).map((child) => `${top}/${child.name.trim()}`);
        return [top, ...childPaths];
    });
}

function main() {
    const { datasetPath, reportPath } = parseArgs(process.argv.slice(2));
    const dataset = loadDataset(datasetPath);
    const templateMap = new Map(dataset.templates.map((template) => [template.id, template]));

    const report: ValidationReport = {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        datasetPath,
        reportPath,
        total: dataset.cases.length,
        passed: 0,
        failed: 0,
        results: [],
    };

    for (const sample of dataset.cases) {
        const template = templateMap.get(sample.templateId);
        if (!template) {
            throw new Error(`sample ${sample.id} references unknown template ${sample.templateId}`);
        }

        const allowedPaths = treeToPaths(template.tree);
        const actualCategory = selectSingleClassifyCategory({
            rawCategory: sample.providerCategory,
            allowedPaths,
            title: sample.title,
            url: sample.url,
            description: sample.description ?? '',
        });
        const ok = normalizePath(actualCategory) === normalizePath(sample.expectedCategory);
        if (ok) report.passed += 1;
        else report.failed += 1;

        report.results.push({
            id: sample.id,
            templateId: sample.templateId,
            templateName: template.name,
            providerCategory: sample.providerCategory,
            expectedCategory: sample.expectedCategory,
            actualCategory,
            ok,
            notes: sample.notes,
        });
    }

    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`Validated ${report.total} single-classify semantic samples.`);
    console.log(`Passed: ${report.passed}`);
    console.log(`Failed: ${report.failed}`);
    console.log(`Report: ${reportPath}`);

    if (report.failed > 0) {
        for (const result of report.results.filter((entry) => !entry.ok)) {
            console.log(`- ${result.id}: expected ${result.expectedCategory}, got ${result.actualCategory ?? '[null]'}`);
        }
        process.exitCode = 1;
    }
}

main();
