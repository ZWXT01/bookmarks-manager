# R10-QA-01 仓库内 Playwright 补充冒烟稳定化验收记录

更新时间：2026-04-02

## 1. 目标

- 把当前重新引入但仍带旧假设的仓库内 Playwright 套件收口成可 clean rerun 的补充 smoke，避免继续制造失败噪声。
- 对齐当前页面实现：不再依赖旧 API 响应结构、过时文本定位或原生浏览器 `dialog`。
- 明确边界：仓库内 Playwright 现在只作为补充 smoke，主 UI gate 仍然是内置 Playwright MCP 与历史 issue 浏览器回放矩阵。

## 2. 实现变更

- 首页模板补齐稳定选择器：
  - `open-add-bookmark`
  - `add-bookmark-modal`
  - `add-bookmark-url-input`
  - `add-bookmark-title-input`
  - `add-bookmark-submit`
  - `bookmark-search-input`
  - `bookmark-search-submit`
  - `advanced-search-toggle`
  - `advanced-search-panel`
  - `advanced-search-status`
  - `advanced-search-sort`
  - `advanced-search-order`
  - `advanced-search-apply`
  - `advanced-search-reset`
  - `bookmark-view-toggle`
  - `category-nav-uncategorized-tab`
  - `bookmark-row-edit-button`
  - `bookmark-row-delete-button`
  - `edit-bookmark-modal`
  - `edit-bookmark-url-input`
  - `edit-bookmark-title-input`
  - `edit-bookmark-cancel`
  - `edit-bookmark-save`
  - `category-manager-search`
  - `category-manager-add-root`
  - `create-category-modal`
  - `create-category-name-input`
  - `create-category-cancel`
  - `create-category-confirm`
- 编辑书签弹窗补齐键盘交互：
  - `Escape` 关闭
  - `Enter` 提交
- 仓库内 Playwright spec 已对齐当前合同：
  - `e2e/bookmarks.spec.ts`
  - `e2e/categories.spec.ts`
  - `e2e/search-and-shortcuts.spec.ts`
- 页面壳体断言补进：
  - `tests/integration/page-assets.test.ts`

## 3. 验证步骤

1. `npx tsc --noEmit`
2. `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`
3. `npm run test:e2e`
4. `npm test`
5. `npm run build`

## 4. 验证结果

### 4.1 页面壳体与选择器合同

- 结果：通过
- 关键输出：
  - `tests/integration/page-assets.test.ts` 新增仓库内 Playwright smoke 壳体断言
  - 首页搜索、书签新增 / 编辑、分类管理与创建分类弹窗的稳定选择器已写入模板
  - 编辑书签弹窗的 `Escape` / `Enter` 键盘交互已写入模板

### 4.2 仓库内 Playwright 补充 smoke

- 结果：通过
- 关键输出：
  - `npm run test:e2e`
  - `11 passed (1.1m)`
  - 覆盖：
    - 首页登录 / 初始化
    - 书签新增 / 编辑 / 删除
    - 表格 / 卡片切换与分页
    - 分类切换、子分类 dropdown、键盘导航、分类管理拖拽
    - 搜索防抖、高级筛选、搜索词保留
    - 编辑弹窗 `Escape` 关闭与 `Enter` 提交

### 4.3 类型 / 单测 / 构建

- `npx tsc --noEmit`：通过
- `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`：`1/1` 文件、`10/10` 用例通过
- `npm test`：`22/22` 文件、`192/192` 用例通过
- `npm run build`：通过

## 5. 结论

- 仓库内 `e2e/` 与 `playwright.config.ts` 不再是“存在但不可用”的漂移资产，现在已经恢复成可 clean rerun 的补充 smoke。
- 这条补充 smoke 主要用于仓库原生交互的快速浏览器回放，不再依赖旧 API 结构、旧文本定位或原生确认框假设。
- 主 UI gate 没有回退，仍然以内置 Playwright MCP 与历史 issue 浏览器回放矩阵为准；仓库内 Playwright 只作为补充证据链存在。
