# R8-QA-01 备份还原与任务详情浏览器回放验收记录

更新时间：2026-04-01

## 1. 目标

- 补齐首页备份弹窗的浏览器级主线，证明“立即备份 -> 命名还原 -> 页面刷新恢复数据”成立。
- 补齐任务详情页运行中刷新的浏览器级主线，证明进度、消息与终态不是静态渲染，而是会在真实浏览器里更新。
- 保持口径一致：当前会话没有可调用的 Playwright MCP server，因此本轮记录的是独立 Playwright browser harness 的等价回放，不伪装成真实 MCP 会话。

## 2. 实现变更

- 首页备份入口与弹窗新增稳定选择器：
  - `open-backup-modal`
  - `backup-modal`
  - `backup-panel`
  - `backup-run-now`
  - `manual-backup-row`
  - `backup-restore-button`
  - `backup-delete-button`
- 任务详情页新增稳定选择器：
  - `job-detail-page`
  - `job-status`
  - `job-message`
  - `job-updated`
  - `job-bar`
  - `job-current-item`
  - `job-progress-summary`
  - `job-progress`
  - `job-total`
  - `job-inserted`
  - `job-skipped`
  - `job-failed`
  - `cancel-job-btn`
- 新增独立浏览器 harness：`scripts/backup-job-browser-validate.ts`
- 已接回统一入口：`scripts/playwright-issue-regression-validate.ts`
- 页面壳体断言补进：`tests/integration/page-assets.test.ts`

## 3. 验证步骤

1. `npx tsx scripts/backup-job-browser-validate.ts`
2. `npx tsx scripts/playwright-issue-regression-validate.ts`
3. `npx tsc --noEmit`
4. `npm test`
5. `npm run build`

## 4. 验证结果

### 4.1 定向浏览器 harness

- 结果：通过
- 关键输出：
  - `createdBackupName = manual_20260401_225952.db`
  - `preRestoreBackupName = pre_restore_20260401_225954.db`
  - `titlesBeforeMutation = ["备份前书签 A", "备份前书签 B"]`
  - `titlesAfterMutation = ["损坏后的临时书签"]`
  - `titlesAfterRestore = ["备份前书签 A", "备份前书签 B"]`
  - 任务详情中间态：`status = 运行中`、`progress = 2/4`、`message = 检查中：第二条书签`
  - 任务详情终态：`status = 已完成`、`progress = 4/4`、`inserted = 3`、`skipped = 1`、`failed = 0`

### 4.2 统一历史浏览器回放

- 结果：通过
- 关键输出：
  - `scriptCount = 11`
  - `totalDurationMs = 141916`
  - 新增 `R8-QA-01` 条目已纳入统一回放入口

### 4.3 类型 / 单测 / 构建

- `npx tsc --noEmit`：通过
- `npm test`：`22/22` 文件、`189/189` 用例通过
- `npm run build`：通过

## 5. 结论

- 首页备份弹窗不再只是“接口存在”，而是已有可复跑的真实浏览器证据，证明立即备份、命名还原和页面刷新恢复数据成立。
- 任务详情页也不再只是“路由测试 + SSE 接口存在”，而是已有可复跑的真实浏览器证据，证明运行中进度、消息与终态都会更新。
- 当前会话仍无 Playwright MCP server；因此本轮继续使用独立 Playwright harness 作为等价 browser replay。MCP 仍是主路径口径，但这里记录的不是伪装出来的 MCP 会话。
