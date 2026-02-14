import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, seedCategory, seedBookmarks } from './helpers/db.ts';
import type { Db } from '../src/db';
import {
    createTopCategory,
    createSubCategory,
    getCategoryTree,
    getCategoryById,
    getOrCreateCategoryByPath,
    getFlatCategories,
    renameCategory,
    deleteCategory,
    getAllCategories,
    getTopLevelCategories,
    getSubCategories,
    getCategoryFullPath,
} from '../src/category-service';

describe('Category Service', () => {
    let db: Db;
    let cleanup: () => void;

    beforeEach(() => {
        const ctx = createTestDb();
        db = ctx.db;
        cleanup = ctx.cleanup;
    });

    afterEach(() => cleanup());

    describe('createTopCategory', () => {
        it('should create a top-level category', () => {
            const id = createTopCategory(db, '技术');
            expect(id).toBeGreaterThan(0);

            const cat = getCategoryById(db, id);
            expect(cat).not.toBeNull();
            expect(cat!.name).toBe('技术');
            expect(cat!.parent_id).toBeNull();
        });

        it('should support icon and color options', () => {
            const id = createTopCategory(db, '生活', { icon: '🏠', color: '#ff0000' });
            const cat = getCategoryById(db, id);
            expect(cat!.icon).toBe('🏠');
            expect(cat!.color).toBe('#ff0000');
        });
    });

    describe('createSubCategory', () => {
        it('should create a sub-category under a parent', () => {
            const parentId = createTopCategory(db, '技术');
            const childId = createSubCategory(db, '编程', parentId);

            const child = getCategoryById(db, childId);
            expect(child).not.toBeNull();
            expect(child!.name).toBe('技术/编程');
            expect(child!.parent_id).toBe(parentId);
        });
    });

    describe('getCategoryTree', () => {
        it('should return empty array for empty DB', () => {
            const tree = getCategoryTree(db);
            expect(tree).toEqual([]);
        });

        it('should return tree with nested children', () => {
            const techId = createTopCategory(db, '技术');
            createSubCategory(db, '编程', techId);
            createSubCategory(db, '运维', techId);
            createTopCategory(db, '生活');

            const tree = getCategoryTree(db);
            expect(tree).toHaveLength(2); // 技术, 生活

            const tech = tree.find((n) => n.name === '技术');
            expect(tech).toBeDefined();
            expect(tech!.children).toHaveLength(2);

            const life = tree.find((n) => n.name === '生活');
            expect(life).toBeDefined();
            expect(life!.children).toHaveLength(0);
        });
    });

    describe('getOrCreateCategoryByPath', () => {
        it('should create top-level category from simple path', () => {
            const id = getOrCreateCategoryByPath(db, '技术');
            expect(id).toBeGreaterThan(0);

            const cat = getCategoryById(db, id);
            expect(cat!.name).toBe('技术');
            expect(cat!.parent_id).toBeNull();
        });

        it('should create both levels from path like "技术/编程"', () => {
            const id = getOrCreateCategoryByPath(db, '技术/编程');
            const child = getCategoryById(db, id);
            // Implementation stores sub-category name as full path "技术/编程"
            expect(child!.name).toBe('技术/编程');
            expect(child!.parent_id).not.toBeNull();

            const parent = getCategoryById(db, child!.parent_id!);
            expect(parent!.name).toBe('技术');
        });

        it('should reuse existing category when called twice', () => {
            const id1 = getOrCreateCategoryByPath(db, '技术/编程');
            const id2 = getOrCreateCategoryByPath(db, '技术/编程');
            expect(id1).toBe(id2);
        });

        it('should create different children under same parent', () => {
            const id1 = getOrCreateCategoryByPath(db, '技术/编程');
            const id2 = getOrCreateCategoryByPath(db, '技术/运维');
            expect(id1).not.toBe(id2);

            const c1 = getCategoryById(db, id1);
            const c2 = getCategoryById(db, id2);
            expect(c1!.parent_id).toBe(c2!.parent_id);
        });
    });

    describe('getFlatCategories', () => {
        it('should return flat list with fullPath', () => {
            const techId = createTopCategory(db, '技术');
            createSubCategory(db, '编程', techId);

            const flat = getFlatCategories(db);
            expect(flat.length).toBeGreaterThanOrEqual(2);

            const prog = flat.find((c) => c.fullPath === '技术/编程');
            expect(prog).toBeDefined();
            expect(prog!.name).toBe('技术/编程');
            expect(prog!.level).toBe(1);
        });
    });

    describe('getCategoryFullPath', () => {
        it('should return simple name for top-level', () => {
            const id = createTopCategory(db, '生活');
            const path = getCategoryFullPath(db, id);
            expect(path).toBe('生活');
        });

        it('should return parent/child for sub-category', () => {
            const parentId = createTopCategory(db, '技术');
            const childId = createSubCategory(db, '编程', parentId);
            const path = getCategoryFullPath(db, childId);
            expect(path).toBe('技术/编程');
        });
    });

    describe('renameCategory', () => {
        it('should rename a category', () => {
            const id = createTopCategory(db, 'OldName');
            renameCategory(db, id, 'NewName');

            const cat = getCategoryById(db, id);
            expect(cat!.name).toBe('NewName');
        });
    });

    describe('deleteCategory', () => {
        it('should delete a category and unlink bookmarks', () => {
            const catId = createTopCategory(db, 'ToDelete');
            seedBookmarks(db, [
                { url: 'https://a.com', title: 'A', categoryId: catId },
                { url: 'https://b.com', title: 'B', categoryId: catId },
            ]);

            const result = deleteCategory(db, catId);
            expect(result.movedBookmarks).toBe(2);

            const cat = getCategoryById(db, catId);
            expect(cat).toBeNull();

            // Bookmarks should have category_id = null
            const rows = db.prepare('SELECT category_id FROM bookmarks').all() as Array<{ category_id: number | null }>;
            for (const row of rows) {
                expect(row.category_id).toBeNull();
            }
        });

        it('should also delete child categories when deleting parent', () => {
            const parentId = createTopCategory(db, 'Parent');
            const childId = createSubCategory(db, 'Child', parentId);

            deleteCategory(db, parentId);

            expect(getCategoryById(db, parentId)).toBeNull();
            expect(getCategoryById(db, childId)).toBeNull();
        });
    });

    describe('getTopLevelCategories / getSubCategories', () => {
        it('should separate top-level and sub-categories', () => {
            const techId = createTopCategory(db, '技术');
            createSubCategory(db, '编程', techId);
            createTopCategory(db, '生活');

            const topLevel = getTopLevelCategories(db);
            expect(topLevel).toHaveLength(2);

            const subs = getSubCategories(db, techId);
            expect(subs).toHaveLength(1);
            expect(subs[0].name).toBe('技术/编程');
        });
    });
});
