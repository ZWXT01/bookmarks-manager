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

export interface SingleClassifySelectionInput {
  rawCategory: string;
  allowedPaths: string[];
  title?: string;
  url?: string;
  description?: string | null;
}

export interface DeterministicSingleClassifyInput {
  allowedPaths: string[];
  title?: string;
  url?: string;
  description?: string | null;
}

interface ParsedUrlContext {
  hostname: string;
  pathname: string;
  search: string;
}

interface SingleClassifySemanticContext {
  inputHaystack: string;
  modelHaystack: string;
  url: ParsedUrlContext;
}

interface ScoredCategoryOption {
  option: CategoryOption;
  score: number;
}

const LABEL_ALIASES: Record<string, string[]> = {
  学习资源: ['docs', 'documentation', 'tutorial', 'guide', 'course', 'book', 'example', 'learn', 'reference'],
  文档: ['文档', 'docs', 'documentation', 'reference', 'manual', 'handbook', 'readme'],
  官方文档: ['官方文档', 'official docs', 'docs', 'documentation', 'reference', 'manual', 'handbook', 'readme'],
  系列教程: ['教程', 'tutorial', 'guide', 'quickstart', 'getting started', 'learn'],
  在线课程: ['课程', 'course', 'academy', 'training', 'lesson', 'bootcamp'],
  课程: ['课程', 'course', 'academy', 'training', 'lesson', 'bootcamp'],
  书籍: ['书籍', 'book', 'ebook', 'pdf'],
  阅读: ['阅读', 'read', 'book'],
  阅读笔记: ['阅读笔记', 'notes', 'book notes'],
  代码示例: ['代码示例', '示例', 'example', 'examples', 'sample', 'samples', 'demo', 'starter', 'boilerplate', 'snippet'],
  Issue跟踪: ['issue', 'issues', 'bug', 'bugs', 'tracker'],
  Release更新: ['release', 'releases', 'changelog', 'release notes'],
  技术开发: ['frontend', 'backend', 'programming', 'developer', 'code'],
  前端: ['前端', 'frontend', 'front end', 'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'css', 'html'],
  前端框架: ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'solid'],
  后端: ['后端', 'backend', 'back end', 'server', 'node', 'express', 'nestjs', 'spring', 'django', 'flask', 'fastapi', 'laravel', 'rails'],
  后端框架: ['express', 'nestjs', 'spring', 'django', 'flask', 'fastapi', 'laravel', 'rails'],
  移动开发: ['mobile', 'ios', 'android', 'flutter', 'react native', 'swift', 'kotlin'],
  数据库: ['database', 'db', 'postgres', 'mysql', 'sqlite', 'redis', 'mongodb', 'supabase'],
  '运维与部署': ['devops', 'deploy', 'deployment', 'docker', 'kubernetes', 'k8s', 'serverless'],
  '容器与K8s': ['docker', 'kubernetes', 'k8s', 'helm'],
  'CI&CD': ['ci cd', 'github actions', 'gitlab ci', 'jenkins', 'circleci', 'buildkite'],
  '监控与日志': ['monitoring', 'logging', 'grafana', 'prometheus', 'sentry', 'observability'],
  '网络与安全': ['security', 'oauth', 'auth', 'tls', 'ssl', 'network'],
  GitHub: ['github'],
  'Stack Overflow': ['stackoverflow', 'stack overflow'],
  掘金: ['juejin'],
  V2EX: ['v2ex'],
  'Hacker News': ['hacker news', 'news ycombinator'],
  知乎: ['zhihu'],
  微博: ['weibo'],
  小红书: ['xiaohongshu', 'xiaohongshu com'],
  Reddit: ['reddit'],
  Discord: ['discord'],
  浏览器插件: ['chrome extension', 'browser extension', 'firefox add on', 'plugin', 'extension', 'chrome web store', 'chromewebstore', 'addons mozilla'],
  效率工具: ['productivity', 'todo', 'calendar', 'note', 'notion'],
  'AI与数据': ['ai', 'llm', 'machine learning', 'ml', 'data'],
  '大模型LLM': ['llm', 'gpt', 'openai', 'anthropic', 'claude', 'chatgpt', 'rag'],
  机器学习: ['machine learning', 'ml', 'pytorch', 'tensorflow', 'scikit'],
  数据分析: ['analytics', 'analysis', 'bi', 'dashboard'],
  向量数据库: ['vector database', 'qdrant', 'milvus', 'weaviate', 'pinecone', 'faiss'],
  IDE编辑器: ['vscode', 'cursor', 'webstorm', 'idea', 'vim', 'neovim'],
  Git版本控制: ['git', 'github', 'gitlab', 'bitbucket'],
  构建与打包: ['vite', 'webpack', 'rollup', 'esbuild', 'parcel', 'bun'],
  API调试: ['postman', 'insomnia', 'hoppscotch', 'api client', 'rest client'],
  UI组件: ['ui component', 'component library', 'design system', 'radix', 'mui', 'antd'],
};

const DOCUMENTATION_LABELS = new Set(['文档', '官方文档']);
const TUTORIAL_LABELS = new Set(['系列教程']);
const COURSE_LABELS = new Set(['在线课程', '课程']);
const BOOK_LABELS = new Set(['书籍', '阅读', '阅读笔记']);
const EXAMPLE_LABELS = new Set(['代码示例']);

const DOCUMENTATION_SIGNALS = ['文档', 'official docs', 'documentation', 'reference', 'manual', 'handbook', 'readme'];
const DOCUMENTATION_PATH_SIGNALS = ['docs', 'documentation', 'reference', 'manual', 'handbook', 'readme'];
const TUTORIAL_SIGNALS = ['教程', 'tutorial', 'guide', 'quickstart', 'getting started', 'learn', 'how to', '入门'];
const COURSE_SIGNALS = ['课程', 'course', 'academy', 'training', 'lesson', 'bootcamp'];
const BOOK_SIGNALS = ['书籍', 'book', 'ebook', 'pdf'];
const EXAMPLE_SIGNALS = ['示例', 'example', 'examples', 'sample', 'samples', 'demo', 'starter', 'boilerplate', 'snippet'];

const HOST_LABEL_RULES: Array<{ pattern: RegExp; labels: string[] }> = [
  { pattern: /(^|\.)github\.com$/i, labels: ['GitHub', 'Star清单', '贡献指南', 'Issue跟踪', 'Release更新'] },
  { pattern: /(^|\.)stackoverflow\.com$/i, labels: ['Stack Overflow'] },
  { pattern: /(^|\.)news\.ycombinator\.com$/i, labels: ['Hacker News'] },
  { pattern: /(^|\.)reddit\.com$/i, labels: ['Reddit'] },
  { pattern: /(^|\.)zhihu\.com$/i, labels: ['知乎'] },
  { pattern: /(^|\.)weibo\.com$/i, labels: ['微博'] },
  { pattern: /(^|\.)xiaohongshu\.com$/i, labels: ['小红书'] },
  { pattern: /(^|\.)juejin\.cn$/i, labels: ['掘金'] },
  { pattern: /(^|\.)v2ex\.com$/i, labels: ['V2EX'] },
  { pattern: /(^|\.)discord\.(com|gg)$/i, labels: ['Discord'] },
  { pattern: /(^|\.)chromewebstore\.google\.com$/i, labels: ['浏览器插件'] },
  { pattern: /(^|\.)addons\.mozilla\.org$/i, labels: ['浏览器插件'] },
];

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

function normalizeSearchText(value: string): string {
  return casefold(value)
    .replace(/%[0-9a-f]{2}/gi, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrlContext(rawUrl: string | undefined): ParsedUrlContext {
  if (!rawUrl) {
    return { hostname: '', pathname: '', search: '' };
  }

  try {
    const parsed = new URL(rawUrl);
    return {
      hostname: parsed.hostname.toLowerCase(),
      pathname: safeDecode(parsed.pathname.toLowerCase()),
      search: safeDecode(parsed.search.toLowerCase()),
    };
  } catch {
    return { hostname: '', pathname: '', search: '' };
  }
}

function buildSemanticContext(input: SingleClassifySelectionInput): SingleClassifySemanticContext {
  const parsedUrl = parseUrlContext(input.url);
  const inputHaystack = normalizeSearchText([
    input.title ?? '',
    input.description ?? '',
    input.url ?? '',
    parsedUrl.hostname,
    parsedUrl.pathname,
    parsedUrl.search,
  ].join(' '));

  return {
    inputHaystack,
    modelHaystack: normalizeSearchText(input.rawCategory),
    url: parsedUrl,
  };
}

function uniqueSignals(label: string): string[] {
  const values = new Set<string>();
  const normalizedLabel = normalizeSearchText(label);
  if (normalizedLabel) values.add(normalizedLabel);

  for (const part of label.split(/[\/&]+/)) {
    const normalizedPart = normalizeSearchText(part);
    if (normalizedPart) values.add(normalizedPart);
  }

  for (const alias of LABEL_ALIASES[label] ?? []) {
    const normalizedAlias = normalizeSearchText(alias);
    if (normalizedAlias) values.add(normalizedAlias);
  }

  return [...values];
}

function haystackContainsAny(haystack: string, values: string[]): boolean {
  if (!haystack) return false;
  return values.some((value) => value && haystack.includes(value));
}

function topLevelFromPath(path: string | null): string {
  return normalizeClassifyPath(path ?? '').split('/')[0] ?? '';
}

function scoreContentTypeBonus(option: CategoryOption, context: SingleClassifySemanticContext): number {
  const child = option.child ?? '';
  const inputHaystack = context.inputHaystack;
  const pathname = normalizeSearchText(context.url.pathname);
  const hostname = context.url.hostname;

  if (DOCUMENTATION_LABELS.has(child)) {
    const hasDocumentationInputSignal = haystackContainsAny(inputHaystack, DOCUMENTATION_SIGNALS);
    const hasDocumentationPathSignal =
      haystackContainsAny(pathname, DOCUMENTATION_PATH_SIGNALS) ||
      hostname.startsWith('docs.') ||
      hostname.startsWith('developer.');

    if (hasDocumentationInputSignal) {
      return 10;
    }

    if (
      hasDocumentationPathSignal
    ) {
      return 6;
    }
  }

  if (TUTORIAL_LABELS.has(child) && haystackContainsAny(inputHaystack, TUTORIAL_SIGNALS)) {
    return 10;
  }

  if (COURSE_LABELS.has(child) && haystackContainsAny(inputHaystack, COURSE_SIGNALS)) {
    return 10;
  }

  if (BOOK_LABELS.has(child) && haystackContainsAny(inputHaystack, BOOK_SIGNALS)) {
    return 10;
  }

  if (EXAMPLE_LABELS.has(child) && haystackContainsAny(inputHaystack, EXAMPLE_SIGNALS)) {
    return 10;
  }

  return 0;
}

function scoreHostBonus(option: CategoryOption, context: SingleClassifySemanticContext): number {
  const hostname = context.url.hostname;
  if (!hostname) return 0;

  if (/(^|\.)github\.com$/i.test(hostname)) {
    const pathname = context.url.pathname;
    if (option.child === 'Release更新' && pathname.includes('/releases')) return 16;
    if (option.child === 'Issue跟踪' && pathname.includes('/issues')) return 16;
    if (option.child === '贡献指南' && pathname.includes('/contributing')) return 16;
  }

  if (
    ((/(^|\.)chromewebstore\.google\.com$/i.test(hostname) || /(^|\.)addons\.mozilla\.org$/i.test(hostname))) &&
    option.child === '浏览器插件'
  ) {
    return 14;
  }

  for (const rule of HOST_LABEL_RULES) {
    if (!rule.pattern.test(hostname)) continue;
    if (rule.labels.includes(option.top) || (option.child && rule.labels.includes(option.child))) {
      return 10;
    }
  }

  return 0;
}

function scoreOption(
  option: CategoryOption,
  context: SingleClassifySemanticContext,
  resolvedCategory: string | null,
): number {
  let score = 0;

  if (resolvedCategory === option.path) score += 4;
  else if (resolvedCategory && topLevelFromPath(resolvedCategory) === option.top) score += 1;

  const topSignals = uniqueSignals(option.top);
  if (haystackContainsAny(context.inputHaystack, topSignals)) score += 2;
  else if (haystackContainsAny(context.modelHaystack, topSignals)) score += 1;

  if (option.child) {
    const childSignals = uniqueSignals(option.child);
    if (haystackContainsAny(context.inputHaystack, childSignals)) score += 4;
    else if (haystackContainsAny(context.modelHaystack, childSignals)) score += 2;
  }

  score += scoreContentTypeBonus(option, context);
  score += scoreHostBonus(option, context);

  return score;
}

function pickSemanticCategory(
  input: SingleClassifySelectionInput,
  resolvedCategory: string | null,
): string | null {
  if (input.allowedPaths.length === 0) return resolvedCategory;

  const context = buildSemanticContext(input);
  const options = buildOptions(input.allowedPaths);
  const scoredOptions = options
    .map((option): ScoredCategoryOption => ({
      option,
      score: scoreOption(option, context, resolvedCategory),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.option.path.localeCompare(b.option.path, 'zh-CN');
    });

  const best = scoredOptions[0];
  if (!best) return resolvedCategory;

  const second = scoredOptions[1];
  const resolvedScore = resolvedCategory
    ? scoredOptions.find((entry) => entry.option.path === resolvedCategory)?.score ?? Number.NEGATIVE_INFINITY
    : Number.NEGATIVE_INFINITY;

  if (!resolvedCategory) {
    const beatsSecond = !second || best.score >= second.score + 3;
    return best.score >= 8 && beatsSecond ? best.option.path : null;
  }

  if (best.option.path === resolvedCategory) return resolvedCategory;

  if (
    topLevelFromPath(resolvedCategory) === best.option.top &&
    !resolvedCategory.includes('/') &&
    !!best.option.child &&
    best.score >= resolvedScore + 2
  ) {
    return best.option.path;
  }

  if (best.score >= 8 && best.score >= resolvedScore + 5) {
    return best.option.path;
  }

  return resolvedCategory;
}

function resolveSingleClassifyCategory(rawCategory: string, allowedPaths: string[]): string | null {
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

export function selectSingleClassifyCategory(input: SingleClassifySelectionInput): string | null {
  const resolvedCategory = resolveSingleClassifyCategory(input.rawCategory, input.allowedPaths);
  return pickSemanticCategory(input, resolvedCategory);
}

export function selectDeterministicSingleClassifyCategory(input: DeterministicSingleClassifyInput): string | null {
  return pickSemanticCategory(
    {
      rawCategory: '',
      allowedPaths: input.allowedPaths,
      title: input.title,
      url: input.url,
      description: input.description,
    },
    null,
  );
}
