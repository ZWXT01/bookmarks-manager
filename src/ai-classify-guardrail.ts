import type { Db } from './db';
import { getCategoryTree } from './category-service';

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
  常用入口: ['portal', 'dashboard', 'home', 'homepage', 'start page', '入口', '导航', 'console'],
  每日必看: ['daily', 'today', '每日', '今日', '早报', 'digest'],
  工作常用: ['work', 'workspace', 'office', 'admin', 'dashboard'],
  个人常用: ['personal', 'favorite', 'profile', 'account'],
  快捷导航: ['navigation', 'directory', 'bookmark', 'links', 'startpage', '网址导航'],
  临时置顶: ['temporary', 'pinned', 'urgent', '临时', '置顶'],
  待处理: ['todo', 'later', 'read later', 'inbox', 'pending', '待办', '稍后'],
  稍后阅读: ['read later', 'reading list', 'later', '稍后阅读'],
  待整理: ['inbox', 'unsorted', 'triage', '待整理'],
  待下载: ['download later', '待下载'],
  待购买: ['buy later', 'wishlist', 'cart', '待购买'],
  待注册: ['signup', 'register', 'sign up', '待注册'],
  可能删除: ['delete', 'remove', 'deprecated', '可能删除'],
  搜索导航: ['search', 'engine', 'directory', 'lookup', '搜索', '导航'],
  搜索引擎: ['google', 'bing', 'duckduckgo', 'baidu', 'yandex', 'search engine'],
  垂直搜索: ['search', 'finder', 'lookup', '垂直搜索'],
  网址导航: ['directory', '导航', 'awesome', 'links', 'curated'],
  翻译词典: ['translate', 'translation', 'dictionary', 'deepl', '词典', '翻译'],
  地图位置: ['map', 'maps', 'location', 'geo', '地图', '路线'],
  问答入口: ['qa', 'q&a', 'question', 'answer', '问答'],
  账号后台: ['account', 'admin', 'console', 'dashboard', 'billing', 'control panel', '后台'],
  云服务控制台: ['cloud console', 'aws', 'azure', 'gcp', 'cloudflare', 'aliyun', 'tencent cloud', '控制台'],
  域名DNS: ['domain', 'dns', 'nameserver', 'registrar'],
  服务器面板: ['server', 'vps', 'panel', 'ssh', '宝塔', '1panel'],
  应用后台: ['admin', 'app dashboard', '后台管理'],
  商家后台: ['seller', 'merchant', 'shop admin', '商家'],
  订阅会员: ['subscription', 'membership', 'plan', '会员'],
  账单发票: ['billing', 'invoice', 'receipt', '账单', '发票'],
  个人资料页: ['profile', 'account settings', 'settings'],
  在线工具: ['online tool', 'web tool', 'generator', 'converter', 'calculator', 'editor'],
  文本工具: ['text', 'json', 'regex', 'markdown', 'diff', 'formatter', '文本'],
  图片工具: ['image tool', 'compress image', 'resize image', 'remove background', '图片'],
  PDF文档工具: ['pdf', 'merge pdf', 'split pdf', 'pdf converter'],
  格式转换: ['converter', 'convert', 'format', '转换'],
  计算查询: ['calculator', 'lookup', 'query', '计算'],
  文件处理: ['file tool', 'file converter', 'hash', 'compress file', '文件'],
  临时服务: ['temporary', 'temp mail', 'pastebin', 'upload', '临时邮箱'],
  效率小工具: ['productivity', 'timer', 'todo', 'note', 'calendar', 'utility'],
  开发者: ['developer', 'programming', 'code', 'software engineering', 'devtool'],
  代码托管: ['github', 'gitlab', 'bitbucket', 'repo', 'repository', 'source code'],
  API文档: ['api', 'sdk', 'endpoint', 'swagger', 'openapi', 'api docs'],
  包与镜像: ['npm', 'pypi', 'maven', 'nuget', 'crates', 'docker hub', 'registry', 'package'],
  前端资源: ['frontend', 'front end', 'react', 'vue', 'nextjs', 'nuxt', 'css', 'html', 'typescript', 'javascript'],
  后端资源: ['backend', 'server', 'nodejs', 'java', 'go', 'python', 'rust', 'api server'],
  数据库缓存: ['database', 'postgres', 'mysql', 'sqlite', 'redis', 'mongodb', 'cache'],
  部署运维: ['devops', 'deploy', 'docker', 'kubernetes', 'nginx', 'linux', 'server', 'ci cd'],
  监控日志: ['monitoring', 'logging', 'observability', 'grafana', 'prometheus', 'sentry'],
  报错排查: ['error', 'bug', 'troubleshooting', 'debug', 'stack trace', '报错'],
  代码片段: ['snippet', 'gist', 'code sample', 'example code'],
  技术文章: ['tech blog', 'article', 'engineering blog', '技术文章'],
  AI工具: ['ai tool', 'llm', 'gpt', 'chatgpt', 'claude', 'openai', 'anthropic', '人工智能'],
  聊天助手: ['chatbot', 'chat assistant', 'chatgpt', 'claude', 'gemini'],
  AI搜索: ['ai search', 'perplexity', 'search ai'],
  AI编程: ['ai coding', 'copilot', 'cursor', 'code assistant'],
  AI写作: ['ai writing', 'writer', 'copywriting'],
  AI图片: ['ai image', 'image generation', 'midjourney', 'stable diffusion'],
  AI视频: ['ai video', 'video generation'],
  AI音频: ['ai audio', 'tts', 'speech', 'voice'],
  提示词库: ['prompt', 'prompts', 'prompt library'],
  模型平台: ['model platform', 'llm platform', 'huggingface', 'replicate', 'modelscope'],
  数据集评测: ['dataset', 'benchmark', 'evaluation', 'leaderboard'],
  设计素材: ['design', 'asset', 'figma', 'inspiration', 'ui', 'icon', 'font'],
  设计工具: ['figma', 'sketch', 'design tool'],
  灵感参考: ['inspiration', 'gallery', 'showcase', 'dribbble', 'behance'],
  图标字体: ['icon', 'font', 'svg', '字体'],
  图片图库: ['stock photo', 'photo', 'image library', 'unsplash', 'pexels'],
  插画素材: ['illustration', 'vector', '插画'],
  配色排版: ['color palette', 'typography', 'font pairing', '配色'],
  模板样机: ['template', 'mockup', '样机'],
  资料文档: ['documentation', 'reference', 'tutorial', 'wiki', 'manual', 'paper'],
  教程指南: ['tutorial', 'guide', 'how to', 'getting started', '入门'],
  官方手册: ['manual', 'handbook', 'official manual'],
  参考资料: ['reference', 'cheatsheet', 'resource'],
  课程页面: ['course', 'academy', 'lesson', 'training'],
  论文报告: ['paper', 'arxiv', 'report', 'whitepaper'],
  Wiki知识库: ['wiki', 'knowledge base', 'kb'],
  收藏文章: ['article', 'blog post', 'read'],
  资讯订阅: ['news', 'newsletter', 'rss', 'feed', 'hot list'],
  科技资讯: ['tech news', 'technology news'],
  综合新闻: ['news', 'headline'],
  财经资讯: ['finance news', 'business news'],
  行业动态: ['industry news', 'trend'],
  Newsletter: ['newsletter', 'digest'],
  RSS源: ['rss', 'feed', 'atom'],
  榜单热榜: ['trending', 'hot list', 'ranking', 'top'],
  社区论坛: ['community', 'forum', 'social', 'q&a', 'blog'],
  社交平台: ['social', 'twitter', 'x.com', 'facebook', 'instagram', 'mastodon'],
  论坛社区: ['forum', 'bbs', 'community', 'reddit', 'v2ex'],
  问答社区: ['stackoverflow', 'quora', 'zhihu', 'question answer'],
  博客个人站: ['blog', 'personal site', 'medium', 'substack'],
  群组频道: ['discord', 'telegram', 'slack', 'group', 'channel'],
  活动Meetup: ['meetup', 'event', 'conference', '活动'],
  影音娱乐: ['video', 'movie', 'music', 'podcast', 'game', 'anime', 'entertainment'],
  视频平台: ['youtube', 'bilibili', 'video', '视频'],
  音乐电台: ['music', 'radio', 'spotify', 'podcast'],
  播客节目: ['podcast'],
  直播平台: ['live', 'stream', 'twitch'],
  游戏站点: ['game', 'gaming', 'steam', 'itch'],
  动漫漫画: ['anime', 'manga', 'comic', '漫画'],
  影视资源: ['movie', 'tv', 'film', '影视'],
  下载资源: ['download', 'release', 'mirror', '网盘', 'torrent'],
  软件下载: ['download software', 'app download', 'installer'],
  系统镜像: ['iso', 'os image', 'system image'],
  开源发布: ['release', 'github releases', 'open source release'],
  网盘分享: ['drive', 'cloud drive', 'pan.baidu', 'share link'],
  素材下载: ['asset download', '素材'],
  字体资源: ['font download', 'fonts'],
  壁纸资源: ['wallpaper'],
  备用链接: ['mirror', 'backup link'],
  购物消费: ['shop', 'shopping', 'ecommerce', 'coupon', 'price'],
  电商平台: ['amazon', 'taobao', 'tmall', 'jd.com', 'shop'],
  比价优惠: ['coupon', 'deal', 'discount', 'price comparison'],
  品牌官网: ['brand official', 'official store'],
  数码硬件: ['hardware', 'gadget', 'device'],
  快递物流: ['tracking', 'logistics', 'delivery'],
  票务活动: ['ticket', 'booking', 'event'],
  愿望清单: ['wishlist'],
  生活出行: ['life', 'travel', 'local', 'food', 'weather', 'health'],
  本地生活: ['local', 'city', '生活服务'],
  外卖餐饮: ['food', 'restaurant', 'delivery', '外卖'],
  旅行预订: ['travel', 'trip', 'booking'],
  酒店住宿: ['hotel', 'lodging'],
  交通出行: ['transport', 'flight', 'train', 'bus', 'route'],
  天气空气: ['weather', 'air quality', 'aqi'],
  医疗挂号: ['medical', 'hospital', 'appointment'],
  家庭宠物: ['home', 'family', 'pet'],
  金融支付: ['finance', 'bank', 'payment', 'investing', 'crypto'],
  银行支付: ['bank', 'payment', 'wallet'],
  投资行情: ['market', 'quote', '行情'],
  股票基金: ['stock', 'fund', 'etf'],
  加密资产: ['crypto', 'bitcoin', 'ethereum', 'web3'],
  记账预算: ['budget', 'expense', 'accounting'],
  税务保险: ['tax', 'insurance'],
  收款结算: ['payment gateway', 'stripe', 'paypal'],
  安全隐私: ['security', 'privacy', 'password', 'vpn', 'proxy'],
  密码管理: ['password manager', '1password', 'bitwarden'],
  二步验证: ['2fa', 'mfa', 'authenticator'],
  隐私邮箱: ['private email', 'alias email', 'temp mail'],
  代理网络: ['proxy', 'vpn', 'network'],
  安全检测: ['security scan', 'virus', 'malware', '安全检测'],
  备份恢复: ['backup', 'restore', 'recovery'],
  反诈风控: ['fraud', 'scam', 'risk control'],
  NSFW: ['nsfw', 'adult', 'porn', 'sex', 'erotic', '成人', '18+'],
  成人站点: ['adult site', 'porn', 'sex', 'xxx', '成人'],
  成人社区: ['adult community', 'nsfw forum'],
  写真擦边: ['gravure', 'cosplay', '写真', '擦边'],
  成人游戏: ['adult game', 'hentai game', 'eroge'],
  成人漫画: ['hentai', 'adult manga', 'doujin', '成人漫画'],
  情趣购物: ['sex toy', 'adult shop'],
  私密订阅: ['onlyfans', 'fansly', 'patreon adult'],
  隐私防护: ['privacy protection', 'adult privacy'],
  待分级: ['uncategorized nsfw', '待分级'],
};

const DOCUMENTATION_LABELS = new Set(['文档', '官方文档', 'API文档', '官方手册', '参考资料']);
const TUTORIAL_LABELS = new Set(['系列教程', '教程指南', '技术文章']);
const COURSE_LABELS = new Set(['在线课程', '课程', '课程页面']);
const BOOK_LABELS = new Set(['书籍', '阅读', '阅读笔记']);
const EXAMPLE_LABELS = new Set(['代码示例', '代码片段']);

const DOCUMENTATION_SIGNALS = ['文档', 'official docs', 'documentation', 'reference', 'manual', 'handbook', 'readme'];
const DOCUMENTATION_PATH_SIGNALS = ['docs', 'documentation', 'reference', 'manual', 'handbook', 'readme'];
const TUTORIAL_SIGNALS = ['教程', 'tutorial', 'guide', 'quickstart', 'getting started', 'learn', 'how to', '入门'];
const COURSE_SIGNALS = ['课程', 'course', 'academy', 'training', 'lesson', 'bootcamp'];
const BOOK_SIGNALS = ['书籍', 'book', 'ebook', 'pdf'];
const EXAMPLE_SIGNALS = ['示例', 'example', 'examples', 'sample', 'samples', 'demo', 'starter', 'boilerplate', 'snippet'];

const HOST_LABEL_RULES: Array<{ pattern: RegExp; labels: string[] }> = [
  { pattern: /(^|\.)github\.com$/i, labels: ['GitHub', 'Star清单', '贡献指南', 'Issue跟踪', 'Release更新', '代码托管', '开源发布'] },
  { pattern: /(^|\.)stackoverflow\.com$/i, labels: ['Stack Overflow', '问答社区', '报错排查'] },
  { pattern: /(^|\.)news\.ycombinator\.com$/i, labels: ['Hacker News', '科技资讯', '榜单热榜'] },
  { pattern: /(^|\.)reddit\.com$/i, labels: ['Reddit', '论坛社区', '成人社区'] },
  { pattern: /(^|\.)zhihu\.com$/i, labels: ['知乎', '问答社区'] },
  { pattern: /(^|\.)weibo\.com$/i, labels: ['微博'] },
  { pattern: /(^|\.)xiaohongshu\.com$/i, labels: ['小红书'] },
  { pattern: /(^|\.)juejin\.cn$/i, labels: ['掘金', '技术文章'] },
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
