import { test, expect } from '@playwright/test';

test.describe('Search and Shortcuts', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('搜索防抖：连续输入只触发一次请求', async ({ page }) => {
        // Track API calls
        let apiCallCount = 0;
        await page.route('**/api/bookmarks*', async (route) => {
            if (route.request().method() === 'GET') {
                apiCallCount++;
            }
            await route.continue();
        });
        
        // Reset counter
        apiCallCount = 0;

        // Type fast
        await page.evaluate(() => {
            const input = document.querySelector('[data-testid="bookmark-search-input"]');
            if (!(input instanceof HTMLInputElement)) {
                throw new Error('bookmark search input not found');
            }

            input.value = 'fast';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.value = 'fast typing';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.value = 'fast typing test';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });

        // Wait for a second (assuming debounce is ~300-500ms)
        await page.waitForTimeout(1000);

        // Expect only 1 API call after the typing spree
        expect(apiCallCount).toBe(1);
    });

    test('高级筛选：状态、排序组合', async ({ page }) => {
        // Open advanced search
        await page.getByTestId('advanced-search-toggle').click();

        // Wait for advanced search to expand
        const panel = page.getByTestId('advanced-search-panel');
        const applyBtn = panel.getByTestId('advanced-search-apply');
        await expect(applyBtn).toBeVisible();

        // Select Status
        await panel.getByTestId('advanced-search-status').selectOption('ok');

        // Select Sort
        await panel.getByTestId('advanced-search-sort').selectOption('title');

        // Apply and check request
        const apiPromise = page.waitForResponse(res => {
            if (!res.url().includes('/api/bookmarks?') || res.request().method() !== 'GET') {
                return false;
            }
            const url = new URL(res.url());
            return url.searchParams.get('status') === 'ok' && url.searchParams.get('sort') === 'title';
        });
        await applyBtn.click();
        await apiPromise;
    });

    test('搜索 + 分类叠加：搜索词保留、切换分类后结果正确', async ({ page }) => {
        const searchInput = page.getByTestId('bookmark-search-input');
        await searchInput.fill('keyword');

        // Wait for debounce
        await page.waitForTimeout(600);

        // Click a category "未分类"
        const apiPromise = page.waitForResponse(res => {
            if (!res.url().includes('/api/bookmarks?') || res.request().method() !== 'GET') {
                return false;
            }
            const url = new URL(res.url());
            return url.searchParams.get('q') === 'keyword' && url.searchParams.get('category') === 'uncategorized';
        });
        await page.evaluate(() => {
            const button = document.querySelector('[data-testid="category-nav-uncategorized-tab"]');
            if (!(button instanceof HTMLButtonElement)) {
                throw new Error('uncategorized tab not found');
            }
            button.click();
        });
        await apiPromise;

        // Expect input value to still be 'keyword'
        await expect(searchInput).toHaveValue('keyword');
    });

    test('编辑 + 快捷键：编辑弹窗里回车提交、Escape 关闭', async ({ page }) => {
        // Create a test bookmark using browser context
        const url = `https://shortcut-test-${Date.now()}.com/`;
        await page.evaluate(async (testUrl) => {
            await fetch('/api/bookmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: testUrl })
            });
        }, url);

        // Reload page to show it
        await page.reload();
        await page.waitForLoadState('networkidle');

        const bookmarkRow = page.getByTestId('bookmark-row').filter({ hasText: url }).first();
        await expect(bookmarkRow).toBeVisible();
        const bookmarkId = await bookmarkRow.getAttribute('data-bookmark-id');
        expect(bookmarkId).toBeTruthy();

        // Open edit
        await bookmarkRow.getByTestId('bookmark-actions-button').click();
        await bookmarkRow.getByTestId('bookmark-row-edit-button').click();

        const editModal = page.getByTestId('edit-bookmark-modal');
        await expect(editModal).toBeVisible();

        // Focus title and hit Escape
        const titleInput = editModal.getByTestId('edit-bookmark-title-input');
        await titleInput.focus();
        await titleInput.press('Escape');

        // Expect modal to be hidden
        await expect(editModal).toBeHidden();

        // Re-open and edit with Enter
        await bookmarkRow.getByTestId('bookmark-actions-button').click();
        await bookmarkRow.getByTestId('bookmark-row-edit-button').click();
        await expect(editModal).toBeVisible();

        const newTitle = `Title ${Date.now()}`;
        await titleInput.fill(newTitle);

        const editPromise = page.waitForResponse(res =>
            res.request().method() === 'POST' && res.url().endsWith(`/api/bookmarks/${bookmarkId}/update`));
        await titleInput.press('Enter');

        await editPromise;
        await expect(editModal).toBeHidden();
        await expect(page.getByTestId('bookmark-row').filter({ hasText: newTitle }).first()).toBeVisible();
    });
});
