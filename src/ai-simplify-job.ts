import type { Db } from './db';
import { getJob, updateJob } from './jobs';
import OpenAI from 'openai';
import { getOrCreateCategoryByPath } from './category-service';

export interface AISimplifyJobOptions {
  autoApply: boolean;
}

export interface CategoryMapping {
  oldCategoryId: number;
  oldCategoryName: string;
  newCategoryName: string;
  bookmarkCount: number;
  applied?: boolean;
  jobId?: string;
}

export async function runAISimplifyJob(
  db: Db,
  jobId: string,
  options: AISimplifyJobOptions,
  aiConfig: { baseUrl: string; apiKey: string; model: string },
): Promise<void> {
  const job = getJob(db, jobId);
  if (!job) throw new Error('job not found');

  updateJob(db, jobId, { status: 'running', message: '正在获取分类列表...' });

  // 清除当前任务的旧建议（如果有）
  ensureSimplifyTable(db);
  db.prepare('DELETE FROM ai_simplify_suggestions WHERE job_id = ?').run(jobId);

  // 获取所有分类及其书签数量，构建完整路径
  const categories = db.prepare(`
    SELECT 
      c.id, 
      CASE 
        WHEN p.name IS NOT NULL THEN p.name || '/' || c.name 
        ELSE c.name 
      END as name, 
      COUNT(b.id) as bookmark_count
    FROM categories c
    LEFT JOIN categories p ON c.parent_id = p.id
    LEFT JOIN bookmarks b ON b.category_id = c.id
    GROUP BY c.id
    ORDER BY name
  `).all() as Array<{ id: number; name: string; bookmark_count: number }>;

  if (categories.length === 0) {
    updateJob(db, jobId, {
      status: 'done',
      total: 0,
      processed: 0,
      message: '没有需要精简的分类',
    });
    return;
  }

  updateJob(db, jobId, {
    total: categories.length,
    message: `准备精简 ${categories.length} 个分类...`,
  });

  // 计算并保存 Token 估算
  const estimatedInputTokens = 300 + categories.length * 30; // 系统提示 + 分类列表
  const estimatedOutputTokens = categories.length * 15; // 每个分类约15 tokens
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
  const estimatedCost = (estimatedInputTokens * 0.0000025 + estimatedOutputTokens * 0.00001); // GPT-4o pricing
  const tokenEstimate = {
    totalCategories: categories.length,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens,
    estimatedCost,
  };
  try {
    db.prepare('UPDATE jobs SET extra = ? WHERE id = ?').run(
      JSON.stringify({ tokenEstimate }),
      jobId
    );
  } catch { /* ignore if extra column doesn't exist */ }

  try {
    updateJob(db, jobId, { message: '正在使用 AI 分析分类...' });

    const openai = new OpenAI({
      apiKey: aiConfig.apiKey,
      baseURL: aiConfig.baseUrl.replace(/\/+$/, ''),
      timeout: 300000, // 5分钟超时
    });

    // 一次性处理所有分类
    const categoryList = categories.map((c, idx) =>
      `${idx + 1}. ${c.name}`
    ).join('\n');

    const systemPrompt = `书签分类精简助手。你的任务是合并相似的分类。

规则：
1. 每个分类最多2级层级（如"技术开发"或"娱乐/视频"）
2. 一级分类相同，二级分类不同且不相近可以共存，（如"影音娱乐"和"影音娱乐/电影"可以共存，"影音娱乐/音乐"和"影音娱乐/电影"可以共存）
3. 一级分类相同，二级分类不同但相近则合并为能囊括这两类的分类，(如"影音娱乐/电影"和"影音娱乐/电视"则合并为"影音娱乐/影视")
4. 一级分类不同且不相近则可以共存（如"影音娱乐"和"生活服务"则共存）
5. 一级分类相同但意思相近则合并为能囊括这两类的分类（如"影音娱乐"和"视听娱乐"则合并为"影音娱乐"）
6. 目标：将分类数量减少到原来的30-50%

标准一级分类参考：技术开发、学习资源、工具软件、娱乐影音、社交媒体、新闻资讯、设计素材、生活服务、游戏、购物电商、金融理财、健康医疗、旅游出行、政府机构、企业服务、其他

输出要求：只返回 JSON 数组，格式如下：
[{"i":1,"n":"新分类名"},{"i":2,"n":"新分类名"}]
其中 i 是原分类编号，n 是新分类名。不要有任何其他内容。`;

    const userPrompt = `精简以下${categories.length}个分类：

${categoryList}

返回 JSON 数组：`;

    const completion = await openai.chat.completions.create({
      model: aiConfig.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI 未返回有效响应');
    }

    // 解析 AI 返回内容
    const allMappings: CategoryMapping[] = [];
    const cleanedContent = content.trim()
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    // 策略1: 尝试 JSON 格式解析
    try {
      // 尝试提取 JSON 数组
      const jsonMatch = cleanedContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{ i?: number; n?: string; index?: number; name?: string; category?: string }>;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            // 支持多种字段名格式
            const idx = (item.i ?? item.index ?? 0) - 1;
            let newCategory = (item.n || item.name || item.category || '').trim()
              .replace(/[\\]/g, '/')
              .replace(/\/+/g, '/')
              .replace(/^\/|\/$/g, '');

            // 限制为最多2级
            const parts = newCategory.split('/').filter(p => p.trim());
            if (parts.length > 2) {
              newCategory = parts.slice(0, 2).join('/');
            }

            if (idx >= 0 && idx < categories.length && newCategory) {
              const cat = categories[idx];
              allMappings.push({
                oldCategoryId: cat.id,
                oldCategoryName: cat.name,
                newCategoryName: newCategory,
                bookmarkCount: cat.bookmark_count,
                applied: false,
              });
            }
          }
        }
      }
    } catch { }

    // 策略2: 如果 JSON 解析失败或结果为空，尝试文本格式解析
    if (allMappings.length === 0) {
      const lines = cleanedContent.split('\n');
      for (const line of lines) {
        // 跳过包含 markdown 格式的行
        if (line.includes('**') || line.includes('##') || line.includes('```') ||
          line.startsWith('#') || line.startsWith('-') || line.startsWith('*')) {
          continue;
        }

        const match = line.match(/^(\d+)\s*[.:：)]\s*(.+)$/) ||
          line.match(/^(\d+)\s+(.+)$/);
        if (match) {
          const idx = parseInt(match[1], 10) - 1;
          let newCategory = match[2].trim()
            .replace(/\*\*/g, '').replace(/`/g, '').replace(/"/g, '')
            .replace(/[\\]/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

          const parts = newCategory.split('/').filter(p => p.trim());
          if (parts.length > 2) {
            newCategory = parts.slice(0, 2).join('/');
          }

          if (idx >= 0 && idx < categories.length && newCategory) {
            const cat = categories[idx];
            allMappings.push({
              oldCategoryId: cat.id,
              oldCategoryName: cat.name,
              newCategoryName: newCategory,
              bookmarkCount: cat.bookmark_count,
              applied: false,
            });
          }
        }
      }
    }

    if (allMappings.length === 0) {
      throw new Error('AI 未能生成有效的精简建议，返回内容: ' + cleanedContent.slice(0, 200));
    }

    const mappings = allMappings;

    // 保存精简建议到数据库
    ensureSimplifyTable(db);
    db.prepare('DELETE FROM ai_simplify_suggestions WHERE job_id = ?').run(jobId);

    const stmt = db.prepare(`
      INSERT INTO ai_simplify_suggestions (job_id, old_category_id, old_category_name, new_category_name, bookmark_count, applied, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `);

    const now = new Date().toISOString();
    for (const m of mappings) {
      stmt.run(jobId, m.oldCategoryId, m.oldCategoryName, m.newCategoryName, m.bookmarkCount, now);
    }

    if (options.autoApply) {
      updateJob(db, jobId, { message: '正在应用精简结果...' });
      const applied = applySimplifyMappings(db, mappings);

      updateJob(db, jobId, {
        status: 'done',
        processed: categories.length,
        inserted: applied,
        message: `完成！已精简 ${mappings.length} 个分类映射，应用了 ${applied} 个`,
      });
    } else {
      updateJob(db, jobId, {
        status: 'done',
        processed: categories.length,
        inserted: mappings.length,
        message: `完成！获得 ${mappings.length} 个精简建议，请查看并应用`,
      });
    }
  } catch (error: any) {
    updateJob(db, jobId, {
      status: 'failed',
      message: `AI 精简失败: ${error.message || '未知错误'}`,
    });
  }
}

function ensureSimplifyTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_simplify_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      old_category_id INTEGER NOT NULL,
      old_category_name TEXT NOT NULL,
      new_category_name TEXT NOT NULL,
      bookmark_count INTEGER DEFAULT 0,
      applied INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // 检查并添加job_id列（如果不存在）
  const columns = db.prepare("PRAGMA table_info(ai_simplify_suggestions)").all() as Array<{ name: string }>;
  const hasJobId = columns.some(col => col.name === 'job_id');

  if (!hasJobId) {
    db.exec(`ALTER TABLE ai_simplify_suggestions ADD COLUMN job_id TEXT DEFAULT 'legacy'`);
  }

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_simplify_old_cat ON ai_simplify_suggestions(old_category_id);
    CREATE INDEX IF NOT EXISTS idx_simplify_job_id ON ai_simplify_suggestions(job_id);
  `);
}

function applySimplifyMappings(db: Db, mappings: CategoryMapping[]): number {
  // 预编译SQL语句以提升性能
  const selectCategoryByIdStmt = db.prepare('SELECT id, name, parent_id FROM categories WHERE id = ?');
  const updateBookmarksStmt = db.prepare('UPDATE bookmarks SET category_id = ? WHERE category_id = ?');
  const countBookmarksStmt = db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE category_id = ?');
  const countChildCategoriesStmt = db.prepare('SELECT COUNT(*) as count FROM categories WHERE parent_id = ?');
  const deleteCategoryStmt = db.prepare('DELETE FROM categories WHERE id = ?');
  const markAppliedStmt = db.prepare('UPDATE ai_simplify_suggestions SET applied = 1 WHERE old_category_id = ? AND (job_id = ? OR ? IS NULL)');

  // 辅助函数：获取或创建层级分类，使用 category-service 统一处理
  function getOrCreateHierarchicalCategory(categoryPath: string): number {
    return getOrCreateCategoryByPath(db, categoryPath);
  }

  // 辅助函数：如果分类为空则删除（包括检查父分类）
  function deleteCategoryIfEmpty(categoryId: number): void {
    const remainingBookmarks = countBookmarksStmt.get(categoryId) as { count: number };
    const childCategories = countChildCategoriesStmt.get(categoryId) as { count: number };

    if (remainingBookmarks.count === 0 && childCategories.count === 0) {
      const category = selectCategoryByIdStmt.get(categoryId) as { id: number; name: string; parent_id: number | null } | undefined;
      const parentId = category?.parent_id;

      deleteCategoryStmt.run(categoryId);

      // 递归检查父分类是否也为空
      if (parentId) {
        deleteCategoryIfEmpty(parentId);
      }
    }
  }

  let applied = 0;
  const errors: string[] = [];

  // 使用事务包裹批量操作以提升性能
  const applyAll = db.transaction(() => {
    for (const mapping of mappings) {
      try {
        // 检查旧分类是否还存在
        const oldCategory = selectCategoryByIdStmt.get(mapping.oldCategoryId) as { id: number; name: string } | undefined;
        if (!oldCategory) {
          // 旧分类已不存在，直接标记为已应用
          markAppliedStmt.run(mapping.oldCategoryId, mapping.jobId, mapping.jobId);
          applied++;
          continue;
        }

        // 如果新旧分类名相同，跳过
        if (oldCategory.name === mapping.newCategoryName) {
          markAppliedStmt.run(mapping.oldCategoryId, mapping.jobId, mapping.jobId);
          applied++;
          continue;
        }

        // 查找或创建新分类（支持层级路径如 "技术/编程"）
        const newCategoryId = getOrCreateHierarchicalCategory(mapping.newCategoryName);

        // 移动书签到新分类
        updateBookmarksStmt.run(newCategoryId, mapping.oldCategoryId);

        // 删除旧分类（如果没有书签和子分类了，递归删除空父分类）
        if (mapping.oldCategoryId !== newCategoryId) {
          deleteCategoryIfEmpty(mapping.oldCategoryId);
        }

        // 标记为已应用
        markAppliedStmt.run(mapping.oldCategoryId, mapping.jobId, mapping.jobId);
        applied++;
      } catch (error: any) {
        const errMsg = `Failed to apply mapping ${mapping.oldCategoryId}: ${error.message}`;
        console.error(errMsg, error);
        errors.push(errMsg);
        // 继续处理其他映射
      }
    }
  });

  try {
    applyAll();
  } catch (error: any) {
    console.error('Transaction failed:', error);
    throw new Error(`应用失败: ${error.message}`);
  }

  if (errors.length > 0) {
    console.warn('Some mappings failed:', errors);
  }

  return applied;
}

export function getSimplifyMappings(db: Db): CategoryMapping[] {
  ensureSimplifyTable(db);
  const rows = db.prepare(`
    SELECT old_category_id, old_category_name, new_category_name, bookmark_count, applied
    FROM ai_simplify_suggestions
    ORDER BY new_category_name, old_category_name
  `).all() as Array<{
    old_category_id: number;
    old_category_name: string;
    new_category_name: string;
    bookmark_count: number;
    applied: number;
  }>;

  return rows.map(r => ({
    oldCategoryId: r.old_category_id,
    oldCategoryName: r.old_category_name,
    newCategoryName: r.new_category_name,
    bookmarkCount: r.bookmark_count,
    applied: r.applied === 1,
  }));
}

export function getSimplifyMappingsByJobId(db: Db, jobId: string): CategoryMapping[] {
  ensureSimplifyTable(db);
  const rows = db.prepare(`
    SELECT old_category_id, old_category_name, new_category_name, bookmark_count, applied
    FROM ai_simplify_suggestions
    WHERE job_id = ?
    ORDER BY new_category_name, old_category_name
  `).all(jobId) as Array<{
    old_category_id: number;
    old_category_name: string;
    new_category_name: string;
    bookmark_count: number;
    applied: number;
  }>;

  return rows.map(r => ({
    oldCategoryId: r.old_category_id,
    oldCategoryName: r.old_category_name,
    newCategoryName: r.new_category_name,
    bookmarkCount: r.bookmark_count,
    applied: r.applied === 1,
  }));
}

export function applyOneSimplifyMapping(db: Db, oldCategoryId: number, jobId?: string): { success: boolean; error?: string } {
  ensureSimplifyTable(db);

  let mapping;
  if (jobId) {
    mapping = db.prepare(`
      SELECT old_category_id, old_category_name, new_category_name, bookmark_count
      FROM ai_simplify_suggestions
      WHERE old_category_id = ? AND job_id = ? AND applied = 0
    `).get(oldCategoryId, jobId);
  } else {
    mapping = db.prepare(`
      SELECT old_category_id, old_category_name, new_category_name, bookmark_count
      FROM ai_simplify_suggestions
      WHERE old_category_id = ? AND applied = 0
    `).get(oldCategoryId);
  }

  const typedMapping = mapping as {
    old_category_id: number;
    old_category_name: string;
    new_category_name: string;
    bookmark_count: number;
  } | undefined;

  if (!typedMapping) {
    return { success: false, error: '未找到该精简建议或已应用' };
  }

  try {
    const applied = applySimplifyMappings(db, [{
      oldCategoryId: typedMapping.old_category_id,
      oldCategoryName: typedMapping.old_category_name,
      newCategoryName: typedMapping.new_category_name,
      bookmarkCount: typedMapping.bookmark_count,
      jobId: jobId,
    }]);

    return { success: applied > 0 };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function applyAllSimplifyMappings(db: Db, jobId?: string): { success: boolean; applied: number; error?: string } {
  ensureSimplifyTable(db);

  // 如果传入 jobId，只应用该任务的建议；否则应用所有未应用的建议
  let mappings;
  if (jobId) {
    mappings = db.prepare(`
      SELECT old_category_id, old_category_name, new_category_name, bookmark_count
      FROM ai_simplify_suggestions
      WHERE applied = 0 AND job_id = ?
    `).all(jobId) as Array<{
      old_category_id: number;
      old_category_name: string;
      new_category_name: string;
      bookmark_count: number;
    }>;
  } else {
    mappings = db.prepare(`
      SELECT old_category_id, old_category_name, new_category_name, bookmark_count
      FROM ai_simplify_suggestions
      WHERE applied = 0
    `).all() as Array<{
      old_category_id: number;
      old_category_name: string;
      new_category_name: string;
      bookmark_count: number;
    }>;
  }

  if (mappings.length === 0) {
    return { success: true, applied: 0 };
  }

  try {
    const applied = applySimplifyMappings(db, mappings.map(m => ({
      oldCategoryId: m.old_category_id,
      oldCategoryName: m.old_category_name,
      newCategoryName: m.new_category_name,
      bookmarkCount: m.bookmark_count,
      jobId: jobId,
    })));

    return { success: true, applied };
  } catch (error: any) {
    return { success: false, applied: 0, error: error.message };
  }
}
