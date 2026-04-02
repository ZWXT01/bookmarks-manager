# R8-QA-02 任务列表清理与快照批量删除浏览器回放验收记录

更新时间：2026-04-02

## 1. 目标

- 补齐任务列表 `清理已完成`、`清空全部` 的浏览器级主线，证明确认弹窗、列表刷新和真实数据删除结果一致。
- 补齐快照页 `全选 / 批量删除` 的浏览器级主线，证明 UI 选择态、确认弹窗、数据库记录和快照文件删除结果一致。
- 保持口径一致：当前会话没有可调用的 Playwright MCP server，因此本轮记录的是独立 Playwright browser harness 的等价回放，不伪装成真实 MCP 会话。

## 2. 实现变更

- 任务列表页新增稳定选择器：
  - `jobs-page`
  - `jobs-clear-completed`
  - `jobs-clear-all`
  - `jobs-table`
  - `jobs-table-body`
  - `jobs-empty-state`
  - `jobs-row`
  - `jobs-row-link`
- 快照页新增稳定选择器：
  - `snapshots-page`
  - `snapshots-select-all`
  - `snapshots-batch-delete`
  - `snapshot-list`
  - `snapshots-empty-state`
  - `snapshot-row`
  - `snapshot-checkbox`
  - `snapshot-title`
  - `snapshot-delete-button`
  - `snapshot-delete-modal`
  - `snapshot-delete-confirm`
  - `snapshot-batch-delete-modal`
  - `snapshot-batch-delete-confirm`
- 新增独立浏览器 harness：`scripts/jobs-snapshots-browser-validate.ts`
- 已接回统一入口：`scripts/playwright-issue-regression-validate.ts`
- 页面壳体断言补进：`tests/integration/page-assets.test.ts`
- 同轮还修正了 `scripts/backup-job-browser-validate.ts` 的任务详情轮询时序，避免它在统一回放里间歇性超前读取旧进度。

## 3. 验证步骤

1. `npx tsx scripts/jobs-snapshots-browser-validate.ts`
2. `npx tsx scripts/playwright-issue-regression-validate.ts`
3. `npx tsc --noEmit`
4. `npm test`
5. `npm run build`

## 4. 验证结果

### 4.1 定向浏览器 harness

- 结果：通过
- 关键输出：
  - jobs 初始行：`["browser-failed-job", "browser-done-job", "browser-running-job"]`
  - `clear-completed` 后：`["browser-running-job"]`
  - `clear-all` 后：`[]`
  - `runningJobPreserved = true`
  - `clearedCompletedRemoved = true`
  - jobs 空态可见：`emptyStateVisible = true`
  - snapshots 初始标题：`["快照 A", "快照 B", "快照 C"]`
  - 删除快照 ID：`["1", "2", "3"]`
  - `remainingRows = 0`
  - snapshots 空态可见：`emptyStateVisible = true`
  - `filesRemoved = true`
  - `dbCountAfterDelete = 0`

### 4.2 统一历史浏览器回放

- 结果：通过
- 关键输出：
  - `scriptCount = 12`
  - `totalDurationMs = 286907`
  - 新增 `R8-QA-02` 条目已纳入统一回放入口
  - 同轮 `R8-QA-01` 的任务详情中间态 / 终态回放也保持稳定：
    - 中间态：`progress = 2/5`
    - 终态：`progress = 5/5`

### 4.3 类型 / 单测 / 构建

- `npx tsc --noEmit`：通过
- `npm test`：`22/22` 文件、`190/190` 用例通过
- `npm run build`：通过

## 5. 结论

- 任务列表的 destructive action 不再只是“接口存在、按钮也在”；现在已有可复跑的真实浏览器证据，证明确认弹窗、页面刷新和删除结果一致。
- 快照页的 `全选 / 批量删除` 也不再只是“路由合同 + 页面脚本”；现在已有可复跑的真实浏览器证据，证明快照记录和实际文件都会被删干净。
- 当前会话仍无 Playwright MCP server；因此本轮继续使用独立 Playwright harness 作为等价 browser replay。MCP 仍是主路径口径，但这里记录的不是伪装出来的 MCP 会话。
