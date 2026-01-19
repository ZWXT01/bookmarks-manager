import OpenAI from 'openai';
import type { Db } from './db';
import { getOrCreateCategoryByPath } from './category-service';

export interface AIClassifyConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface BookmarkToClassify {
  id: number;
  url: string;
  title: string;
  currentCategory: string | null;
}

export interface ClassificationResult {
  bookmarkId: number;
  suggestedCategory: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface FailedBookmark {
  bookmarkId: number;
  url: string;
  title: string;
  reason: string;
}

export interface BatchClassificationResult {
  results: ClassificationResult[];
}

export interface ClassifyBatchResult {
  results: ClassificationResult[];
  failedBookmarks: FailedBookmark[];
}

export interface TokenEstimate {
  totalBookmarks: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedCost: number; // USD
  pricePerMillionTokens: number;
}

export interface CategoryMapping {
  [key: string]: string[];
}

const CATEGORY_KEYWORDS: CategoryMapping = {
  '技术开发': ['编程', '代码', '开发', '技术', 'IT', '计算机', '软件', '算法', 'github', 'git', 'programming', 'code', 'dev'],
  '学习资源': ['教程', '学习', '课程', '教育', '知识', '文档', '博客', 'blog', 'tutorial', 'learn', 'course'],
  '工作工具': ['工作', '工具', '办公', '管理', '项目', 'admin', 'tool', 'office'],
  '搜索引擎': ['搜索', 'google', '百度', '查询', '翻译', 'search', 'bing'],
  '娱乐休闲': ['视频', '音乐', '游戏', '娱乐', 'bilibili', 'youtube', '影视', 'video', 'music', 'game'],
  '社交媒体': ['社交', '论坛', '社区', 'twitter', 'reddit', 'facebook', 'social'],
  '新闻资讯': ['新闻', '资讯', '媒体', 'news', '时事'],
  '设计创意': ['设计', '创意', 'UI', 'UX', 'design', '配色', '图标', 'icon'],
};

const AI_REQUEST_TIMEOUT_MS = 60000;
const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 1000;

export class AIClassifier {
  private config: AIClassifyConfig;
  private db: Db;
  private existingCategories: Set<string> = new Set();
  private batchSize: number;

  constructor(config: AIClassifyConfig, db: Db, batchSize: number = 30) {
    this.config = config;
    this.db = db;
    this.batchSize = batchSize;
    this.loadExistingCategories();
  }

  private loadExistingCategories(): void {
    const rows = this.db.prepare('SELECT name FROM categories').all() as { name: string }[];
    rows.forEach((row) => this.existingCategories.add(row.name));
  }

  /**
   * 估算 Token 消耗和费用
   * @param bookmarks 书签列表
   * @param pricePerMillionTokens 每百万 token 价格（USD），默认 0.15（gpt-4o-mini 输入价格）
   */
  static estimateTokens(bookmarks: BookmarkToClassify[], pricePerMillionTokens: number = 0.15): TokenEstimate {
    // 估算规则：
    // - systemPrompt 约 200 tokens
    // - 每个书签约 20-50 tokens（标题 + URL）
    // - 输出每个书签约 20 tokens
    const systemPromptTokens = 200;
    const tokensPerBookmark = 35; // 平均估计
    const outputTokensPerBookmark = 20;

    const estimatedInputTokens = systemPromptTokens + (bookmarks.length * tokensPerBookmark);
    const estimatedOutputTokens = bookmarks.length * outputTokensPerBookmark;
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

    // 费用计算（以 gpt-4o-mini 为参考，实际可能不同）
    const estimatedCost = (estimatedTotalTokens / 1_000_000) * pricePerMillionTokens;

    return {
      totalBookmarks: bookmarks.length,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedTotalTokens,
      estimatedCost,
      pricePerMillionTokens,
    };
  }

  async classifyBatch(bookmarks: BookmarkToClassify[]): Promise<ClassifyBatchResult> {
    const results: ClassificationResult[] = [];
    const failedBookmarks: FailedBookmark[] = [];

    for (let i = 0; i < bookmarks.length; i += this.batchSize) {
      const batch = bookmarks.slice(i, i + this.batchSize);

      try {
        const batchResult = await this.classifyBatchWithAI(batch);
        results.push(...batchResult.results);
      } catch (error) {
        // AI 失败时使用关键词匹配兜底
        console.warn('AI classification failed, using fallback:', error instanceof Error ? error.message : error);
        const fallbackResults = this.fallbackClassification(batch);
        results.push(...fallbackResults);
      }

      if (i + this.batchSize < bookmarks.length) {
        await this.sleep(BATCH_DELAY_MS);
      }
    }

    return { results, failedBookmarks };
  }

  private async classifyBatchWithAI(bookmarks: BookmarkToClassify[]): Promise<BatchClassificationResult> {
    const bookmarkList = bookmarks
      .map((b, idx) => `${idx + 1}. ${b.title} | ${b.url}`)
      .join('\n');

    // 获取已有分类的一级分类，用于引导AI复用
    const existingCategoriesList = Array.from(this.existingCategories);
    const topLevelCategories = new Set<string>();
    existingCategoriesList.forEach(c => {
      const first = c.split('/')[0];
      if (first) topLevelCategories.add(first);
    });

    // 构建一级分类提示
    const existingTopCategories = Array.from(topLevelCategories).slice(0, 15);
    const defaultCategories = '技术开发、学习资源、工具软件、娱乐影音、社交媒体、新闻资讯、设计素材、生活服务、游戏、购物电商、金融理财、健康医疗、旅游出行、政府机构、企业服务、其他';
    const categoriesHint = existingTopCategories.length > 0
      ? existingTopCategories.join('、')
      : defaultCategories;

    const systemPrompt = `你是专业的书签分类助手。使用联网信息以及根据书签的URL域名和标题判断网站类型并分类。

分类规则：
1. 格式必须是：一级分类 或 一级分类/二级分类（最多2级）
2. 根据网站实际用途分类，而非表面内容

分类判断优先级：
0. 使用联网信息
1. 看域名
2. 看网站类型
3. 看标题关键词：作为辅助判断

参考一级分类：${categoriesHint}

⚠️ 必须严格返回JSON格式，不要有任何其他文字！`;

    const userPrompt = `对以下${bookmarks.length}个书签进行分类：

${bookmarkList}

严格返回JSON（无其他内容）：{"classifications":[{"index":1,"category":"分类名"},{"index":2,"category":"分类名"}]}`;

    try {
      const openai = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl.replace(/\/+$/, ''),
        timeout: AI_REQUEST_TIMEOUT_MS,
      });

      const completion = await openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const content = completion.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('AI 未返回有效响应');
      }

      // 增强 JSON 解析：尝试多种格式
      let classifications: any[] = [];
      const cleanedContent = content.trim()
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();

      // 策略1: 直接解析完整 JSON
      try {
        const parsed = JSON.parse(cleanedContent);
        if (parsed.classifications && Array.isArray(parsed.classifications)) {
          classifications = parsed.classifications;
        } else if (Array.isArray(parsed)) {
          classifications = parsed;
        }
      } catch {
        // 策略2: 尝试提取 JSON 对象
        const jsonMatch = cleanedContent.match(/\{[\s\S]*"classifications"\s*:\s*\[[\s\S]*\]\s*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.classifications) classifications = parsed.classifications;
          } catch { }
        }

        // 策略3: 尝试提取数组部分
        if (classifications.length === 0) {
          const arrayMatch = cleanedContent.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            try {
              classifications = JSON.parse(arrayMatch[0]);
            } catch { }
          }
        }

        // 策略4: 逐行解析（应对 AI 返回简单格式）
        if (classifications.length === 0) {
          const lines = cleanedContent.split('\n');
          for (const line of lines) {
            // 匹配格式：1. 分类名 或 1:分类名 或 {"index":1,"category":"分类名"}
            const simpleMatch = line.match(/^(\d+)[.\s:：]+(.+)$/);
            if (simpleMatch) {
              classifications.push({
                index: parseInt(simpleMatch[1], 10),
                category: simpleMatch[2].trim()
              });
            }
          }
        }
      }

      if (classifications.length === 0) {
        throw new Error('AI 返回的内容不是有效的 JSON: ' + cleanedContent.slice(0, 200));
      }

      const results: ClassificationResult[] = [];
      for (const item of classifications) {
        const idx = (typeof item.index === 'number' ? item.index : parseInt(item.index)) - 1;
        if (idx >= 0 && idx < bookmarks.length && item.category) {
          const category = this.normalizeCategory(item.category);
          results.push({
            bookmarkId: bookmarks[idx].id,
            suggestedCategory: category,
            confidence: 'high',
          });

          this.existingCategories.add(category);
        }
      }

      if (results.length === 0) {
        throw new Error('AI 未返回任何有效分类');
      }

      return { results };
    } catch (error: any) {
      throw error;
    }
  }

  private fallbackClassification(bookmarks: BookmarkToClassify[]): ClassificationResult[] {
    return bookmarks.map((bookmark) => {
      const titleLower = bookmark.title.toLowerCase();
      const urlLower = bookmark.url.toLowerCase();
      let matchedCategory = '其他';
      let maxMatches = 0;

      for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        let matches = 0;
        for (const keyword of keywords) {
          if (titleLower.includes(keyword) || urlLower.includes(keyword)) {
            matches++;
          }
        }
        if (matches > maxMatches) {
          maxMatches = matches;
          matchedCategory = category;
        }
      }

      return {
        bookmarkId: bookmark.id,
        suggestedCategory: matchedCategory,
        confidence: maxMatches > 0 ? 'medium' : 'low',
      };
    });
  }

  private normalizeCategory(category: string): string {
    let normalized = category
      .trim()
      .replace(/[\\]/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/|\/$/g, '');

    // 限制分类层级不超过2级
    const parts = normalized.split('/').filter(p => p.trim());
    if (parts.length > 2) {
      normalized = parts.slice(0, 2).join('/');
    }

    return normalized;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getOrCreateCategoryId(categoryPath: string): number | null {
    const parts = categoryPath.split('/').filter((p) => p.trim());
    if (parts.length === 0) return null;

    try {
      // 使用 category-service 中的统一函数创建分类
      const categoryId = getOrCreateCategoryByPath(this.db, categoryPath);
      this.existingCategories.add(categoryPath);
      return categoryId;
    } catch {
      return null;
    }
  }
}
