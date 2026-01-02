import type { Db } from './db';
import { getJob, updateJob } from './jobs';
import OpenAI from 'openai';

export interface AISimplifyJobOptions {
  autoApply: boolean;
}

export interface CategoryMapping {
  oldCategoryId: number;
  oldCategoryName: string;
  newCategoryName: string;
  bookmarkCount: number;
  applied?: boolean;
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

  // 获取所有分类及其书签数量
  const categories = db.prepare(`
    SELECT c.id, c.name, COUNT(b.id) as bookmark_count
    FROM categories c
    LEFT JOIN bookmarks b ON b.category_id = c.id
    GROUP BY c.id
    ORDER BY c.name
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

    const systemPrompt = `你是分类精简助手。将书签分类合并精简为最多2级结构。

【核心目标】
大幅减少分类数量，将相似分类合并。最终新分类数量应为原分类数量的30-50%。

【强制规则】
1. 新分类最多2级(如"技术开发"或"娱乐/视频")，禁止3级
2. 相似或相关的分类必须合并
3. 保持2级结构：一级分类表示大类，二级分类表示细分（如需要）
4. 名称简洁，每级不超过6个字
5. 一级名称相同或意思相近的分类必须合并
6. 二级名称相同或意思相近的分类也必须合并

【标准一级分类参考】
技术开发、学习资源、工具软件、购物电商、娱乐影音、社交媒体、新闻资讯、设计素材、生活服务、游戏、成人内容、其他

【合并规则】
- 意思相近的一级分类必须合并（如"娱乐休闲"、"娱乐影音"、"娱乐"都合并为"娱乐影音"）
- 相同一级分类下的二级分类尽量合并（如"娱乐/视频/B站"和"娱乐/视频/YouTube"合并为"娱乐/视频"）
- 过于细分的分类向上合并（如"技术/开发/前端/React"合并为"技术开发"或"技术/前端"）
- 一级分类完全相同的，如果二级也相近则必须合并（如"娱乐/视频"和"娱乐/影视"合并为"娱乐/视频"）
- 积极合并，宁可多合并也不要保留太多分类

【合并示例】
- 娱乐/视频/B站、娱乐/视频/YouTube、娱乐/视频 → 娱乐/视频
- 娱乐休闲、娱乐影音、娱乐、娱乐/游戏 → 娱乐影音、娱乐/游戏
- 技术开发、技术/编程、技术 → 技术开发`;

    const userPrompt = `将以下${categories.length}个分类精简合并：

${categoryList}

返回格式(每行一个，编号:新分类名)：
1:技术开发
2:技术开发
3:娱乐/视频
...`;

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

    // 解析简单格式：每行 "编号:新分类名"
    const allMappings: CategoryMapping[] = [];
    const lines = content.trim().split('\n');
    
    for (const line of lines) {
      const match = line.match(/^(\d+)\s*[:：]\s*(.+)$/);
      if (match) {
        const idx = parseInt(match[1], 10) - 1;
        let newCategory = match[2].trim()
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

    if (allMappings.length === 0) {
      throw new Error('AI 未能生成有效的精简建议');
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
  const selectCategoryByIdStmt = db.prepare('SELECT id, name FROM categories WHERE id = ?');
  const selectCategoryByNameStmt = db.prepare('SELECT id FROM categories WHERE name = ?');
  const insertCategoryStmt = db.prepare('INSERT INTO categories (name, parent_id, created_at) VALUES (?, NULL, ?)');
  const updateBookmarksStmt = db.prepare('UPDATE bookmarks SET category_id = ? WHERE category_id = ?');
  const countBookmarksStmt = db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE category_id = ?');
  const deleteCategoryStmt = db.prepare('DELETE FROM categories WHERE id = ?');
  const markAppliedStmt = db.prepare('UPDATE ai_simplify_suggestions SET applied = 1 WHERE old_category_id = ?');
  
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
          markAppliedStmt.run(mapping.oldCategoryId);
          applied++;
          continue;
        }
        
        // 如果新旧分类名相同，跳过
        if (oldCategory.name === mapping.newCategoryName) {
          markAppliedStmt.run(mapping.oldCategoryId);
          applied++;
          continue;
        }
        
        // 查找或创建新分类
        let newCategoryId: number;
        const existing = selectCategoryByNameStmt.get(mapping.newCategoryName) as { id: number } | undefined;
        if (existing) {
          newCategoryId = existing.id;
        } else {
          const result = insertCategoryStmt.run(mapping.newCategoryName, new Date().toISOString());
          newCategoryId = result.lastInsertRowid as number;
        }
        
        // 移动书签到新分类
        const updateResult = updateBookmarksStmt.run(newCategoryId, mapping.oldCategoryId);
        
        // 删除旧分类（如果没有书签了）
        const remainingBookmarks = countBookmarksStmt.get(mapping.oldCategoryId) as { count: number };
        if (remainingBookmarks.count === 0 && mapping.oldCategoryId !== newCategoryId) {
          deleteCategoryStmt.run(mapping.oldCategoryId);
        }
        
        // 标记为已应用
        markAppliedStmt.run(mapping.oldCategoryId);
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
    }]);
    
    return { success: applied > 0 };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function applyAllSimplifyMappings(db: Db): { success: boolean; applied: number; error?: string } {
  ensureSimplifyTable(db);
  
  const mappings = db.prepare(`
    SELECT old_category_id, old_category_name, new_category_name, bookmark_count
    FROM ai_simplify_suggestions
    WHERE applied = 0
  `).all() as Array<{
    old_category_id: number;
    old_category_name: string;
    new_category_name: string;
    bookmark_count: number;
  }>;
  
  if (mappings.length === 0) {
    return { success: true, applied: 0 };
  }
  
  try {
    const applied = applySimplifyMappings(db, mappings.map(m => ({
      oldCategoryId: m.old_category_id,
      oldCategoryName: m.old_category_name,
      newCategoryName: m.new_category_name,
      bookmarkCount: m.bookmark_count,
    })));
    
    return { success: true, applied };
  } catch (error: any) {
    return { success: false, applied: 0, error: error.message };
  }
}
