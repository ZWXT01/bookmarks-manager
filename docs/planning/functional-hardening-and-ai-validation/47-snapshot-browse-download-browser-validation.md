# R9-QA-02 快照查看/下载/单条删除与筛选浏览器回放验收记录

更新时间：2026-04-02

## 1. 目标

- 补齐快照页搜索 / 日期筛选主线，证明列表收敛不是只靠路由合同维持。
- 补齐快照查看与下载主线，证明打开的确实是目标快照文件，下载链接也不是“按钮存在但结果未校验”。
- 补齐快照单条删除主线，证明删除确认、列表刷新、数据库记录与 HTML 文件清理在真实浏览器里一致。
- 保持口径一致：当前发布仍以内置 Playwright MCP 为 UI 主 gate，但这轮同时保留独立 Playwright browser harness，用来 clean rerun 高风险历史页面合同。

## 2. 实现变更

- 快照页补齐稳定选择器：
  - `snapshot-search-input`
  - `snapshot-date-filter`
  - `snapshot-clear-filter`
  - `snapshot-view-link`
  - `snapshot-download-link`
- 新增独立浏览器 harness：`scripts/snapshot-browse-download-browser-validate.ts`
- 已接回统一入口：`scripts/playwright-issue-regression-validate.ts`
- 页面壳体断言补进：`tests/integration/page-assets.test.ts`

## 3. 验证步骤

1. `npx tsc --noEmit`
2. `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`
3. `npx tsx scripts/snapshot-browse-download-browser-validate.ts`
4. `npx tsx scripts/playwright-issue-regression-validate.ts`
5. `npm test`
6. `npm run build`
7. Playwright MCP：
   - `npx tsx scripts/playwright-mcp-smoke-env.ts`
   - 向临时 smoke 数据注入目标快照、历史快照和无关快照
   - 用 Playwright MCP 登录 `/snapshots`
   - 复验搜索 / 日期筛选收敛、查看页内容、下载链接合同和单条删除结果

## 4. 验证结果

### 4.1 定向浏览器 harness

- 结果：通过
- 关键输出：
  - filter：
    - `initialTitles = ["其它无关快照", "筛选目标快照", "筛选目标历史快照"]`
    - `searchFilteredTitles = ["筛选目标快照", "筛选目标历史快照"]`
    - `dateFilteredTitles = ["筛选目标快照"]`
    - `clearedTitles = ["其它无关快照", "筛选目标历史快照"]`
  - view：
    - `openedFilename = snapshot-target.html`
    - `bodyIncludesTargetMarker = true`
  - download：
    - `suggestedFilename = 筛选目标快照.html`
    - `downloadedContentIncludesTargetMarker = true`
    - `downloadedContentIncludesTargetHeading = true`
  - delete：
    - `filteredTitlesAfterDelete = []`
    - `emptyStateVisibleAfterDelete = true`
    - `remainingTitlesAfterClear = ["其它无关快照", "筛选目标历史快照"]`
    - `dbCountAfterDelete = 2`
    - `fileRemoved = true`

### 4.2 统一历史浏览器回放

- 结果：通过
- 关键输出：
  - `scriptCount = 15`
  - 新增 `R9-QA-02` 条目已纳入统一回放入口

### 4.3 Playwright MCP 页面复验

- 结果：通过
- 关键输出：
  - 快照页初始总数为：
    - `4`
  - 搜索 `MCP 筛选目标` 并筛选日期 `2026-04-02` 后，列表收敛为：
    - `["MCP 筛选目标快照"]`
  - 查看页直接打开：
    - `http://127.0.0.1:43461/snapshots/mcp-target.html`
  - 查看页内容包含：
    - `MCP Target Snapshot`
    - `mcp-target-marker`
  - 下载链接合同为：
    - `href = /snapshots/mcp-target.html`
    - `download = MCP 筛选目标快照.html`
    - 页面上下文读取到的响应 `status = 200`
    - 返回内容包含 `mcp-target-marker`
  - 单条删除后：
    - `DELETE /api/snapshots/2 => 200`
    - 当前筛选下 `filteredTitles = []`
    - `emptyStateVisible = true`
    - `stats-total = 3`
    - 清除筛选后剩余：
      - `["MCP 其它快照", "登录页快照", "MCP 筛选目标历史快照"]`
    - 磁盘上只剩：
      - `mcp-history.html`
      - `mcp-other.html`
      - `snapshot-66b800fe.html`

### 4.4 类型 / 单测 / 构建

- `npx tsc --noEmit`：通过
- `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`：`1/1` 文件、`9/9` 用例通过
- `npm test`：`22/22` 文件、`191/191` 用例通过
- `npm run build`：通过

## 5. 结论

- 快照页不再只证明“有列表、有批量删除”；现在也已有可复跑的真实浏览器证据，证明搜索 / 日期筛选、查看、下载和单条删除都成立。
- 单条删除不再只是“DELETE 路由存在”；现在已有可复跑的真实浏览器证据，证明确认动作后页面列表、数据库记录与文件系统会同步收口。
- 这轮额外补了 Playwright MCP 页面复验，所以快照页的新筛选 / 查看 / 下载 / 删除合同不只是独立脚本能跑，MCP 视角下也确实可达、可见、可操作。
