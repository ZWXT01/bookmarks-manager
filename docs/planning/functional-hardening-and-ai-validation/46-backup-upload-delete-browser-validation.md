# R9-QA-01 备份上传还原与备份删除浏览器回放验收记录

更新时间：2026-04-02

## 1. 目标

- 补齐首页备份弹窗的上传 restore 主线，证明 `.db` multipart 上传、成功提示与页面刷新恢复书签 / 分类不是只靠 API 合同维持。
- 补齐首页备份弹窗的手动备份删除主线，证明确认弹窗、列表刷新与磁盘文件清理在真实浏览器里一致。
- 保持口径一致：当前发布仍以内置 Playwright MCP 为 UI 主 gate，但这轮同时保留独立 Playwright browser harness，用来 clean rerun 高风险历史页面合同。

## 2. 实现变更

- 首页备份上传区域补齐稳定选择器回归断言：
  - `backup-upload-form`
  - `backup-upload-input`
  - `backup-upload-submit`
- 新增独立浏览器 harness：`scripts/backup-upload-delete-browser-validate.ts`
- 已接回统一入口：`scripts/playwright-issue-regression-validate.ts`
- 页面壳体断言补进：`tests/integration/page-assets.test.ts`

## 3. 验证步骤

1. `npx tsc --noEmit`
2. `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`
3. `npx tsx scripts/backup-upload-delete-browser-validate.ts`
4. `npx tsx scripts/playwright-issue-regression-validate.ts`
5. `npm test`
6. `npm run build`
7. Playwright MCP：
   - `npx tsx scripts/playwright-mcp-smoke-env.ts`
   - 用 Playwright MCP 登录首页并创建手动备份
   - 扰动临时 smoke 数据中的 `categories` / `bookmarks`
   - 上传同一 `.db` 备份文件执行 restore，确认成功提示后刷新页面
   - 再删除该手动备份，并确认备份目录只剩 `pre_restore_*.db`

## 4. 验证结果

### 4.1 定向浏览器 harness

- 结果：通过
- 关键输出：
  - upload restore：
    - `createdBackupName = manual_20260402_200642.db`
    - `preRestoreBackupName = pre_restore_20260402_200644.db`
    - `titlesBeforeMutation = ["上传还原前书签 A", "上传还原前书签 B"]`
    - `titlesAfterMutation = ["损坏后的临时书签"]`
    - `titlesAfterUploadRestore = ["上传还原前书签 A", "上传还原前书签 B"]`
    - `restoredCategoryLabel = 上传还原分类`
  - delete：
    - `deletedBackupName = manual_20260402_200642.db`
    - `removedFromUi = true`
    - `removedFromDisk = true`
    - `remainingManualRows = 0`

### 4.2 统一历史浏览器回放

- 结果：通过
- 关键输出：
  - `scriptCount = 14`
  - 新增 `R9-QA-01` 条目已纳入统一回放入口

### 4.3 Playwright MCP 页面复验

- 结果：通过
- 关键输出：
  - Playwright MCP 在临时 smoke 环境里创建了手动备份：
    - `manual_20260402_201027.db`
  - 扰动临时数据后，首页只剩：
    - `损坏后的临时书签`
  - 上传 restore 成功提示为：
    - `已从 manual_20260402_201027.db 还原分类与书签`
  - 确认提示并刷新后，首页恢复为：
    - `本地设置页`
    - `本地任务页`
    - `本地登录页`
  - 删除同一手动备份后：
    - 备份弹窗里的 `manual-backup-row = 0`
    - 备份目录只剩：
      - `pre_restore_20260402_201957.db`

### 4.4 类型 / 单测 / 构建

- `npx tsc --noEmit`：通过
- `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`：`1/1` 文件、`9/9` 用例通过
- `npm test`：`22/22` 文件、`191/191` 用例通过
- `npm run build`：通过

## 5. 结论

- 首页备份弹窗不再只证明“能立即备份、能命名还原”；现在也已有可复跑的真实浏览器证据，证明上传 `.db` 还原、成功提示和页面刷新恢复数据都成立。
- 手动备份删除也不再只是“DELETE 路由存在”；现在已有可复跑的真实浏览器证据，证明确认弹窗、列表刷新与磁盘文件清理保持一致。
- 这轮额外补了 Playwright MCP 页面复验，所以备份弹窗的新上传 / 删除合同不只是独立脚本能跑，MCP 视角下也确实可达、可见、可操作。
