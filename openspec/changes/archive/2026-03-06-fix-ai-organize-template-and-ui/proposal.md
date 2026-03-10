## Why

AI 整理任务、模板系统和全局 UI 存在多个交互缺陷和逻辑错误，影响用户体验和数据一致性。主要问题包括：整理计划的应用流程未绑定正确模板、空分类检测逻辑过于激进导致误删、浏览器原生弹窗破坏 UI 一致性、批量处理结果无法增量显示、以及多处导航和分页行为不符合预期。

## What Changes

### AI 整理计划流程修正
- R1: 将待应用的整理计划和 Diff 预览从 AI 整理弹窗（`views/index.ejs`）移至任务详情页（`views/job.ejs`），由用户在任务详情中决定是否应用
- R2: 确保放弃 Diff 预览后，待应用的整理计划仍保留在任务详情中（当前行为已正确，需在重构中保持）
- R3: 应用整理计划时，基于计划创建时绑定的模板（`plan.template_id`）的分类列表进行冲突解决，而非当前活跃模板；冲突解决 UI 显示目标模板名称；删除模板时级联删除其关联的 AI 整理任务（`ai_organize_plans` 中 `template_id` 匹配的记录及关联 `jobs`）
- R10: 批量处理过程中，通过 SSE 实时推送每批完成的分类结果到前端，增量追加显示，而非等待全部完成
- R11: 修正 `src/ai-organize-plan.ts` 中 `applyPlan()` 的空分类检测逻辑——仅检查书签移出的源分类是否为空（源为"未分类"则忽略），不再全局扫描所有空叶子分类

### 模板系统修正
- R4/R5: 修正预置模板种子数据中含 `/` 的分类名：`UI/UX` → `UI&UX`，`JavaScript/TypeScript` → `JavaScript&TypeScript`，`CI/CD` → `CI&CD`（`src/db.ts` 中 `seedPresetTemplates`）
- R7: 模板编辑弹窗的取消按钮和 X 按钮在有未保存修改时也触发确认提示（当前仅 ESC 触发）
- R12: 预置模板增加「重置」按钮，行为为恢复预置分类列表并清空所有书签分布（书签变为未分类）

### 全局 UI 改进
- R6: 将项目中所有浏览器原生 `confirm()` 和 `alert()` 替换为符合当前 UI 风格的自定义弹窗组件（涉及 `public/app.js`、`views/index.ejs`、`views/job.ejs`、`views/jobs.ejs`、`views/settings.ejs`、`views/snapshots.ejs`，共 30+ 处）
- R8: AI 整理任务详情页中分类建议（assignments）和失败项的翻页改为 AJAX 无刷新分页，与现有 suggestions 分页方式一致
- R9: AI 整理任务详情页中，如无失败项则隐藏失败项组件
- R13: 任务详情页返回按钮根据来源页面动态导航——从任务列表进入则返回任务列表，从首页进入则返回首页；检查并修正其他类似硬编码导航

## Capabilities

### New Capabilities
- `custom-dialog-system`: 全局自定义弹窗组件，替换所有浏览器原生 `confirm()` 和 `alert()`，提供 Promise-based API，支持确认/取消和纯提示两种模式

### Modified Capabilities
- `ai-organize-plan`: 修正空分类检测逻辑（仅检查源分类）；应用计划时基于 `plan.template_id` 绑定的模板进行冲突解决
- `ai-organize-task-detail`: 将整理计划预览和应用流程移至任务详情页；assignments 和 failures 改为 AJAX 分页；无失败项时隐藏失败项组件；SSE 增量推送批次结果
- `ai-organize-ui`: 从主页弹窗中移除计划预览和应用相关 UI（这些移至任务详情页）
- `category-template-system`: 修正预置种子数据中含 `/` 的分类名；模板编辑弹窗取消/X 按钮增加未保存检查；预置模板增加重置按钮；删除模板时级联删除关联 AI 整理任务

## Impact

### 后端文件
- `src/ai-organize-plan.ts`: `applyPlan()` 空分类检测逻辑重写、`resolveAndApply()` 同步修改
- `src/template-service.ts`: `deleteTemplate()` 增加级联删除 AI 整理任务逻辑
- `src/db.ts`: `seedPresetTemplates()` 修正含 `/` 的分类名
- `src/routes/ai.ts`: SSE 增量推送批次结果、计划应用 API 返回模板信息
- `src/routes/pages.ts`: 任务详情页传递 `referer` 参数
- `src/routes/templates.ts`: 预置模板重置 API

### 前端文件
- `public/app.js`: 新增自定义弹窗组件、替换所有 `confirm()`/`alert()` 调用、模板编辑未保存检查
- `views/index.ejs`: 移除计划预览/应用 UI、模板编辑弹窗 X/取消按钮事件、预置模板重置按钮
- `views/job.ejs`: 新增计划预览/应用/冲突解决 UI、AJAX 分页、失败项条件显示、返回按钮动态导航、SSE 增量结果显示
- `views/jobs.ejs`: 替换原生弹窗
- `views/settings.ejs`: 替换原生弹窗
- `views/snapshots.ejs`: 替换原生弹窗
