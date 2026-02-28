## Why

当前 AI 书签管理采用"先分类→再精简"两步式设计，6 个 AI 文件 + 3 张建议表实现。AI 分类时自由创建分类导致分类爆炸（30+），精简步骤试图修复但引入更多复杂度。多次执行分类/精简、逐条应用/批量应用等操作叠加下，中间状态难以追踪，数据丢失风险高。需要一个"化繁为简"的方案，将分类设计和书签归类统一为一个连贯流程。

## What Changes

- **BREAKING** 删除现有 AI 分类系统：移除 `src/ai-classifier.ts`、`src/ai-classify-job.ts`、`src/ai-classify-level.ts`、`src/ai-simplify-job.ts`、`src/ai-simplify-level.ts` 共 5 个文件
- **BREAKING** 删除 3 张建议表：`ai_classification_suggestions`、`ai_simplify_suggestions`、`ai_level_simplify_suggestions`
- **BREAKING** 替换 `src/routes/ai.ts` 中现有 8 个 AI 路由为新的整理 API
- 新增"AI 书签整理"一体化流程：AI 生成分类树草案 → 用户编辑确认 → AI 批量归类（选择题模式）→ Diff 预览（含冲突检测 + 手动修改）→ 原子应用
- 新增 `src/ai-organize.ts`（AI 引擎：特征提取、分类树设计、批量归类，可配置重试策略）
- 新增 `src/ai-organize-plan.ts`（Plan 管理：状态机含 failed/error 状态、Diff 计算、冲突检测、原子应用、24h 回滚窗口、Plan 清理策略）
- 新增 `ai_organize_plans` 数据库表
- 修改 `public/app.js` 和 `views/index.ejs` 中 AI 交互部分的前端逻辑和 UI

## Capabilities

### New Capabilities

- `ai-organize-plan`: Plan 生命周期管理——状态机（designing/assigning/preview/applied/canceled/rolled_back/failed/error）、分类树编辑（含数量/命名校验）、Diff 计算（三层粒度）、冲突检测、原子应用（智能复用现有分类）、24h 回滚窗口、Plan 清理（保留最近 5 个）
- `ai-organize-engine`: AI 整理引擎——本地特征提取、AI 分类树设计（含现有分类参考）、批量归类（scope: all/uncategorized/category、可配置重试、失败批次跳过、未归类标记 needs_review）
- `ai-organize-api`: 整理 API 路由——启动整理、Plan 详情+进度、编辑分类树、apply（含冲突解决）、rollback、cancel、retry
- `ai-organize-ui`: 前端整理交互——scope 选择、分类树编辑器、归类进度、Diff 预览（汇总+钻取+手动修改）、冲突解决界面、回滚控件、failed 状态处理

### Modified Capabilities

（无现有 spec 需要修改）

## Impact

- 后端：删除 5 个 AI 文件，新增 2 个，重写 `src/routes/ai.ts`
- 前端：`public/app.js` 和 `views/index.ejs` 中 AI 相关的 modal、按钮、交互逻辑需替换
- 数据库：删除 3 张表，新增 1 张 `ai_organize_plans` 表
- 不受影响：`src/category-service.ts`、`src/routes/categories.ts`、`src/routes/bookmarks.ts`、`src/exporter.ts`、`src/importer.ts`、`src/index.ts`、`extension-new/popup.js`、`src/jobs.ts`
- 分类层级：保持现有 2 级层级（一级/二级）不变
