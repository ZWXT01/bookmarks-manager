import { test, expect } from '@playwright/test';

test.describe('Bookmarks', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('登录与初始化：跳转首页、分类树加载、默认分页', async ({ page }) => {
        await expect(page).toHaveTitle(/书签管理器/);

        // 分类树加载
        await expect(page.getByTestId('category-nav-all-tab')).toBeVisible();
        await expect(page.getByTestId('category-nav-uncategorized-tab')).toBeVisible();

        // 默认分页
        await expect(page.getByText(/第 1\//)).toBeVisible();
    });

    test('书签 CRUD 渲染：新增、编辑、删除后列表与计数同步刷新', async ({ page }) => {
        const uniqueUrl = `https://e2e-${Date.now()}.com/`;
        const testTitle = `Test Bookmark ${Date.now()}`;
        const newTitle = `Edited ${Date.now()}`;

        // Add
        await page.getByTestId('open-add-bookmark').click();
        const addModal = page.getByTestId('add-bookmark-modal');
        await expect(addModal).toBeVisible();
        await addModal.getByTestId('add-bookmark-url-input').fill(uniqueUrl);
        await addModal.getByTestId('add-bookmark-title-input').fill(testTitle);

        const addPromise = page.waitForResponse(res => res.url().includes('/api/bookmarks') && res.request().method() === 'POST');
        await addModal.getByTestId('add-bookmark-submit').click();
        await addPromise;

        // Wait for the UI to update
        const bookmarkRow = page.getByTestId('bookmark-row').filter({ hasText: uniqueUrl }).first();
        await expect(bookmarkRow).toBeVisible();
        const bookmarkId = await bookmarkRow.getAttribute('data-bookmark-id');
        expect(bookmarkId).toBeTruthy();

        // Edit
        await bookmarkRow.getByTestId('bookmark-actions-button').click();
        await bookmarkRow.getByTestId('bookmark-row-edit-button').click();

        const editModal = page.getByTestId('edit-bookmark-modal');
        await expect(editModal).toBeVisible();
        await editModal.getByTestId('edit-bookmark-title-input').fill(newTitle);

        const editPromise = page.waitForResponse(res =>
            res.request().method() === 'POST' && res.url().endsWith(`/api/bookmarks/${bookmarkId}/update`));
        await editModal.getByTestId('edit-bookmark-save').click();
        await editPromise;

        // Verify edit
        const editedRow = page.getByTestId('bookmark-row').filter({ hasText: newTitle }).first();
        await expect(editedRow).toBeVisible();

        // Delete
        await editedRow.getByTestId('bookmark-actions-button').click();
        await editedRow.getByTestId('bookmark-row-delete-button').click();
        await expect(page.getByTestId('app-dialog')).toBeVisible();

        const deletePromise = page.waitForResponse(res =>
            res.request().method() === 'POST' && res.url().endsWith(`/bookmarks/${bookmarkId}/delete`));
        await page.getByTestId('app-dialog-confirm').click();
        await deletePromise;

        // Verify deletion by checking the specific row disappears
        await expect(page.locator(`[data-testid="bookmark-row"][data-bookmark-id="${bookmarkId}"]`)).toHaveCount(0);
    });

    test('表格/卡片视图切换', async ({ page }) => {
        const viewToggleBtn = page.getByTestId('bookmark-view-toggle');
        const btnText = await viewToggleBtn.textContent() || '';

        if (btnText.includes('卡片')) {
            // Currently in table mode
            await expect(page.locator('table')).toBeVisible();
            await viewToggleBtn.click();
            await expect(page.locator('table')).toBeHidden();
        } else {
            // Currently in card mode
            await expect(page.locator('table')).toBeHidden();
            await viewToggleBtn.click();
            await expect(page.locator('table')).toBeVisible();
        }
    });

    test('分页功能', async ({ page }) => {
        const nextBtn = page.locator('button', { hasText: '下一页' });
        await expect(nextBtn).toBeVisible();
        
        const prevBtn = page.locator('button', { hasText: '上一页' });
        await expect(prevBtn).toBeVisible();
    });
});
