## Context

分类模板系统和 AI 整理功能已完成首轮实现（见 archived changes: `2026-03-05-refactor-ai-organize-with-templates`）。用户测试后反馈 12 项问题，涵盖 UI 改进（R1-R4）、Bug 修复（R5-R7, R11）、UX 优化（R8-R10）和任务详情页重构（R12）。

当前技术栈：Fastify + better-sqlite3 后端，EJS + Alpine.js + Tailwind 前端，SSE/polling 实时更新。

## Goals / Non-Goals

**Goals:**
- 修复 4 个阻塞性 Bug（R5 书签 ID 类型、R7 进度不同步、R11 空 body Bad Request、R6 缺按钮）
- 改进模板选择器 UI（R1-R4：分组展示、基于预置模板创建、窗口尺寸）
- 优化 AI 整理交互流程（R8-R10：去重复下拉、引导提示、移除冗余设置）
- 为 `ai_organize` 类型 job 建立独立的任务详情展示（R12）

**Non-Goals:**
- 不修改 AI 分类的核心算法或 prompt
- 不新增 API 端点（仅扩展现有端点返回数据）
- 不重构后端 plan 状态机

## Decisions

### D1: 书签 ID 类型转换放在后端——严格模式（R5）
后端 `src/routes/ai.ts` 的 `classify-batch` 和 `organize` 端点在过滤 `bookmark_ids` 前先做 `Number()` 转换（非 `parseInt`），再用 `Number.isInteger()` 校验。`Number("123abc")` → NaN → 过滤掉，比 `parseInt` 更严格。转换后静默去重（`[...new Set(ids)]`），total/processed 基于去重后数量计算。
**理由**: 防御性编程——后端不应假设前端传入的类型。严格模式避免 `parseInt` 的宽松解析掩盖前端 bug。去重防止同一书签被重复分类。

### D2: Job 进度同步嵌入 assignBookmarks 循环（R7）
在 `src/ai-organize.ts` 的 `assignBookmarks` 函数中，确定 batches 数量后立即 `updateJob(db, jobId, { total: bookmarks.length })`，每完成一个 batch 后 `updateJob(db, jobId, { processed: processedCount })`。需要将 `job_id` 从 plan 传入 `assignBookmarks`。
**理由**: 最小改动——不需要新增轮询机制，复用现有 job 更新路径。

### D3: apply 请求加空 body（R11）
`public/app.js` 的 `applyOrganizePlan()` 加 `body: JSON.stringify({})`。
**理由**: 最简修复。Fastify 在 `Content-Type: application/json` 时要求非空 body，加空对象即可。

### D4: 模板选择器分组用前端过滤（R2）
在 `public/app.js` 中增加 getter `get presetTemplates()` 和 `get customTemplates()`，模板选择器 HTML 用两个独立 `x-for` 遍历。
**理由**: 后端 `listTemplates()` 已返回 type 字段且按 type 排序，无需改后端。

### D5: 新建模板"基于预置"用异步加载 tree（R3）
点击"新建自定义模板"后，编辑器顶部增加"基于"下拉选择器（空白 + 4 个预置模板名）。选择预置模板时，前端调用 `GET /api/templates/:id` 获取完整 tree，填充到编辑器。
**理由**: 复用现有 API，无需新增端点。预置模板 tree 数据量小（几 KB），异步加载无性能问题。

### D6: AI 整理入口简化为直接打开窗口（R8）
移除侧边栏"AI 整理"按钮的下拉菜单（`views/index.ejs:122-132`），改为直接调用 `openAIOrganizeModal()`。窗口内已有整理范围选择器。
**理由**: 消除重复交互步骤。

### D7: ai_organize 任务详情页独立展示（R12）
在 `views/job.ejs` 中为 `job.type === 'ai_organize'` 新增独立区块，展示 plan 的 assignments 数据。后端 `src/routes/index.ts` 的 job 详情路由在渲染 `ai_organize` 类型时，查询关联的 plan（通过 `ai_organize_plans.job_id`）并将 assignments 传给模板。已删除的书签在 assignments 列表中显示占位信息（title="[已删除的书签]"，url 为空），保留分类建议和状态。
**理由**: 与书签有效性检查任务模板完全解耦，各自独立维护。占位信息保留历史记录完整性。

### D9: 模板编辑器 ESC 关闭行为（R4 补充）
模板编辑器移除遮罩层关闭后，ESC 键仍可关闭编辑器，但存在未保存变更时弹出确认对话框。未保存检测：比较当前模板名称和分类树与打开时的快照。
**理由**: ESC 是用户习惯的关闭方式，完全禁用体验差。确认弹窗在防误触和便捷性之间取得平衡。

### D8: 移除设置页 batch_size（R10）
直接删除 `views/settings.ejs` 中 `ai_batch_size` 的 `<label>` 块。后端设置存储不受影响（旧值保留但不再使用）。
**理由**: AI 整理和批量分类窗口已各自提供 batch size 选择器（10/20/30），设置页的配置（15/30/50/100）值域不一致且冗余。

## Risks / Trade-offs

- [R12 数据量] ai_organize plan 的 assignments 可能包含数百条记录 → 任务详情页使用分页加载，与现有 suggestions 分页机制一致
- [R4 窗口尺寸] `max-w-3xl` 在小屏设备上可能过宽 → 保留 `max-h-[90vh]` 和 `overflow-y-auto`，响应式布局由 Tailwind 处理
- [R7 job 更新频率] 每个 batch 完成后都 updateJob → 对 SQLite 写入压力极小（batch 间隔数秒），可接受
