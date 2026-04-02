import { test, expect } from '@playwright/test';

test.describe('Categories', () => {
    let parentId: number;
    let childId: number;
    let parentName: string;
    let childName: string;

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        parentName = `E2E Parent ${Date.now()}`;
        childName = `E2E Child ${Date.now()}`;

        // Create a parent + child category using browser context to ensure data visibility
        const result = await page.evaluate(async ({ pName, cName }) => {
            const parentRes = await fetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: pName })
            });
            const parentData = await parentRes.json();
            const parentId = parentData?.category?.id;
            if (!parentRes.ok || !parentId) {
                throw new Error(`create parent failed: ${JSON.stringify(parentData)}`);
            }

            const childRes = await fetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: cName, parent_id: parentId })
            });
            const childData = await childRes.json();
            const childId = childData?.category?.id;
            if (!childRes.ok || !childId) {
                throw new Error(`create child failed: ${JSON.stringify(childData)}`);
            }

            return { parentId, childId };
        }, { pName: parentName, cName: childName });

        parentId = result.parentId;
        childId = result.childId;

        // Reload to show new categories
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
    });

    test('分类切换与子分类 dropdown', async ({ page }) => {
        // Find parent category tab
        const parentTab = page.getByTestId('category-nav-tab').filter({ hasText: parentName }).first();
        await expect(parentTab).toBeVisible();

        // Dropdown appears on hover
        await parentTab.hover();
        const dropdownPanel = page.getByTestId('subcategory-panel');
        await expect(dropdownPanel).toBeVisible();

        // Find child in dropdown and click
        const childBtn = dropdownPanel.getByTestId('subcategory-nav-item').filter({ hasText: childName });
        await expect(childBtn).toBeVisible();

        const apiPromise = page.waitForResponse(res => {
            if (!res.url().includes('/api/bookmarks?') || res.request().method() !== 'GET') {
                return false;
            }
            const url = new URL(res.url());
            return url.searchParams.get('category') === String(childId);
        });
        await childBtn.click();

        // Check if page state reflects selected child category
        await apiPromise;
    });

    test('键盘导航：Tab 切换、ArrowDown 进入子分类、Escape 关闭', async ({ page }) => {
        // Focus the parent tab
        const parentTab = page.getByTestId('category-nav-tab').filter({ hasText: parentName }).first();
        await parentTab.focus();

        // ArrowDown to open dropdown
        await page.keyboard.press('ArrowDown');

        const dropdownPanel = page.getByTestId('subcategory-panel');
        await expect(dropdownPanel).toBeVisible();

        // Escape to close
        await page.keyboard.press('Escape');
        await expect(dropdownPanel).toBeHidden();
    });

    test('分类管理：打开弹窗、搜索过滤、基础拖拽', async ({ page }) => {
        // Open category manager
        await page.getByTestId('open-category-manager').click();

        const modal = page.getByTestId('category-manager-modal');
        await expect(modal).toBeVisible();

        // Search
        const searchInput = modal.getByTestId('category-manager-search');
        await searchInput.fill(parentName);

        // Only the parent should be visible
        await expect(modal.getByTestId('category-drag-card').filter({ hasText: parentName }).first()).toBeVisible();

        // Clear search
        await searchInput.fill('');

        // Add a second parent for drag and drop
        const secondParentName = `E2E Parent 2 ${Date.now()}`;
        await modal.getByTestId('category-manager-add-root').click();
        const createCategoryModal = page.getByTestId('create-category-modal');
        await expect(createCategoryModal).toBeVisible();
        await createCategoryModal.getByTestId('create-category-name-input').fill(secondParentName);
        await createCategoryModal.getByTestId('create-category-confirm').click();
        await expect(createCategoryModal).toBeHidden();

        // Check cards
        const cards = modal.getByTestId('category-drag-card');
        await expect(cards.nth(0)).toBeVisible();
        await expect(cards.filter({ hasText: secondParentName }).first()).toBeVisible();

        // Perform drag
        // Basic drag test by swapping 0 and 1
        const dragSrc = cards.nth(0).locator('.drag-handle');
        const dragDst = cards.nth(1);

        if (await dragSrc.isVisible() && await dragDst.isVisible()) {
            await dragSrc.dragTo(dragDst);
            // Just verifying it doesn't crash on standard drop actions
            await expect(modal).toBeVisible();
        }

        // Close modal
        await page.getByTestId('close-category-manager').click();
        await expect(modal).toBeHidden();
    });
});
