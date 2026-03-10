## 1. 全局自定义弹窗组件 (R6)

- [x] 1.1 在 `public/app.js` 中实现 `AppDialog` 全局对象，包含 `confirm(message, options)` 和 `alert(message, options)` 两个 Promise-based 方法，动态创建 DOM 并挂载到 body，使用 Tailwind CSS 样式（半透明遮罩 z-50、居中面板、圆角阴影），支持暗色主题、自定义按钮文本、弹窗排队机制
- [x] 1.2 替换 `public/app.js` 中所有 `confirm()` 调用（13 处）为 `await AppDialog.confirm()`，调用方函数标记为 `async`
- [x] 1.3 替换 `public/app.js` 中所有 `alert()` 调用（2 处）为 `await AppDialog.alert()`
- [x] 1.4 替换 `views/index.ejs` 中所有 `confirm()` 调用（2 处：删除模板、模板编辑未保存确认）为 `await AppDialog.confirm()`
- [x] 1.5 替换 `views/job.ejs` 中所有 `alert()` 调用（5 处）为 `await AppDialog.alert()`
- [x] 1.6 替换 `views/jobs.ejs` 中所有 `confirm()` 和 `alert()` 调用（5 处）为对应的 `AppDialog` 方法
- [x] 1.7 替换 `views/settings.ejs` 中所有 `confirm()` 调用（2 处）为 `await AppDialog.confirm()`
- [x] 1.8 替换 `views/snapshots.ejs` 中所有 `alert()` 调用（4 处）为 `await AppDialog.alert()`

## 2. 预置模板种子数据修正 (R4/R5)

- [x] 2.1 修改 `src/db.ts` 中 `seedPresetTemplates()` 的种子数据：`UI/UX` → `UI&UX`，`JavaScript/TypeScript` → `JavaScript&TypeScript`，`CI/CD` → `CI&CD`
- [x] 2.2 在 `src/db.ts` 的 `openDb()` 迁移区域添加迁移逻辑：更新已有 preset 模板 tree JSON 中含 `/` 的子分类名为 `&`

## 3. 模板编辑弹窗未保存检查 (R7)

- [x] 3.1 修改 `views/index.ejs` 中模板编辑面板的"取消"按钮和"X"关闭按钮的 click handler，在有未保存变更时调用 `await AppDialog.confirm('有未保存的修改，确定要关闭吗？')`，确认后关闭，取消则保持编辑状态
- [x] 3.2 修改 `views/index.ejs` 中 ESC 键处理逻辑，将 `confirm()` 替换为 `await AppDialog.confirm()`（与 1.4 合并处理）

## 4. 预置模板重置功能 (R12)

- [x] 4.1 在 `src/template-service.ts` 中新增 `resetTemplate(db, id)` 函数：验证模板为 preset 类型，独立实现重置逻辑（不复用 `applyTemplate()`）——在事务中清空所有分类 → 重建预置分类树 → 所有书签 `category_id` 设为 NULL → 删除该模板的旧 snapshot 数据。MUST NOT 调用 `restoreSnapshot()`
- [x] 4.2 在 `src/routes/templates.ts` 中新增 `POST /api/templates/:id/reset` 路由，调用 `resetTemplate()`
- [x] 4.3 在 `views/index.ejs` 模板选择面板中，为当前激活的预置模板添加"重置"按钮，点击后通过 `AppDialog.confirm()` 确认，调用 reset API

## 5. 模板删除级联 AI 整理任务 (R3 部分)

- [x] 5.1 修改 `src/template-service.ts` 中 `deleteTemplate()`：先取消所有 `assigning` 状态的关联 plan（调用 `jobQueue.cancelJob()` 终止 job，将 plan 状态设为 `canceled`），然后在事务中按顺序删除 `job_failures` → `jobs` → `plan_state_logs` → `ai_organize_plans`（`template_id` 匹配），最后删除模板本身

## 6. 空分类检测逻辑修正 (R11)

- [x] 6.1 修改 `src/ai-organize-plan.ts` 中 `applyPlan()` 函数（约 L423-428）：在移动书签循环中收集所有被移出书签的源 `category_id`（排除 NULL），移动完成后仅对这些源分类 ID 检查是否变空（叶子且无书签），替换当前的全局空叶子分类扫描 SQL
- [x] 6.2 同步修改 `src/ai-organize-plan.ts` 中 `resolveAndApply()` 函数（约 L480-485），使用相同的源分类检测逻辑
- [x] 6.3 修改 apply API 响应（`src/routes/ai.ts`），在返回结果中增加 `template_name` 字段（查询 `plan.template_id` 对应的模板名称）

## 7. 任务详情页返回按钮动态导航 (R13)

- [x] 7.1 修改 `src/routes/pages.ts` 中任务详情页路由：从请求的 `Referer` header 判断来源，若包含 `/jobs` 则 `backUrl = '/jobs'`，否则 `backUrl = '/'`，传给 EJS 模板
- [x] 7.2 修改 `views/job.ejs` 中返回按钮（L38 `href="/"`）：使用 `<%= backUrl %>` 替换硬编码的 `/`

## 8. 任务详情页失败项条件显示 (R9)

- [x] 8.1 修改 `views/job.ejs` 中失败项区块：用 EJS 条件判断 `<% if (job.failed > 0) { %>` 包裹失败项区块（标题和表格），无失败项时不渲染

## 9. 任务详情页 AJAX 分页 (R8)

- [x] 9.1 在 `src/routes/ai.ts` 中新增 `GET /api/ai/organize/:planId/assignments` 端点，支持 `page` 和 `page_size` 查询参数，返回分页后的 enriched assignments JSON
- [x] 9.2 在 `src/routes/jobs.ts` 中新增 `GET /api/jobs/:jobId/failures` 端点，支持 `page` 和 `page_size` 查询参数，返回分页后的 failures JSON
- [x] 9.3 修改 `views/job.ejs` 中 assignments 表格：将 `location.href` 分页替换为 fetch + DOM 替换的 AJAX 分页，与现有 suggestions 分页模式一致
- [x] 9.4 修改 `views/job.ejs` 中 failures 表格：同样替换为 AJAX 分页

## 10. SSE 增量推送批次结果 (R10)

- [x] 10.1 修改 `src/ai-organize.ts` 中批次处理逻辑：每批完成后，通过 SSE 事件流发送 `batch_assignments` 事件，payload 包含该批的 enriched assignments 列表
- [x] 10.2 修改 `views/job.ejs` 中 SSE 监听逻辑：监听 `batch_assignments` 事件，收到后将该批 assignments 追加到已有列表末尾，更新统计摘要

## 11. 整理计划 UI 迁移至任务详情页 (R1/R2/R3)

- [x] 11.1 在 `views/job.ejs` 中为 `ai_organize` 类型 job 新增 plan 操作区块：当 plan 状态为 `preview` 时显示 Diff 摘要、"应用"按钮和"放弃"按钮；显示"将应用于模板：{template_name}"提示
- [x] 11.2 实现"应用"按钮逻辑：调用 apply API，根据返回结果显示空分类确认界面（含模板名称）或冲突解决界面
- [x] 11.3 实现"放弃"按钮逻辑：调用 cancel API，显示"已取消"提示，plan 数据仍保留可查看
- [x] 11.4 修改 `views/index.ejs` 中 AI 整理弹窗：移除 Diff 预览、应用、冲突解决相关 UI，仅保留任务发起和进度显示
- [x] 11.5 修改 `views/index.ejs` 中 AI 整理弹窗：归类完成后自动跳转到 `/jobs/:jobId` 任务详情页
- [x] 11.6 修改 `views/index.ejs` 中待应用 plan 列表：每个 plan 点击后跳转到对应的 `/jobs/:jobId` 任务详情页（而非在弹窗内操作）
