/**
 * Level-based AI Classification Module
 * 
 * Provides level-1 (top-level) and level-2 (sub-category) classification
 * with specific prompts and logic for each level.
 */
import OpenAI from 'openai';
import type { Db } from './db';
import { getOrCreateCategoryByPath, getCategoryById, getTopLevelCategories, getSubCategories } from './category-service';

const AI_REQUEST_TIMEOUT_MS = 60000;

export interface LevelClassifyConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface BookmarkForLevelClassify {
    id: number;
    url: string;
    title: string;
    currentCategoryId: number | null;
    currentCategoryPath: string | null;
}

export interface LevelClassificationResult {
    bookmarkId: number;
    suggestedCategory: string;
    isNew: boolean;
    skipped: boolean;
    skipReason?: string;
}

export interface LevelClassifyBatchResult {
    results: LevelClassificationResult[];
    skippedCount: number;
}

/**
 * Classify bookmarks at level-1 (top-level categories)
 */
export async function classifyLevel1(
    db: Db,
    config: LevelClassifyConfig,
    bookmarks: BookmarkForLevelClassify[],
): Promise<LevelClassifyBatchResult> {
    const results: LevelClassificationResult[] = [];

    if (bookmarks.length === 0) {
        return { results, skippedCount: 0 };
    }

    // Get existing top-level categories
    const existingTopCategories = getTopLevelCategories(db);
    const existingNames = existingTopCategories.map((c: { name: string }) => c.name);

    // Build prompt
    const bookmarkList = bookmarks
        .map((b, idx) => `${idx + 1}. ${b.title} | ${b.url}`)
        .join('\n');

    const existingNamesHint = existingNames.length > 0
        ? existingNames.map((n: string, i: number) => `${i + 1}. ${n}`).join('\n')
        : '(暂无)';

    const systemPrompt = `你是书签分类助手。请将以下书签分配到最合适的一级分类。

现有一级分类:
${existingNamesHint}

规则:
1. 优先使用现有分类
2. 如无合适分类，可新建（名称简洁）
3. 一个书签只能属于一个一级分类
4. 只输出一级分类名称，不要输出二级

输出JSON格式:
{
  "assignments": [
    {"bookmark_id": 1, "category": "分类名", "is_new": false},
    {"bookmark_id": 2, "category": "新分类", "is_new": true}
  ]
}`;

    const userPrompt = `待分类书签:\n${bookmarkList}`;

    try {
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
            temperature: 0.3,
            max_tokens: 2000,
        });

        const content = completion.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('AI 未返回有效响应');
        }

        const parsed = parseAIResponse(content);

        for (const item of parsed) {
            const idx = item.bookmark_id - 1;
            if (idx >= 0 && idx < bookmarks.length && item.category) {
                results.push({
                    bookmarkId: bookmarks[idx].id,
                    suggestedCategory: item.category.trim(),
                    isNew: item.is_new || !existingNames.includes(item.category.trim()),
                    skipped: false,
                });
            }
        }
    } catch (error: any) {
        console.error('[Level1 Classify] AI error:', error.message);
    }

    return { results, skippedCount: 0 };
}

/**
 * Classify bookmarks at level-2 (sub-categories within a parent)
 */
export async function classifyLevel2(
    db: Db,
    config: LevelClassifyConfig,
    bookmarks: BookmarkForLevelClassify[],
): Promise<LevelClassifyBatchResult> {
    const results: LevelClassificationResult[] = [];
    let skippedCount = 0;

    // Group bookmarks by their level-1 category
    const groupedByParent = new Map<string, BookmarkForLevelClassify[]>();

    for (const bookmark of bookmarks) {
        if (!bookmark.currentCategoryId) {
            results.push({
                bookmarkId: bookmark.id,
                suggestedCategory: '',
                isNew: false,
                skipped: true,
                skipReason: '无一级分类，请先进行一级分类',
            });
            skippedCount++;
            continue;
        }

        const category = getCategoryById(db, bookmark.currentCategoryId);
        if (!category) {
            results.push({
                bookmarkId: bookmark.id,
                suggestedCategory: '',
                isNew: false,
                skipped: true,
                skipReason: '分类不存在',
            });
            skippedCount++;
            continue;
        }

        let parentName: string;
        if (category.parent_id === null) {
            parentName = category.name;
        } else {
            const parentCategory = getCategoryById(db, category.parent_id);
            parentName = parentCategory?.name || category.name;
        }

        if (!groupedByParent.has(parentName)) {
            groupedByParent.set(parentName, []);
        }
        groupedByParent.get(parentName)!.push(bookmark);
    }

    for (const [parentName, groupBookmarks] of groupedByParent) {
        const groupResults = await classifyLevel2Group(db, config, parentName, groupBookmarks);
        results.push(...groupResults);
    }

    return { results, skippedCount };
}

async function classifyLevel2Group(
    db: Db,
    config: LevelClassifyConfig,
    parentName: string,
    bookmarks: BookmarkForLevelClassify[],
): Promise<LevelClassificationResult[]> {
    const results: LevelClassificationResult[] = [];

    if (bookmarks.length === 0) return results;

    const topCategories = getTopLevelCategories(db);
    const parentCategory = topCategories.find((c: { id: number; name: string }) => c.name === parentName);
    if (!parentCategory) {
        return bookmarks.map((b) => ({
            bookmarkId: b.id,
            suggestedCategory: '',
            isNew: false,
            skipped: true,
            skipReason: `一级分类"${parentName}"不存在`,
        }));
    }

    const existingSubCategories = getSubCategories(db, parentCategory.id);
    const existingSubNames = existingSubCategories.map((c: { name: string }) => c.name);

    const bookmarkList = bookmarks
        .map((b, idx) => `${idx + 1}. ${b.title} | ${b.url}`)
        .join('\n');

    const subNamesHint = existingSubNames.length > 0
        ? existingSubNames.map((n: string, i: number) => `${i + 1}. ${n}`).join('\n')
        : '(暂无)';

    const systemPrompt = `你是书签分类助手。请在"${parentName}"分类内细分以下书签。

已有二级分类:
${subNamesHint}

规则:
1. 优先使用已有二级分类
2. 如无合适，可新建（名称简洁）
3. 只输出二级分类名称，不含一级

输出JSON格式:
{
  "parent": "${parentName}",
  "assignments": [
    {"bookmark_id": 1, "category": "子分类名", "is_new": false}
  ]
}`;

    const userPrompt = `待分类书签（均属于"${parentName}"）:\n${bookmarkList}`;

    try {
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
            temperature: 0.3,
            max_tokens: 2000,
        });

        const content = completion.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('AI 未返回有效响应');
        }

        const parsed = parseAIResponse(content);

        for (const item of parsed) {
            const idx = item.bookmark_id - 1;
            if (idx >= 0 && idx < bookmarks.length && item.category) {
                const subName = item.category.trim();
                results.push({
                    bookmarkId: bookmarks[idx].id,
                    suggestedCategory: `${parentName}/${subName}`,
                    isNew: item.is_new || !existingSubNames.includes(subName),
                    skipped: false,
                });
            }
        }
    } catch (error: any) {
        console.error(`[Level2 Classify] AI error for ${parentName}:`, error.message);
    }

    return results;
}

function parseAIResponse(content: string): Array<{ bookmark_id: number; category: string; is_new?: boolean }> {
    const cleanedContent = content.trim()
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();

    try {
        const parsed = JSON.parse(cleanedContent);
        if (parsed.assignments && Array.isArray(parsed.assignments)) {
            return parsed.assignments.map((a: any) => ({
                bookmark_id: typeof a.bookmark_id === 'number' ? a.bookmark_id : parseInt(a.bookmark_id || a.index),
                category: a.category,
                is_new: a.is_new,
            }));
        }
        if (Array.isArray(parsed)) {
            return parsed.map((a: any) => ({
                bookmark_id: typeof a.bookmark_id === 'number' ? a.bookmark_id : parseInt(a.bookmark_id || a.index),
                category: a.category,
                is_new: a.is_new,
            }));
        }
    } catch { }

    const jsonMatch = cleanedContent.match(/\{[\s\S]*"assignments"\s*:\s*\[[\s\S]*\]\s*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.assignments) {
                return parsed.assignments.map((a: any) => ({
                    bookmark_id: parseInt(a.bookmark_id || a.index),
                    category: a.category,
                    is_new: a.is_new,
                }));
            }
        } catch { }
    }

    const arrayMatch = cleanedContent.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            const arr = JSON.parse(arrayMatch[0]);
            return arr.map((a: any) => ({
                bookmark_id: parseInt(a.bookmark_id || a.index),
                category: a.category,
                is_new: a.is_new,
            }));
        } catch { }
    }

    return [];
}

/**
 * Apply level-1 classification results (handles group move)
 */
export function applyLevel1Results(
    db: Db,
    results: LevelClassificationResult[],
): { applied: number; errors: string[] } {
    let applied = 0;
    const errors: string[] = [];

    for (const result of results) {
        if (result.skipped) continue;

        try {
            const categoryId = getOrCreateCategoryByPath(db, result.suggestedCategory);
            if (!categoryId) {
                errors.push(`无法创建分类: ${result.suggestedCategory}`);
                continue;
            }

            const bookmark = db.prepare('SELECT id, category_id FROM bookmarks WHERE id = ?').get(result.bookmarkId) as any;
            if (!bookmark) {
                errors.push(`书签不存在: ${result.bookmarkId}`);
                continue;
            }

            if (bookmark.category_id) {
                const currentCategory = getCategoryById(db, bookmark.category_id);
                if (currentCategory && currentCategory.parent_id !== null) {
                    // Group move: move the level-2 category to new parent
                    db.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(categoryId, bookmark.category_id);
                    applied++;
                    continue;
                }
            }

            db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?').run(categoryId, result.bookmarkId);
            applied++;
        } catch (error: any) {
            errors.push(`应用失败 (${result.bookmarkId}): ${error.message}`);
        }
    }

    return { applied, errors };
}

/**
 * Apply level-2 classification results
 */
export function applyLevel2Results(
    db: Db,
    results: LevelClassificationResult[],
): { applied: number; errors: string[] } {
    let applied = 0;
    const errors: string[] = [];

    for (const result of results) {
        if (result.skipped) continue;

        try {
            const categoryId = getOrCreateCategoryByPath(db, result.suggestedCategory);
            if (!categoryId) {
                errors.push(`无法创建分类: ${result.suggestedCategory}`);
                continue;
            }

            db.prepare('UPDATE bookmarks SET category_id = ? WHERE id = ?').run(categoryId, result.bookmarkId);
            applied++;
        } catch (error: any) {
            errors.push(`应用失败 (${result.bookmarkId}): ${error.message}`);
        }
    }

    return { applied, errors };
}
