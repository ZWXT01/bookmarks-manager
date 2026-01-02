import OpenAI from 'openai';
import type { Db } from './db';

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

export interface BatchClassificationResult {
  results: ClassificationResult[];
}

export interface ClassifyBatchResult {
  results: ClassificationResult[];
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

  async classifyBatch(bookmarks: BookmarkToClassify[]): Promise<ClassifyBatchResult> {
    const results: ClassificationResult[] = [];

    for (let i = 0; i < bookmarks.length; i += this.batchSize) {
      const batch = bookmarks.slice(i, i + this.batchSize);
      
      try {
        const batchResult = await this.classifyBatchWithAI(batch);
        results.push(...batchResult.results);
      } catch (error) {
        const fallbackResults = this.fallbackClassification(batch);
        results.push(...fallbackResults);
      }

      if (i + this.batchSize < bookmarks.length) {
        await this.sleep(BATCH_DELAY_MS);
      }
    }

    return { results };
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
    const topCategoriesHint = topLevelCategories.size > 0
      ? `\n\n【必须使用的一级分类】：${Array.from(topLevelCategories).slice(0, 15).join('、')}\n如果书签不属于以上任何一级分类，可使用：其他`
      : '';

    const systemPrompt = `你是书签分类助手。通过联网访问网页了解内容后分类。

【核心规则】
1. 分类格式：一级分类 或 一级/二级 或 一级/二级/三级
2. 禁止超过3级！错误示例：娱乐/视频/B站/UP主（4级，禁止）
3. 必须复用已有一级分类，不要创建新的一级分类
4. 相似网站归入同一分类，避免创建过多分类

【标准一级分类】
技术开发、学习资源、工具软件、购物电商、娱乐影音、社交媒体、新闻资讯、设计素材、生活服务、游戏、成人内容、其他${topCategoriesHint}`;

    const userPrompt = `分类以下书签（联网访问了解内容）：

${bookmarkList}

返回JSON（不要代码块）：
{"classifications":[{"index":1,"category":"一级/二级"}]}

注意：分类最多3级，禁止4级！`;

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

      const cleanedContent = content.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      
      let parsed: any;
      try {
        parsed = JSON.parse(cleanedContent);
      } catch (e) {
        throw new Error('AI 返回的内容不是有效的 JSON');
      }

      if (!parsed.classifications || !Array.isArray(parsed.classifications)) {
        throw new Error('AI 返回格式错误');
      }

      const results: ClassificationResult[] = [];
      for (const item of parsed.classifications) {
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
    
    // 限制分类层级不超过3级
    const parts = normalized.split('/').filter(p => p.trim());
    if (parts.length > 3) {
      normalized = parts.slice(0, 3).join('/');
    }
    
    return normalized;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getOrCreateCategoryId(categoryPath: string): number | null {
    const parts = categoryPath.split('/').filter((p) => p.trim());
    if (parts.length === 0) return null;

    const transaction = this.db.transaction(() => {
      let currentPath = '';
      let parentId: number | null = null;

      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        let row = this.db.prepare('SELECT id FROM categories WHERE name = ?').get(currentPath) as { id: number } | undefined;
        
        if (!row) {
          const result = this.db
            .prepare('INSERT INTO categories (name, parent_id, created_at) VALUES (?, ?, ?)')
            .run(currentPath, parentId, new Date().toISOString());
          
          row = { id: Number(result.lastInsertRowid) };
          this.existingCategories.add(currentPath);
        }
        
        parentId = row.id;
      }

      return parentId;
    });

    return transaction();
  }
}
