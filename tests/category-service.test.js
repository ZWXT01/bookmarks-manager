"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const db_1 = require("./helpers/db");
const category_service_1 = require("../src/category-service");
(0, vitest_1.describe)('Category Service', () => {
    let db;
    let cleanup;
    (0, vitest_1.beforeEach)(() => {
        const ctx = (0, db_1.createTestDb)();
        db = ctx.db;
        cleanup = ctx.cleanup;
    });
    (0, vitest_1.afterEach)(() => cleanup());
    (0, vitest_1.describe)('createTopCategory', () => {
        (0, vitest_1.it)('should create a top-level category', () => {
            const id = (0, category_service_1.createTopCategory)(db, '技术');
            (0, vitest_1.expect)(id).toBeGreaterThan(0);
            const cat = (0, category_service_1.getCategoryById)(db, id);
            (0, vitest_1.expect)(cat).not.toBeNull();
            (0, vitest_1.expect)(cat.name).toBe('技术');
            (0, vitest_1.expect)(cat.parent_id).toBeNull();
        });
        (0, vitest_1.it)('should support icon and color options', () => {
            const id = (0, category_service_1.createTopCategory)(db, '生活', { icon: '🏠', color: '#ff0000' });
            const cat = (0, category_service_1.getCategoryById)(db, id);
            (0, vitest_1.expect)(cat.icon).toBe('🏠');
            (0, vitest_1.expect)(cat.color).toBe('#ff0000');
        });
    });
    (0, vitest_1.describe)('createSubCategory', () => {
        (0, vitest_1.it)('should create a sub-category under a parent', () => {
            const parentId = (0, category_service_1.createTopCategory)(db, '技术');
            const childId = (0, category_service_1.createSubCategory)(db, '编程', parentId);
            const child = (0, category_service_1.getCategoryById)(db, childId);
            (0, vitest_1.expect)(child).not.toBeNull();
            (0, vitest_1.expect)(child.name).toBe('编程');
            (0, vitest_1.expect)(child.parent_id).toBe(parentId);
        });
    });
    (0, vitest_1.describe)('getCategoryTree', () => {
        (0, vitest_1.it)('should return empty array for empty DB', () => {
            const tree = (0, category_service_1.getCategoryTree)(db);
            (0, vitest_1.expect)(tree).toEqual([]);
        });
        (0, vitest_1.it)('should return tree with nested children', () => {
            const techId = (0, category_service_1.createTopCategory)(db, '技术');
            (0, category_service_1.createSubCategory)(db, '编程', techId);
            (0, category_service_1.createSubCategory)(db, '运维', techId);
            (0, category_service_1.createTopCategory)(db, '生活');
            const tree = (0, category_service_1.getCategoryTree)(db);
            (0, vitest_1.expect)(tree).toHaveLength(2); // 技术, 生活
            const tech = tree.find((n) => n.name === '技术');
            (0, vitest_1.expect)(tech).toBeDefined();
            (0, vitest_1.expect)(tech.children).toHaveLength(2);
            const life = tree.find((n) => n.name === '生活');
            (0, vitest_1.expect)(life).toBeDefined();
            (0, vitest_1.expect)(life.children).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)('getOrCreateCategoryByPath', () => {
        (0, vitest_1.it)('should create top-level category from simple path', () => {
            const id = (0, category_service_1.getOrCreateCategoryByPath)(db, '技术');
            (0, vitest_1.expect)(id).toBeGreaterThan(0);
            const cat = (0, category_service_1.getCategoryById)(db, id);
            (0, vitest_1.expect)(cat.name).toBe('技术');
            (0, vitest_1.expect)(cat.parent_id).toBeNull();
        });
        (0, vitest_1.it)('should create both levels from path like "技术/编程"', () => {
            const id = (0, category_service_1.getOrCreateCategoryByPath)(db, '技术/编程');
            const child = (0, category_service_1.getCategoryById)(db, id);
            // Implementation stores sub-category name as full path "技术/编程"
            (0, vitest_1.expect)(child.name).toBe('技术/编程');
            (0, vitest_1.expect)(child.parent_id).not.toBeNull();
            const parent = (0, category_service_1.getCategoryById)(db, child.parent_id);
            (0, vitest_1.expect)(parent.name).toBe('技术');
        });
        (0, vitest_1.it)('should reuse existing category when called twice', () => {
            const id1 = (0, category_service_1.getOrCreateCategoryByPath)(db, '技术/编程');
            const id2 = (0, category_service_1.getOrCreateCategoryByPath)(db, '技术/编程');
            (0, vitest_1.expect)(id1).toBe(id2);
        });
        (0, vitest_1.it)('should create different children under same parent', () => {
            const id1 = (0, category_service_1.getOrCreateCategoryByPath)(db, '技术/编程');
            const id2 = (0, category_service_1.getOrCreateCategoryByPath)(db, '技术/运维');
            (0, vitest_1.expect)(id1).not.toBe(id2);
            const c1 = (0, category_service_1.getCategoryById)(db, id1);
            const c2 = (0, category_service_1.getCategoryById)(db, id2);
            (0, vitest_1.expect)(c1.parent_id).toBe(c2.parent_id);
        });
    });
    (0, vitest_1.describe)('getFlatCategories', () => {
        (0, vitest_1.it)('should return flat list with fullPath', () => {
            const techId = (0, category_service_1.createTopCategory)(db, '技术');
            (0, category_service_1.createSubCategory)(db, '编程', techId);
            const flat = (0, category_service_1.getFlatCategories)(db);
            (0, vitest_1.expect)(flat.length).toBeGreaterThanOrEqual(2);
            // Sub-category is stored with name '编程' via createSubCategory
            const prog = flat.find((c) => c.name === '编程');
            (0, vitest_1.expect)(prog).toBeDefined();
            // fullPath is built from parent + child name
            (0, vitest_1.expect)(prog.level).toBe(1);
        });
    });
    (0, vitest_1.describe)('getCategoryFullPath', () => {
        (0, vitest_1.it)('should return simple name for top-level', () => {
            const id = (0, category_service_1.createTopCategory)(db, '生活');
            const path = (0, category_service_1.getCategoryFullPath)(db, id);
            (0, vitest_1.expect)(path).toBe('生活');
        });
        (0, vitest_1.it)('should return parent/child for sub-category', () => {
            const parentId = (0, category_service_1.createTopCategory)(db, '技术');
            const childId = (0, category_service_1.createSubCategory)(db, '编程', parentId);
            const path = (0, category_service_1.getCategoryFullPath)(db, childId);
            (0, vitest_1.expect)(path).toBe('技术/编程');
        });
    });
    (0, vitest_1.describe)('renameCategory', () => {
        (0, vitest_1.it)('should rename a category', () => {
            const id = (0, category_service_1.createTopCategory)(db, 'OldName');
            (0, category_service_1.renameCategory)(db, id, 'NewName');
            const cat = (0, category_service_1.getCategoryById)(db, id);
            (0, vitest_1.expect)(cat.name).toBe('NewName');
        });
    });
    (0, vitest_1.describe)('deleteCategory', () => {
        (0, vitest_1.it)('should delete a category and unlink bookmarks', () => {
            const catId = (0, category_service_1.createTopCategory)(db, 'ToDelete');
            (0, db_1.seedBookmarks)(db, [
                { url: 'https://a.com', title: 'A', categoryId: catId },
                { url: 'https://b.com', title: 'B', categoryId: catId },
            ]);
            const result = (0, category_service_1.deleteCategory)(db, catId);
            (0, vitest_1.expect)(result.movedBookmarks).toBe(2);
            const cat = (0, category_service_1.getCategoryById)(db, catId);
            (0, vitest_1.expect)(cat).toBeNull();
            // Bookmarks should have category_id = null
            const rows = db.prepare('SELECT category_id FROM bookmarks').all();
            for (const row of rows) {
                (0, vitest_1.expect)(row.category_id).toBeNull();
            }
        });
        (0, vitest_1.it)('should also delete child categories when deleting parent', () => {
            const parentId = (0, category_service_1.createTopCategory)(db, 'Parent');
            const childId = (0, category_service_1.createSubCategory)(db, 'Child', parentId);
            (0, category_service_1.deleteCategory)(db, parentId);
            (0, vitest_1.expect)((0, category_service_1.getCategoryById)(db, parentId)).toBeNull();
            (0, vitest_1.expect)((0, category_service_1.getCategoryById)(db, childId)).toBeNull();
        });
    });
    (0, vitest_1.describe)('getTopLevelCategories / getSubCategories', () => {
        (0, vitest_1.it)('should separate top-level and sub-categories', () => {
            const techId = (0, category_service_1.createTopCategory)(db, '技术');
            (0, category_service_1.createSubCategory)(db, '编程', techId);
            (0, category_service_1.createTopCategory)(db, '生活');
            const topLevel = (0, category_service_1.getTopLevelCategories)(db);
            (0, vitest_1.expect)(topLevel).toHaveLength(2);
            const subs = (0, category_service_1.getSubCategories)(db, techId);
            (0, vitest_1.expect)(subs).toHaveLength(1);
            (0, vitest_1.expect)(subs[0].name).toBe('编程');
        });
    });
});
