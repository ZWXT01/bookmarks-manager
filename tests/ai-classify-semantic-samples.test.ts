import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

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
}

interface SemanticSampleDataset {
    templates: SemanticTemplate[];
    cases: SemanticSampleCase[];
}

function loadDataset(): SemanticSampleDataset {
    const datasetPath = path.resolve(
        process.cwd(),
        'docs',
        'planning',
        'functional-hardening-and-ai-validation',
        'fixtures',
        'ai-classify-semantic-samples.json',
    );
    return JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as SemanticSampleDataset;
}

function normalizePath(value: string | null | undefined): string {
    return (value ?? '')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join('/');
}

function treeToPaths(tree: CategoryNode[]): string[] {
    return tree.flatMap((node) => {
        const top = node.name.trim();
        return [top, ...(node.children ?? []).map((child) => `${top}/${child.name.trim()}`)];
    });
}

describe('single classify semantic sample corpus', () => {
    it('matches every curated semantic sample', () => {
        const dataset = loadDataset();
        const templateMap = new Map(dataset.templates.map((template) => [template.id, template]));

        const failures = dataset.cases.flatMap((sample) => {
            const template = templateMap.get(sample.templateId);
            if (!template) {
                return [`${sample.id}: missing template ${sample.templateId}`];
            }

            const actualCategory = selectSingleClassifyCategory({
                rawCategory: sample.providerCategory,
                allowedPaths: treeToPaths(template.tree),
                title: sample.title,
                url: sample.url,
                description: sample.description ?? '',
            });

            return normalizePath(actualCategory) === normalizePath(sample.expectedCategory)
                ? []
                : [`${sample.id}: expected ${sample.expectedCategory}, got ${actualCategory ?? '[null]'}`];
        });

        expect(failures).toEqual([]);
    });
});
