# R9-QA-03 导入取消、通用任务取消与失败明细分页浏览器回放验收记录

更新时间：2026-04-02

## 1. 目标

- 补齐首页顶部当前任务取消主线，证明运行中任务 banner 不是只靠 `/api/jobs/current` 轮询“看起来存在”。
- 补齐首页导入进度弹层取消主线，证明导入中的取消请求、SSE 收口与弹层关闭在真实浏览器里一致。
- 补齐任务详情取消与失败明细分页主线，证明 `/api/jobs/:id/cancel`、失败列表翻页和页大小切换不是只靠 API 合同维持。
- 保持口径一致：当前发布仍以内置 Playwright MCP 为 UI 主 gate，但这轮同时保留独立 Playwright browser harness，用来 clean rerun 高风险历史页面合同。

## 2. 实现变更

- 首页顶部当前任务区补齐稳定选择器：
  - `current-job-banner`
  - `current-job-progress`
  - `current-job-cancel`
- 任务详情失败明细区补齐稳定选择器：
  - `failure-page-size`
  - `failure-table`
  - `failure-list`
  - `failure-row`
  - `failure-input`
  - `failure-reason`
  - `failure-pager`
  - `failure-current-page`
  - `failure-total-pages`
  - `failure-prev-btn`
  - `failure-next-btn`
- 新增独立浏览器 harness：`scripts/job-cancel-failures-browser-validate.ts`
- 已接回统一入口：`scripts/playwright-issue-regression-validate.ts`
- 页面壳体断言补进：`tests/integration/page-assets.test.ts`

## 3. 验证步骤

1. `npx tsc --noEmit`
2. `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`
3. `npx tsx scripts/job-cancel-failures-browser-validate.ts`
4. `npx tsx scripts/playwright-issue-regression-validate.ts`
5. `npm test`
6. `npm run build`
7. Playwright MCP：
   - `npx tsx scripts/playwright-mcp-smoke-env.ts`
   - 向临时 smoke 数据注入 `mcp-current-check`、`mcp-import-cancel`、`mcp-detail-cancel` 与 `mcp-failure-pages`
   - 用 Playwright MCP 登录首页，复验顶部当前任务取消、导入进度取消、任务详情取消，以及失败明细翻页和页大小切换
   - 最后回查临时 SQLite，确认 3 个取消任务的状态都已落为 `canceled`

## 4. 验证结果

### 4.1 定向浏览器 harness

- 结果：通过
- 关键输出：
  - current job cancel：
    - `jobId = browser-current-job-cancel`
    - `bannerProgress = 2/6`
    - `finalStatus = canceled`
    - `bannerHiddenAfterCancel = true`
  - import cancel：
    - `jobId = browser-import-cancel`
    - `summaryBeforeCancel = 0/10 (成功:0 失败:0)`
    - `finalStatus = canceled`
    - `modalHiddenAfterCancel = true`
  - job detail cancel：
    - `jobId = browser-job-detail-cancel`
    - `statusAfterReload = 已取消`
    - `messageAfterReload = 任务已取消`
    - `cancelButtonVisibleAfterReload = false`
  - failure pagination：
    - `jobId = browser-failure-pagination`
    - `initialPage = 1`
    - `initialTotalPages = 2`
    - `initialRowCount = 20`
    - `initialFirstInput = failure-input-25`
    - `secondPage = 2`
    - `secondPageRowCount = 5`
    - `secondPageInputs = ["failure-input-5","failure-input-4","failure-input-3","failure-input-2","failure-input-1"]`
    - `pageSizeAfterChange = 50`
    - `totalPagesAfterChange = 1`
    - `rowCountAfterChange = 25`
    - `firstInputAfterChange = failure-input-25`

### 4.2 统一历史浏览器回放

- 结果：通过
- 关键输出：
  - `scriptCount = 16`
  - 新增 `R9-QA-03` 条目已纳入统一回放入口

### 4.3 Playwright MCP 页面复验

- 结果：通过
- 关键输出：
  - 首页顶部当前任务初始显示为：
    - `🔍 检查`
    - `2/6`
  - 通过页面上下文调用 `cancelCurrentJob()` 后：
    - 当前任务 banner 结果为 `[]`
    - `POST /api/check/cancel => 200`
    - 请求体为 `{"jobId":"mcp-current-check"}`
  - 导入进度弹层经页面上下文恢复后显示：
    - `0/10 (成功:0 失败:0)`
  - 通过页面上下文调用 `cancelImportJob()` 后：
    - `modalVisible = false`
    - `POST /api/jobs/mcp-import-cancel/cancel => 200`
  - 任务详情页 `mcp-detail-cancel` 中：
    - 通过页面上下文触发 `cancel-job-btn` 后，状态变为 `已取消`
    - `cancelButtons = 0`
    - `POST /api/jobs/mcp-detail-cancel/cancel => 200`
    - 请求体为 `{"jobId":"mcp-detail-cancel"}`
  - 失败明细分页页初始为：
    - `第 1/2 页`
    - 首行是 `mcp-failure-input-25`
  - 通过页面上下文触发 `failure-next-btn` 后：
    - `currentPage = 2`
    - `rows = 5`
    - 首行变为 `mcp-failure-input-5`
  - 切换 `failure-page-size = 50` 后：
    - `currentPage = 1`
    - `totalPages = 1`
    - `rows = 25`
    - `pagerClass` 包含 `hidden`
  - 临时 SQLite 回查结果：
    - `mcp-current-check|canceled|已取消`
    - `mcp-detail-cancel|canceled|任务已取消`
    - `mcp-import-cancel|canceled|任务已取消`
    - `page2Inputs = mcp-failure-input-5,mcp-failure-input-4,mcp-failure-input-3,mcp-failure-input-2,mcp-failure-input-1`

### 4.4 类型 / 单测 / 构建

- `npx tsc --noEmit`：通过
- `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`：`1/1` 文件、`9/9` 用例通过
- `npm test`：`22/22` 文件、`191/191` 用例通过
- `npm run build`：通过

## 5. 结论

- 首页顶部当前任务、导入进度弹层和任务详情页的取消动作都不再只是“按钮存在”；现在已有可复跑的真实浏览器证据，证明取消请求、状态收口和界面变化保持一致。
- 任务详情失败明细也不再只是“分页 API 有结果”；现在已有可复跑的真实浏览器证据，证明翻页、页大小切换和页面列表同步成立。
- 这轮额外补了 Playwright MCP 页面复验，所以 `R9-QA-03` 的取消 / 失败分页合同不只是独立脚本能跑，MCP 视角下也确实可达、可见、可操作。
