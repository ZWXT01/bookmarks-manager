## Why

分类模板系统和 AI 整理功能在首轮实现后暴露出 12 项问题：模板选择器缺乏分组展示、预置模板可被误编辑、AI 分类因类型不匹配导致"无有效书签 ID"、AI 整理进度在窗口与任务详情页之间不同步、apply 请求因空 body 触发 Bad Request、任务详情页套用了书签检查模板而非 AI 分类专属模板。这些问题直接影响核心功能的可用性，需要立即修复。

## What Changes

### 模板系统改进
- 移除预置模板的"复制"按钮，预置模板在选择器中仅保留"应用"操作
- 模板选择器将预置模板和自定义模板分组展示（两个独立区块）
- 新建自定义模板流程增加"基于预置模板"选项，选择后加载对应预置模板的分类树供用户编辑
- 模板选择器和模板编辑器窗口尺寸加大（`max-w-lg` → `max-w-3xl`），模板编辑器移除点击遮罩关闭行为以防误触丢失编辑

### Bug 修复
- 修复书签栏选中书签点击 AI 分类时"无有效的书签 ID"错误：`selectedBookmarks` 存储字符串 ID，后端 `Number.isInteger()` 过滤掉了字符串类型的 ID
- AI 整理窗口 assigning 阶段增加"查看任务详情"按钮
- 修复 AI 整理进度不同步：`createJob` 时 total=0 且后续未同步更新 job 的 total/processed，导致任务详情页显示 0/0
- 修复单个书签 AI 分类应用时 Bad Request：`applyOrganizePlan` 设置了 `Content-Type: application/json` 但未提供 body，Fastify 拒绝空 JSON body

### UX 优化
- 去掉 AI 整理按钮的下拉框（与窗口内整理范围选择重复），直接点击打开窗口
- AI 整理和批量 AI 分类窗口增加模板选择引导提示（非强制）
- 移除设置页"每批分类数量"配置项（AI 整理和批量分类窗口已各自提供 batch size 选择器，且值域不一致）

### 任务详情页重构
- 为 `ai_organize` 类型 job 新增独立的任务详情展示区域，与书签有效性检查任务模板区分开来
- 展示各书签的分类建议（不管是否已应用）、应用/未应用/跳过/失败统计、关联 plan 状态
- 后端扩展 job 详情接口，返回 plan 的 assignments 数据

## Capabilities

### New Capabilities
- `ai-organize-task-detail`: AI 整理任务的独立详情页展示，包含分类建议列表、应用状态统计、plan 关联信息，与书签有效性检查任务模板区分

### Modified Capabilities
- `category-template-system`: 模板选择器分组展示、移除预置模板复制按钮、新建模板增加"基于预置模板"选项、窗口尺寸加大及防误触
- `ai-organize-ui`: AI 整理窗口增加任务详情按钮、去掉外层下拉框、增加模板引导提示、移除设置页 batch size 配置
- `ai-classify-multi-entry`: 修复书签 ID 类型不匹配导致的"无有效书签 ID"错误、批量分类窗口增加模板引导提示
- `ai-organize-engine`: 修复 job total/processed 未同步更新导致的进度不同步

## Impact

- **前端**: `views/index.ejs`（模板选择器、模板编辑器、AI 整理窗口、批量分类窗口）、`public/app.js`（JS 逻辑）、`views/job.ejs`（任务详情页）、`views/settings.ejs`（移除 batch size 配置）
- **后端**: `src/routes/ai.ts`（bookmark_ids 类型转换）、`src/ai-organize.ts`（job 进度同步）、`src/routes/index.ts`（job 详情接口扩展，返回 plan assignments）
- **API**: 无新增 API，仅扩展 `GET /jobs/:id` 返回数据（对 `ai_organize` 类型附加 plan assignments）
