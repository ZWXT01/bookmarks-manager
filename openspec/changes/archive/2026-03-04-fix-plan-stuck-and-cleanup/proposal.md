## Why

AI 整理功能存在三个问题：

1. 当上一次整理因异常中断（浏览器关闭、网络断开等），plan 会卡在 `designing` / `assigning` 状态，用户再次点击"开始整理"时收到 `active plan already exists` 错误（HTTP 409），且前端没有提供任何恢复手段（取消旧 plan 或继续旧 plan），导致功能完全不可用。根源在 `src/ai-organize-plan.ts:173-179` 的 `createPlan()` 检测到活跃 plan 后直接抛错，而前端 `public/app.js:1604-1630` 的 `startOrganize()` 收到 409 后仅 `showToast` 然后回到 idle，无恢复路径。

2. plan 状态变更没有任何日志记录。`src/ai-organize-plan.ts:218-250` 的 `transitionStatus()` 只修改状态字段，不记录变更历史。当出现问题（如上述卡死）时，无法排查 plan 是什么时候、因为什么原因卡在了某个状态。现有的 `jobs` 表和 `job_failures` 表只记录任务级别信息，不覆盖 plan 生命周期。

3. 项目中存在已删除源文件的编译残留、已迁移到 TypeScript 的旧 JavaScript 测试文件、以及从未被导入的重复工具函数，增加维护负担和混淆。

## What Changes

- 后端 `src/ai-organize-plan.ts` 的 `createPlan()` 增加超时清理逻辑：`designing` / `assigning` 状态超过 2 小时的 plan 自动标记为 `error`，使新 plan 可以正常创建
- 后端新增 API `GET /api/ai/organize/active` 返回当前活跃的 plan（如果存在）
- 前端 `public/app.js` 的 `startOrganize()` 在收到 409 时，自动查询活跃 plan 并展示恢复选项：继续已有 plan 或取消后重新开始
- 数据库 `src/db.ts` 新增 `plan_state_logs` 表，记录 plan 状态变更历史（plan_id, from_status, to_status, reason, created_at）
- `src/ai-organize-plan.ts` 的 `transitionStatus()` 和 `createPlan()` 中写入状态变更日志
- 删除 5 个孤立编译产物：`dist/ai-classifier.js`、`dist/ai-classify-job.js`、`dist/ai-classify-level.js`、`dist/ai-simplify-job.js`、`dist/ai-simplify-level.js`（对应源文件已在上次重构中删除）
- 删除 6 个旧 JavaScript 测试文件（已迁移到 TypeScript）：`tests/category-service.test.js`、`tests/exporter.test.js`、`tests/importer.test.js`、`tests/jobs.test.js`、`tests/url.test.js`、`tests/helpers/db.js`
- 删除 `src/routes/types.ts` 中从未被导入的重复工具函数（`toInt`、`toIntClamp`、`validateStringLength`、`safeRedirectTarget`、`withFlash`），保留该文件中的类型定义（`RouteContext`、`CategoryRow`、`BookmarkRow` 等）

## Capabilities

### Modified Capabilities

- `ai-organize-plan`: 增加 plan 超时自动清理（2 小时）、状态变更日志记录
- `ai-organize-api`: 新增 `GET /api/ai/organize/active` 端点
- `ai-organize-ui`: 前端增加活跃 plan 恢复交互（继续 / 取消重建）

### New Capabilities

（无新增 capability）

## Impact

- 后端：修改 `src/ai-organize-plan.ts`（超时清理 + 日志写入）、`src/routes/ai.ts`（新增 active 端点）、`src/db.ts`（新增 `plan_state_logs` 表）
- 前端：修改 `public/app.js`（409 恢复交互逻辑）
- 清理：删除 `dist/` 下 5 个孤立文件、`tests/` 下 6 个旧 .js 文件、`src/routes/types.ts` 中 5 个未使用的函数
- 不受影响：`src/ai-organize.ts`、`src/category-service.ts`、`src/routes/bookmarks.ts`、`src/routes/categories.ts`、`src/exporter.ts`、`src/importer.ts`、`src/jobs.ts`、`extension-new/`
