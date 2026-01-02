import type { Db } from './db';
import { addJobFailure, getJob, updateJob } from './jobs';
import { AIClassifier, type BookmarkToClassify, type ClassificationResult, type ClassifyBatchResult } from './ai-classifier';

export interface AIClassifyJobOptions {
  scope: 'all' | 'uncategorized' | 'category' | 'selected';
  categoryId?: number | null;
  autoApply: boolean;
  bookmarkIds?: number[];
  batchSize?: number;
}

export async function runAIClassifyJob(
  db: Db,
  jobId: string,
  options: AIClassifyJobOptions,
  aiConfig: { baseUrl: string; apiKey: string; model: string },
): Promise<void> {
  const job = getJob(db, jobId);
  if (!job) throw new Error('job not found');

  updateJob(db, jobId, { status: 'running', message: '正在获取书签列表...' });

  const bookmarks = getBookmarksForClassification(db, options);

  if (bookmarks.length === 0) {
    updateJob(db, jobId, {
      status: 'done',
      total: 0,
      processed: 0,
      message: '没有需要分类的书签',
    });
    return;
  }

  updateJob(db, jobId, {
    total: bookmarks.length,
    message: `准备分类 ${bookmarks.length} 个书签...`,
  });

  const classifier = new AIClassifier(aiConfig, db, options.batchSize || 30);
  let results: ClassificationResult[] = [];
  
  try {
    updateJob(db, jobId, { message: '正在使用 AI 分析书签...' });
    
    let processed = 0;
    const batchSize = options.batchSize || 30;
    
    for (let i = 0; i < bookmarks.length; i += batchSize) {
      const currentJob = getJob(db, jobId);
      if (currentJob?.status === 'canceled') {
        updateJob(db, jobId, { message: '已取消分类任务' });
        return;
      }

      const batch = bookmarks.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(bookmarks.length / batchSize);
      
      updateJob(db, jobId, { 
        message: `正在处理第 ${batchNum}/${totalBatches} 批书签 (${batch.length} 个)...`,
        processed,
        inserted: results.length,
      });

      try {
        const batchResult = await classifier.classifyBatch(batch);
        results.push(...batchResult.results);
        
        processed += batch.length;
        
        // 实时保存每批分类建议（无论是否自动应用都保存，用于显示进度）
        if (batchResult.results.length > 0) {
          saveBatchSuggestions(db, batchResult.results);
        }
        
        // 自动应用模式下，实时应用每批分类
        if (options.autoApply && batchResult.results.length > 0) {
          applyBatchClassifications(db, classifier, batchResult.results);
        }
        
        updateJob(db, jobId, { 
          processed,
          inserted: results.length,
        });
      } catch (error: any) {
        for (const bookmark of batch) {
          addJobFailure(db, jobId, `${bookmark.title} | ${bookmark.url}`, error.message || '分类失败');
        }
        processed += batch.length;
        updateJob(db, jobId, { processed });
      }

      if (i + batchSize < bookmarks.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (options.autoApply) {
      // 分类已在每批处理时实时应用，无需再次应用
      updateJob(db, jobId, {
        status: 'done',
        processed: bookmarks.length,
        inserted: results.length,
        message: `完成！已分类并应用 ${results.length} 个书签`,
      });
    } else {
      // 分类建议已在每批处理时实时保存，无需再次保存
      updateJob(db, jobId, {
        status: 'done',
        processed: bookmarks.length,
        inserted: results.length,
        message: `完成！获得 ${results.length} 个分类建议，请到书签列表查看和应用`,
      });
    }
  } catch (error: any) {
    updateJob(db, jobId, {
      status: 'failed',
      message: `AI 分类失败: ${error.message || '未知错误'}`,
    });
  }
}

function getBookmarksForClassification(db: Db, options: AIClassifyJobOptions): BookmarkToClassify[] {
  let query = '';
  let params: any[] = [];

  if (options.scope === 'all') {
    query = `
      SELECT b.id, b.url, b.title, c.name AS current_category
      FROM bookmarks b
      LEFT JOIN categories c ON b.category_id = c.id
      ORDER BY b.created_at DESC
    `;
  } else if (options.scope === 'uncategorized') {
    query = `
      SELECT b.id, b.url, b.title, NULL AS current_category
      FROM bookmarks b
      WHERE b.category_id IS NULL
      ORDER BY b.created_at DESC
    `;
  } else if (options.scope === 'category' && options.categoryId) {
    query = `
      SELECT b.id, b.url, b.title, c.name AS current_category
      FROM bookmarks b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.category_id = ?
      ORDER BY b.created_at DESC
    `;
    params = [options.categoryId];
  } else if (options.scope === 'selected' && options.bookmarkIds && options.bookmarkIds.length > 0) {
    const placeholders = options.bookmarkIds.map(() => '?').join(',');
    query = `
      SELECT b.id, b.url, b.title, c.name AS current_category
      FROM bookmarks b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.id IN (${placeholders})
      ORDER BY b.created_at DESC
    `;
    params = options.bookmarkIds;
  } else {
    return [];
  }

  const rows = db.prepare(query).all(...params) as Array<{
    id: number;
    url: string;
    title: string;
    current_category: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    currentCategory: row.current_category,
  }));
}

function applyClassifications(db: Db, classifier: AIClassifier, results: ClassificationResult[]): number {
  let applied = 0;

  for (const result of results) {
    try {
      const normalizedCategory = normalizeCategoryPath(result.suggestedCategory);
      const categoryId = classifier.getOrCreateCategoryId(normalizedCategory);
      if (categoryId) {
        db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?').run(categoryId, result.bookmarkId);
        // 标记建议为已应用
        markSuggestionApplied(db, result.bookmarkId);
        applied++;
      }
    } catch (error) {
      continue;
    }
  }

  return applied;
}

function applyBatchClassifications(db: Db, classifier: AIClassifier, results: ClassificationResult[]): void {
  for (const result of results) {
    try {
      const normalizedCategory = normalizeCategoryPath(result.suggestedCategory);
      const categoryId = classifier.getOrCreateCategoryId(normalizedCategory);
      if (categoryId) {
        db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?').run(categoryId, result.bookmarkId);
        // 标记建议为已应用
        markSuggestionApplied(db, result.bookmarkId);
      }
    } catch (error) {
      continue;
    }
  }
}

function markSuggestionApplied(db: Db, bookmarkId: number): void {
  try {
    db.exec('ALTER TABLE ai_classification_suggestions ADD COLUMN applied INTEGER DEFAULT 0');
  } catch {}
  db.prepare('UPDATE ai_classification_suggestions SET applied = 1 WHERE bookmark_id = ?').run(bookmarkId);
}

function ensureSuggestionsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_classification_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
      suggested_category TEXT NOT NULL,
      confidence TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_bookmark ON ai_classification_suggestions(bookmark_id);
  `);
}

function normalizeCategoryPath(category: string): string {
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

function saveBatchSuggestions(db: Db, results: ClassificationResult[]): void {
  if (results.length === 0) return;
  
  ensureSuggestionsTable(db);

  const stmt = db.prepare(`
    INSERT INTO ai_classification_suggestions (bookmark_id, suggested_category, confidence, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const result of results) {
    const normalizedCategory = normalizeCategoryPath(result.suggestedCategory);
    stmt.run(result.bookmarkId, normalizedCategory, result.confidence, now);
  }
}

function saveClassificationSuggestions(db: Db, results: ClassificationResult[]): void {
  ensureSuggestionsTable(db);
  db.prepare('DELETE FROM ai_classification_suggestions').run();

  const stmt = db.prepare(`
    INSERT INTO ai_classification_suggestions (bookmark_id, suggested_category, confidence, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const result of results) {
    const normalizedCategory = normalizeCategoryPath(result.suggestedCategory);
    stmt.run(result.bookmarkId, normalizedCategory, result.confidence, now);
  }
}
