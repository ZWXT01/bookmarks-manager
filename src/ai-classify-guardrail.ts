import type { Db } from './db';
import { getCategoryTree } from './category-service';
import { getActiveTemplate, type CategoryNode } from './template-service';

const casefold = (value: string) => value.toLowerCase().trim();
const compact = (value: string) => casefold(value).replace(/[\s._-]+/g, '');

interface CategoryOption {
  path: string;
  top: string;
  child: string | null;
}

interface TopLevelBucket {
  topPath: string | null;
  children: CategoryOption[];
}

export function normalizeClassifyPath(path: string): string {
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean).slice(0, 2);
  return parts.join('/');
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of paths) {
    const normalized = normalizeClassifyPath(raw);
    const key = casefold(normalized);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function treeToPaths(tree: CategoryNode[]): string[] {
  const paths: string[] = [];
  for (const node of tree) {
    if (!node?.name) continue;
    paths.push(node.name);
    for (const child of node.children ?? []) {
      if (!child?.name) continue;
      paths.push(`${node.name}/${child.name}`);
    }
  }
  return uniquePaths(paths);
}

function activeTemplatePaths(db: Db): string[] {
  const active = getActiveTemplate(db);
  if (!active) return [];

  try {
    const tree = JSON.parse(active.tree) as CategoryNode[];
    return treeToPaths(tree);
  } catch {
    return [];
  }
}

function liveCategoryPaths(db: Db): string[] {
  const paths: string[] = [];
  for (const node of getCategoryTree(db)) {
    if (node.fullPath) paths.push(node.fullPath);
    for (const child of node.children) {
      if (child.fullPath) paths.push(child.fullPath);
    }
  }
  return uniquePaths(paths);
}

export function getSingleClassifyAllowedPaths(db: Db): string[] {
  const activePaths = activeTemplatePaths(db);
  if (activePaths.length > 0) return activePaths;
  return liveCategoryPaths(db);
}

function buildOptions(paths: string[]): CategoryOption[] {
  return paths.map((path) => {
    const [top, child = null] = normalizeClassifyPath(path).split('/');
    return { path, top, child };
  });
}

export function resolveSingleClassifyCategory(rawCategory: string, allowedPaths: string[]): string | null {
  const normalized = normalizeClassifyPath(rawCategory);
  if (!normalized) return null;
  if (allowedPaths.length === 0) return normalized;

  const options = buildOptions(allowedPaths);
  const exactMap = new Map<string, string>();
  const topBuckets = new Map<string, TopLevelBucket>();
  const globalChildBuckets = new Map<string, CategoryOption[]>();

  for (const option of options) {
    exactMap.set(casefold(option.path), option.path);

    const topKey = casefold(option.top);
    const bucket = topBuckets.get(topKey) ?? { topPath: null, children: [] };
    if (option.child) {
      bucket.children.push(option);
      const childKey = casefold(option.child);
      const childEntries = globalChildBuckets.get(childKey) ?? [];
      childEntries.push(option);
      globalChildBuckets.set(childKey, childEntries);
    } else {
      bucket.topPath = option.path;
    }
    topBuckets.set(topKey, bucket);
  }

  const exact = exactMap.get(casefold(normalized));
  if (exact) return exact;

  const [topPart, childPart = ''] = normalized.split('/');
  const topBucket = topBuckets.get(casefold(topPart));

  if (topBucket) {
    if (childPart) {
      const exactChild = topBucket.children.find((option) => casefold(option.child ?? '') === casefold(childPart));
      if (exactChild) return exactChild.path;

      const compactChild = compact(childPart);
      const partialChildMatches = topBucket.children.filter((option) => {
        const childCompact = compact(option.child ?? '');
        return compactChild && (childCompact.includes(compactChild) || compactChild.includes(childCompact));
      });
      if (partialChildMatches.length === 1) return partialChildMatches[0].path;
    }

    if (topBucket.children.length === 1) return topBucket.children[0].path;
    if (topBucket.topPath) return topBucket.topPath;
  }

  if (!childPart) {
    const globalChildMatches = globalChildBuckets.get(casefold(topPart)) ?? [];
    if (globalChildMatches.length === 1) return globalChildMatches[0].path;
  }

  return null;
}
