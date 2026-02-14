/**
 * Level-based AI Simplification Module
 * 
 * Supports:
 * - Level-1 simplification: Merge top-level categories, children follow
 * - Level-2 simplification: Merge sub-categories within selected parents
 * - Merge modes: A→B (into existing) or A+B→C (into new)
 */
import OpenAI from 'openai';
import type { Db } from './db';
import { getTopLevelCategories, getSubCategories, getOrCreateCategoryByPath, getCategoryById } from './category-service';
import { updateJob, getJob } from './jobs';

const AI_REQUEST_TIMEOUT_MS = 120000;

export interface SimplifyConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface SimplifyJobOptions {
    level: 1 | 2;
    /** For level-2, which parent category IDs to process */
    parentIds?: number[];
    autoApply: boolean;
}

export interface MergeSuggestion {
    /** Source category IDs to merge */
    sourceIds: number[];
    sourceNames: string[];
    /** Target category name (may be new or existing) */
    targetName: string;
    /** Whether target is a new category */
    isNew: boolean;
    /** Number of bookmarks affected */
    bookmarkCount: number;
    applied: boolean;
}

export interface SimplifyResult {
    merges: MergeSuggestion[];
    kept: string[];  // Categories to keep unchanged
}

/**
 * Run level-based simplification
 */
export async function runLevelSimplifyJob(
    db: Db,
    jobId: string,
    options: SimplifyJobOptions,
    config: SimplifyConfig,
): Promise<void> {
    const isCanceled = (): boolean => {
        const current = getJob(db, jobId);
        return !current || current.status === 'canceled';
    };

    const job = getJob(db, jobId);
    if (!job) throw new Error('job not found');
    if (job.status === 'canceled') return;

    const levelName = options.level === 1 ? '一级分类精简' : '二级分类精简';
    updateJob(db, jobId, { status: 'running', message: `正在获取${levelName}列表...` });
    if (isCanceled()) return;

    // Ensure table exists
    ensureLevelSimplifyTable(db);
    db.prepare('DELETE FROM ai_level_simplify_suggestions WHERE job_id = ?').run(jobId);
    if (isCanceled()) return;

    try {
        let result: SimplifyResult;

        if (options.level === 1) {
            result = await simplifyLevel1(db, config);
        } else {
            result = await simplifyLevel2(db, config, options.parentIds || []);
        }
        if (isCanceled()) return;

        // Save suggestions
        const now = new Date().toISOString();
        const insertStmt = db.prepare(`
      INSERT INTO ai_level_simplify_suggestions 
      (job_id, level, source_ids, source_names, target_name, is_new, bookmark_count, applied, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

        for (const merge of result.merges) {
            insertStmt.run(
                jobId,
                options.level,
                JSON.stringify(merge.sourceIds),
                JSON.stringify(merge.sourceNames),
                merge.targetName,
                merge.isNew ? 1 : 0,
                merge.bookmarkCount,
                now
            );
        }
        if (isCanceled()) return;

        // Auto-apply if enabled
        if (options.autoApply && result.merges.length > 0) {
            const applyResult = applyLevelMerges(db, result.merges, options.level);
            if (isCanceled()) return;
            updateJob(db, jobId, {
                status: applyResult.errors.length > 0 ? 'failed' : 'done',
                processed: result.merges.length,
                inserted: applyResult.applied,
                message: applyResult.errors.length > 0
                    ? `${levelName}失败: ${applyResult.errors[0]}`
                    : `${levelName}完成！合并了 ${applyResult.applied} 组分类`,
            });
        } else {
            updateJob(db, jobId, {
                status: 'done',
                processed: result.merges.length,
                inserted: result.merges.length,
                message: `${levelName}完成！获得 ${result.merges.length} 个合并建议`,
            });
        }
    } catch (error: any) {
        if (isCanceled()) return;
        updateJob(db, jobId, {
            status: 'failed',
            message: `${levelName}失败: ${error.message || '未知错误'}`,
        });
    }
}

/**
 * Simplify level-1 (top-level) categories
 */
async function simplifyLevel1(
    db: Db,
    config: SimplifyConfig,
): Promise<SimplifyResult> {
    const topCategories = getTopLevelCategories(db);

    if (topCategories.length === 0) {
        return { merges: [], kept: [] };
    }

    const categoryList = topCategories
        .map((c: { id: number; name: string; count: number }, idx: number) =>
            `${idx + 1}. ${c.name} (${c.count}条)`)
        .join('\n');

    const systemPrompt = `你是分类精简助手。请合并相似的一级分类。

当前一级分类:
${categoryList}

规则:
1. 合并语义相近的分类
2. 目标: 5-10个一级分类
3. 保留使用量高的分类名
4. 合并方式: 
   - A→B: "编程学习" 合并到 "技术开发"
   - A+B→C: "工具软件"+"效率工具" 合并为 "工具应用"

输出JSON格式:
{
  "merges": [
    {"sources": [2], "target": "技术开发", "is_new": false},
    {"sources": [3, 4], "target": "工具应用", "is_new": true}
  ],
  "keep": ["技术开发", "影音娱乐"]
}`;

    const result = await callAIForSimplify(config, systemPrompt, `请精简以上 ${topCategories.length} 个一级分类`);

    // Convert to MergeSuggestion format
    return convertToMerges(result, topCategories);
}

/**
 * Simplify level-2 categories within selected parents
 */
async function simplifyLevel2(
    db: Db,
    config: SimplifyConfig,
    parentIds: number[],
): Promise<SimplifyResult> {
    const allMerges: MergeSuggestion[] = [];
    const allKept: string[] = [];

    // Get all top-level categories if none specified
    if (parentIds.length === 0) {
        const topCategories = getTopLevelCategories(db);
        parentIds = topCategories.map((c: { id: number }) => c.id);
    }

    // Process each parent's sub-categories
    for (const parentId of parentIds) {
        const parent = getCategoryById(db, parentId);
        if (!parent) continue;

        const subCategories = getSubCategories(db, parentId);
        if (subCategories.length < 2) continue; // Need at least 2 to merge

        const categoryList = subCategories
            .map((c: { id: number; name: string; count: number }, idx: number) =>
                `${idx + 1}. ${c.name} (${c.count}条)`)
            .join('\n');

        const systemPrompt = `你是分类精简助手。请合并"${parent.name}"下相似的二级分类。

当前"${parent.name}"的二级分类:
${categoryList}

规则:
1. 合并语义相近的分类
2. 目标: 3-5个二级分类
3. 只输出二级分类名，不含一级

输出JSON格式:
{
  "merges": [
    {"sources": [1, 2], "target": "视频", "is_new": false}
  ],
  "keep": ["音乐", "游戏"]
}`;

        const result = await callAIForSimplify(config, systemPrompt, `请精简以上 ${subCategories.length} 个二级分类`);
        const { merges, kept } = convertToMerges(result, subCategories, parent.name);

        allMerges.push(...merges);
        allKept.push(...kept.map(k => `${parent.name}/${k}`));
    }

    return { merges: allMerges, kept: allKept };
}

/**
 * Call AI for simplification
 */
async function callAIForSimplify(
    config: SimplifyConfig,
    systemPrompt: string,
    userPrompt: string,
): Promise<any> {
    const openai = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl.replace(/\/+$/, ''),
        timeout: AI_REQUEST_TIMEOUT_MS,
    });

    const completion = await openai.chat.completions.create({
        model: config.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4000,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('AI 未返回有效响应');
    }

    // Parse JSON response
    const cleanedContent = content.trim()
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();

    try {
        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch { }

    return { merges: [], keep: [] };
}

/**
 * Convert AI response to MergeSuggestion format
 */
function convertToMerges(
    result: any,
    categories: Array<{ id: number; name: string; count: number }>,
    parentName?: string,
): { merges: MergeSuggestion[]; kept: string[] } {
    const merges: MergeSuggestion[] = [];
    const kept: string[] = result.keep || [];

    if (!result.merges || !Array.isArray(result.merges)) {
        return { merges, kept };
    }

    for (const m of result.merges) {
        const sources = (m.sources || []) as number[];
        const sourceIds: number[] = [];
        const sourceNames: string[] = [];
        let bookmarkCount = 0;

        for (const idx of sources) {
            const cat = categories[idx - 1]; // 1-indexed
            if (cat) {
                sourceIds.push(cat.id);
                sourceNames.push(parentName ? `${parentName}/${cat.name}` : cat.name);
                bookmarkCount += cat.count;
            }
        }

        if (sourceIds.length > 0 && m.target) {
            const targetName = parentName ? `${parentName}/${m.target}` : m.target;
            merges.push({
                sourceIds,
                sourceNames,
                targetName,
                isNew: m.is_new === true,
                bookmarkCount,
                applied: false,
            });
        }
    }

    return { merges, kept };
}

/**
 * Apply merge suggestions with failure-stops-all logic
 */
export function applyLevelMerges(
    db: Db,
    merges: MergeSuggestion[],
    level: 1 | 2,
): { applied: number; errors: string[] } {
    let applied = 0;
    const errors: string[] = [];

    for (const merge of merges) {
        // Validate all source categories still exist
        for (let i = 0; i < merge.sourceIds.length; i++) {
            const sourceId = merge.sourceIds[i];
            const cat = getCategoryById(db, sourceId);
            if (!cat) {
                errors.push(`源分类"${merge.sourceNames[i]}"已不存在`);
                return { applied, errors }; // Stop immediately
            }
            if (cat.name !== merge.sourceNames[i].split('/').pop()) {
                errors.push(`源分类"${merge.sourceNames[i]}"已被重命名`);
                return { applied, errors };
            }
        }

        // Get or create target category
        let targetId: number;
        try {
            targetId = getOrCreateCategoryByPath(db, merge.targetName);
        } catch (e: any) {
            errors.push(`无法创建目标分类"${merge.targetName}": ${e.message}`);
            return { applied, errors };
        }

        // Apply merge based on level
        try {
            if (level === 1) {
                // Level-1: Move all sub-categories to target, then move bookmarks
                for (const sourceId of merge.sourceIds) {
                    // Move sub-categories
                    db.prepare('UPDATE categories SET parent_id = ? WHERE parent_id = ?').run(targetId, sourceId);
                    // Move direct bookmarks
                    db.prepare('UPDATE bookmarks SET category_id = ? WHERE category_id = ?').run(targetId, sourceId);
                    // Delete source category
                    db.prepare('DELETE FROM categories WHERE id = ?').run(sourceId);
                }
            } else {
                // Level-2: Just move bookmarks
                for (const sourceId of merge.sourceIds) {
                    db.prepare('UPDATE bookmarks SET category_id = ? WHERE category_id = ?').run(targetId, sourceId);
                    db.prepare('DELETE FROM categories WHERE id = ?').run(sourceId);
                }
            }
            applied++;
        } catch (e: any) {
            errors.push(`合并失败: ${e.message}`);
            return { applied, errors };
        }
    }

    return { applied, errors };
}

/**
 * Ensure suggestion table exists
 */
function ensureLevelSimplifyTable(db: Db): void {
    db.exec(`
    CREATE TABLE IF NOT EXISTS ai_level_simplify_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      source_ids TEXT NOT NULL,
      source_names TEXT NOT NULL,
      target_name TEXT NOT NULL,
      is_new INTEGER NOT NULL DEFAULT 0,
      bookmark_count INTEGER NOT NULL DEFAULT 0,
      applied INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_level_simplify_job ON ai_level_simplify_suggestions(job_id);
  `);
}
