import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { selectSingleClassifyCategory } from '../src/ai-classify-guardrail';

interface CategoryNode { name: string; children?: { name: string }[] }

interface SemanticTaxonomy {
    id: string;
    name: string;
    tree: CategoryNode[];
}

interface SemanticSampleCase {
    id: string;
    taxonomyId: string;
    title: string;
    url: string;
    description?: string;
    providerCategory: string;
    expectedCategory: string;
}

interface SemanticSampleDataset {
    taxonomies: SemanticTaxonomy[];
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
        const taxonomyMap = new Map(dataset.taxonomies.map((taxonomy) => [taxonomy.id, taxonomy]));

        const failures = dataset.cases.flatMap((sample) => {
            const taxonomy = taxonomyMap.get(sample.taxonomyId);
            if (!taxonomy) {
                return [`${sample.id}: missing taxonomy ${sample.taxonomyId}`];
            }

            const actualCategory = selectSingleClassifyCategory({
                rawCategory: sample.providerCategory,
                allowedPaths: treeToPaths(taxonomy.tree),
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
