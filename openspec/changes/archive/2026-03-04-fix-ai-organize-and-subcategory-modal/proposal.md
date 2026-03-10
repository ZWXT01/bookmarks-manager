## Why

AI 整理功能存在关键 Bug：点击"开始整理"后，当 AI 调用失败（API key 无效、网络错误、模型名错误等），后端吞掉异常并返回 `success: true`，前端无条件跳到分类树编辑阶段，导致用户看到空的分类树草案，整理功能形同虚设。同时，添加子分类时使用浏览器原生 `prompt()` 弹窗，与应用整体 UI 风格不一致，且缺少图标/颜色等样式设置项。

## What Changes

### Bug 修复：AI 整理功能未生效

**后端** `src/routes/ai.ts:94-99`：当 `designCategoryTree()` 抛出异常时，当前代码返回 `{ success: true, planId, mode: 'manual' }`，前端未检查 `mode` 字段，导致静默失败。

修复方案：
- 后端：AI 设计分类树失败时，仍保留 plan（状态为 `designing`），响应中移除 `mode` 字段，改为 `treeReady: false` + `message: e.message`；成功路径增加 `treeReady: true`
- 前端 `public/app.js` `startOrganize()`：检查 `data.treeReady === false`，toast 提示 `data.message`（前端 toast 逻辑改为读取 `data.message || data.error`），仍跳到 editing 阶段允许手动编辑

### UI 优化：分类创建弹窗（统一子分类和一级分类）

**当前问题**：`public/app.js:980` 的 `createSubCategory()` 使用 `prompt('请输入二级分类名称:')` 浏览器原生弹窗；一级分类创建使用内联输入框，两者均不支持 icon/color 设置。

修复方案：
- 在 `views/index.ejs` 中新增统一的分类创建弹窗（复用 `showCategoryStyleModal` 的 UI 模式），包含：名称输入框、图标选择（复用现有 emoji grid）、颜色选择（复用现有 color grid）
- 弹窗同时用于子分类创建（侧边栏 `+` 按钮）和一级分类创建（替换现有内联输入框为"+ 添加分类"按钮）
- 在 `public/app.js` 中新增弹窗状态变量和方法，替换 `prompt()` 调用和 `createCategory()` 内联逻辑
- 后端 `POST /api/categories` 路由（`src/routes/categories.ts:52-93`）从 body 提取 `icon`/`color`，透传给 `createSubCategory()` 和 `createTopCategory()`（路径格式创建不透传）

## Capabilities

### Modified Capabilities
- `ai-organize-ui`: 修复 AI 设计分类树失败时前端静默跳到空编辑阶段的 Bug，增加失败提示和重试引导
- `ai-organize-api`: 后端 AI 设计分类树失败时响应中增加 `treeReady` 标记和失败原因

### New Capabilities
- `category-create-modal`: 统一的分类创建弹窗，替换浏览器原生 `prompt()` 和内联输入框，支持名称、图标、颜色设置，同时用于子分类和一级分类创建

## Impact

- **前端**：`public/app.js`（`startOrganize` 方法增加 treeReady 检查；新增 `showCreateCategoryModal` 相关状态和方法；`createSubCategory` 和 `createCategory` 统一改用弹窗；移除 `newCategoryName` 状态变量）、`views/index.ejs`（新增分类创建弹窗 HTML；移除内联输入框；侧边栏 `+` 按钮改调弹窗）
- **后端**：`src/routes/ai.ts`（`POST /api/ai/organize` 响应增加 `treeReady` 字段、移除 `mode` 字段）、`src/routes/categories.ts`（`POST /api/categories` 透传 icon/color）
- **无数据库变更**：无 schema 迁移
