## 1. Bug 修复（阻塞性）

- [x] 1.1 修复书签 ID 类型不匹配：`src/routes/ai.ts` 的 `classify-batch` 端点，将 `rawIds.filter()` 改为先 `rawIds.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0)`，再 `[...new Set(ids)]` 去重。同样修改 `organize` 端点的 ID 解析逻辑
- [x] 1.2 修复 apply 空 body Bad Request：`public/app.js` 的 `applyOrganizePlan()` 方法，在 fetch 调用中加 `body: JSON.stringify({})`
- [x] 1.3 修复 AI 整理进度不同步：`src/ai-organize.ts` 的 `assignBookmarks` 函数，从 plan 获取 `job_id`，确定 batches 数量后调用 `updateJob(db, jobId, { total: bookmarks.length })`，每完成一个 batch 后调用 `updateJob(db, jobId, { processed: cumulativeProcessedCount })`
- [x] 1.4 AI 整理窗口 assigning 阶段增加"查看任务详情"按钮：`views/index.ejs` 的 assigning phase 区域（约 L1114），在"取消"按钮旁增加跳转到 `/jobs/:jobId` 的链接按钮，`organizePlan` 中的 `job_id` 通过 `loadOrganizePlan` 获取

## 2. 模板选择器 UI 改进

- [x] 2.1 `public/app.js` 增加 getter `get presetTemplates()` 和 `get customTemplates()`，分别过滤 `templates` 数组中 `type === 'preset'` 和 `type === 'custom'` 的模板
- [x] 2.2 `views/index.ejs` 模板选择器（约 L877-942）：拆分为"预置模板"和"自定义模板"两个分组区块，各自用独立 `x-for` 遍历 `presetTemplates` / `customTemplates`
- [x] 2.3 移除预置模板的"复制"按钮（约 L908-910 的 `x-if="tpl.type === 'preset'"` 按钮块）
- [x] 2.4 模板选择器窗口尺寸从 `max-w-lg` 改为 `max-w-3xl`（约 L881）
- [x] 2.5 模板编辑器窗口尺寸从 `max-w-lg` 改为 `max-w-3xl`（约 L976），并移除 `@click.self="showTemplateEditModal = false"` 防止误触关闭
- [x] 2.6 模板编辑器 ESC 关闭增加未保存确认：`public/app.js` 增加 `templateEditSnapshot`（打开时记录名称+tree 的 JSON 快照），增加 `hasUnsavedTemplateChanges()` 方法比较当前状态与快照。`views/index.ejs` 模板编辑器增加 `@keydown.escape` 处理：有变更时 `confirm('有未保存的修改，确定要关闭吗？')` → 确认则关闭，取消则保持；无变更时直接关闭

## 3. 新建模板"基于预置模板"功能

- [x] 3.1 `public/app.js` 增加状态字段 `templateEditSourceId`（默认 null 表示空白模板），`openNewTemplateEditor()` 方法中初始化该字段
- [x] 3.2 `public/app.js` 增加 `loadPresetTreeForEdit(sourceId)` 方法：调用 `GET /api/templates/:id` 获取预置模板 tree，填充到 `templateEditTree`
- [x] 3.3 `views/index.ejs` 模板编辑器（约 L972-1029）：在模板名称输入框上方增加"基于"下拉选择器，选项为"空白模板"+ 所有预置模板名称，`x-model` 绑定 `templateEditSourceId`，`@change` 触发 `loadPresetTreeForEdit`

## 4. AI 整理 UX 优化

- [x] 4.1 `views/index.ejs` 移除 AI 整理按钮的下拉菜单（约 L122-132），改为直接 `@click="openAIOrganizeModal()"`
- [x] 4.2 `views/index.ejs` AI 整理窗口 idle 阶段（约 L1063）增加模板引导提示文案
- [x] 4.3 `views/index.ejs` 批量分类窗口（约 L954）增加模板引导提示文案
- [x] 4.4 `views/settings.ejs` 移除"每批分类数量"配置项（约 L166-174 的 `ai_batch_size` label 块）

## 5. AI 整理任务详情页

- [x] 5.1 `src/routes/pages.ts` 的 job 详情路由：当 `job.type === 'ai_organize'` 时，通过 `ai_organize_plans.job_id` 查询关联 plan，解析 assignments JSON，LEFT JOIN bookmarks 表获取 title/url（已删除书签 title 显示为"[已删除的书签]"、url 为空），将 enriched assignments 列表和 plan 状态传给 EJS 模板
- [x] 5.2 `views/job.ejs` 新增 `ai_organize` 类型专属区块：显示 plan 状态、统计摘要（已分配数/待审核数）、分页的 assignments 列表（每条含书签标题、URL、建议分类路径、状态标签）
- [x] 5.3 `views/job.ejs` 确保 `bookmark_check` 类型 job 仍渲染现有失败项表格，不受 `ai_organize` 区块影响
