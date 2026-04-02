# R8-QA-03 导入启动与导出下载浏览器回放验收记录

更新时间：2026-04-02

## 1. 目标

- 补齐首页导入主线，证明上传文件、覆盖分类、导入进度弹层和首页刷新不是只靠路由合同维持。
- 补齐首页导出主线，证明导出弹层的范围 / 格式切换和真实下载内容不是“按钮能点但结果未校验”。
- 保持口径一致：当前发布仍以内置 Playwright MCP 为 UI 主 gate，但这轮同时保留独立 Playwright browser harness，用来 clean rerun 高风险历史页面合同。

## 2. 实现变更

- 首页导入区域新增稳定选择器：
  - `import-form`
  - `import-file-input`
  - `import-override-category`
  - `import-default-category`
  - `import-skip-duplicates`
  - `import-submit`
- 导入进度弹层新增稳定选择器：
  - `import-progress-modal`
  - `import-progress-panel`
  - `import-progress-close`
  - `import-progress-value`
  - `import-progress-bar`
  - `import-progress-fill`
  - `import-progress-summary`
  - `import-progress-cancel`
- 首页导出入口与弹层新增稳定选择器：
  - `open-export-modal`
  - `export-modal`
  - `export-panel`
  - `export-close`
  - `export-scope-select`
  - `export-format-select`
  - `export-cancel`
  - `export-download`
- 新增独立浏览器 harness：`scripts/import-export-browser-validate.ts`
- 已接回统一入口：`scripts/playwright-issue-regression-validate.ts`
- 页面壳体断言补进：`tests/integration/page-assets.test.ts`

## 3. 验证步骤

1. `npx tsc --noEmit`
2. `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`
3. `npx tsx scripts/import-export-browser-validate.ts`
4. `npx tsx scripts/playwright-issue-regression-validate.ts`
5. `npm test`
6. `npm run build`
7. Playwright MCP：
   - `npx tsx scripts/playwright-mcp-smoke-env.ts`
   - 用 Playwright MCP 登录首页
   - 复验导入控件、覆盖分类下拉与导出弹层默认下载合同

## 4. 验证结果

### 4.1 定向浏览器 harness

- 结果：通过
- 关键输出：
  - import：
    - `importedTitles = ["导入书签二", "导入书签一"]`
    - `importedCategoryLabel = 统一导入`
    - `progressSummary = 2/2 (成功:2 失败:0)`
    - `progressValue = 100%`
  - export：
    - `allHtmlFilename = bookmarks.html`
    - `allHtmlContainsImportedTitles = true`
    - `allHtmlContainsFolderName = true`
    - `uncategorizedJsonFilename = bookmarks.json`
    - `uncategorizedJsonTitles = ["待导出未分类"]`
    - `uncategorizedJsonCount = 1`

### 4.2 统一历史浏览器回放

- 结果：通过
- 关键输出：
  - `scriptCount = 13`
  - `totalDurationMs = 250330`
  - 新增 `R8-QA-03` 条目已纳入统一回放入口

### 4.3 Playwright MCP 页面复验

- 结果：通过
- 关键输出：
  - 登录后首页可见导入区与导出快捷操作
  - Playwright MCP 已读到导入覆盖分类下拉选项：
    - `未分类`
    - `技术开发`
    - `技术开发/后端`
    - `技术开发/前端`
    - `临时分类`
    - `临时分类/收件箱`
    - `学习资源`
    - `学习资源/课程`
    - `学习资源/文档`
    - `工具软件`
    - `工具软件/效率`
    - `工具软件/AI`
  - 导出弹层打开后默认合同为：
    - `scopeValue = all`
    - `formatValue = html`
    - 下载链接 `href = /export`

### 4.4 类型 / 单测 / 构建

- `npx tsc --noEmit`：通过
- `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`：`1/1` 文件、`9/9` 用例通过
- `npm test`：`22/22` 文件、`191/191` 用例通过
- `npm run build`：通过

## 5. 结论

- 首页导入不再只是“能提交表单”；现在已有可复跑的真实浏览器证据，证明上传文件、覆盖分类、进度收口和首页刷新都成立。
- 首页导出也不再只是“有一个下载链接”；现在已有可复跑的真实浏览器证据，证明 `all/html` 和 `uncategorized/json` 两条关键下载合同成立。
- 这轮额外补了 Playwright MCP 页面复验，所以新加的导入 / 导出 UI 壳层不只是独立脚本能跑，MCP 视角下也确实可达、可见、可操作。
