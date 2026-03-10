## Context

书签管理器前端使用 Alpine.js + EJS 模板，后端为 Fastify + better-sqlite3。AI 整理功能在 `designCategoryTree()` 失败时静默返回空树，前端无法区分成功与失败。子分类创建使用浏览器原生 `prompt()`，与应用 UI 风格不一致。

## Goals / Non-Goals

**Goals:**
- 修复 AI 设计分类树失败时前端静默跳到空编辑阶段的 Bug
- 统一分类创建体验：替换子分类的浏览器原生 `prompt()` 和一级分类的内联输入框为统一的自定义弹窗，支持名称、图标、颜色

**Non-Goals:**
- 不重构 AI 整理的后端状态机逻辑
- 不修改 `designCategoryTree()` 的 AI 调用逻辑本身
- 不改动数据库 schema

## Decisions

### D1: AI 设计分类树失败时的响应策略

后端 `src/routes/ai.ts:94-99` 的 catch 块当前返回 `{ success: true, planId, mode: 'manual' }`。

修改为：
- 成功路径（L101）：返回 `{ success: true, planId, treeReady: true }`
- 失败路径（catch 块）：返回 `{ success: true, planId, treeReady: false, message: e.message }`
- 移除 `mode` 字段，`treeReady` 完全替代其语义
- plan 保留在 `designing` 状态

前端 `public/app.js` `startOrganize()` 在收到响应后检查 `data.treeReady === false`，若为 false 则 toast 提示 `data.message`（前端 toast 逻辑改为读取 `data.message || data.error`），仍跳到 editing 阶段（允许手动编辑），但用户明确知道 AI 未生效。

理由：保留 plan 允许用户手动编辑，比直接失败更灵活。关键是让用户知道发生了什么，而非静默跳过。

### D2: 分类创建弹窗（统一子分类和一级分类）

复用 `showCategoryStyleModal`（`views/index.ejs:640-678`）的 UI 模式，新增统一的 `showCreateCategoryModal` 弹窗，同时用于子分类创建（侧边栏 `+` 按钮）和一级分类创建（替换现有内联输入框）：
- 名称输入框（必填）
- 图标选择（复用现有 emoji grid：📁📂📄📝📚🔖⭐❤️🎮🎵🎬📷💻🌐🛠️📱）
- 颜色选择（复用现有 color grid：空/#ef4444/#f97316/#eab308/#22c55e/#14b8a6/#3b82f6/#8b5cf6/#ec4899）
- 取消/确认按钮
- 弹窗标题根据 `parentId` 动态显示："添加子分类"（有 parentId）或"添加分类"（无 parentId）

新增状态变量：`showCreateCategoryModal`、`createCategoryParentId`、`createCategoryName`、`createCategoryIcon`、`createCategoryColor`。

入口变更：
- 侧边栏 `+` 按钮（`views/index.ejs:193`）：`createSubCategory(cat.id)` → `openCreateCategoryModal(cat.id)`
- 顶部一级分类创建（`views/index.ejs:254-257`）：移除内联输入框 + 按钮，改为单个"+ 添加分类"按钮调用 `openCreateCategoryModal(null)`
- 移除 `newCategoryName` 状态变量（被弹窗状态替代）

### D3: 后端 POST /api/categories 透传 icon/color

`src/routes/categories.ts:52-93` 的 `POST /api/categories` 路由当前未传递 `icon`/`color` 给 service 层。`createSubCategory()`（`src/category-service.ts:265`）和 `createTopCategory()`（`src/category-service.ts:250`）已支持 `options?: { icon, color }`。

修改路由：从 `body` 中提取 `icon` 和 `color`，仅透传给 `createSubCategory()` 和 `createTopCategory()`。路径格式创建（`getOrCreateCategoryByPath`）不透传，因其为批量/路径创建场景，不适合设置样式。

## Property-Based Testing Invariants

### D1: POST /api/ai/organize 响应契约

- **[Invariant Preservation]** ∀ responses `r`: `'mode' ∉ keys(r)` — 响应中永远不包含 `mode` 字段。Falsification: stub `designCategoryTree` 成功/失败两条路径，断言 `r.mode === undefined`
- **[Bounds]** ∀ responses `r`: `typeof r.treeReady === 'boolean'` — `treeReady` 始终为布尔值。Falsification: fuzz AI 层返回/抛出各种值，断言 `treeReady` 不缺失且类型正确
- **[Round-trip]** `r.treeReady === true ⇒ 'message' ∉ keys(r)`；`r.treeReady === false ⇒ typeof r.message === 'string'`。Falsification: stub throw `new Error(msg)` 含随机 msg、非 Error throw（`"x"`, `42`, `{}`），断言 message 始终为 string
- **[Invariant Preservation]** `r.treeReady === false ⇒ plan.status === 'designing'` — AI 失败后 plan 状态不变。Falsification: 强制 AI 失败后读取 plan row，断言 status 未变
- **[Invariant Preservation]** `r.treeReady === false ⇒ updatePlanTree(planId, tree)` 可调用 — 因 status 仍为 `designing`。Falsification: 强制失败后立即调用 updatePlanTree，断言不被拒绝

### D3: POST /api/categories icon/color 透传

- **[Round-trip]** 非路径创建: `create({name, parentId, icon, color})` → `read(categoryId)` 返回相同 `icon`/`color`（含 null）。Falsification: 生成 `(icon, color)` 为 `null | string`（含 unicode、空串），创建后读取断言相等
- **[Invariant Preservation]** 省略字段等价于显式 null: `create({icon: undefined}) ≡ create({icon: null})`，存储值均为 NULL。Falsification: 分别发送缺失字段和显式 null 的请求，断言 DB 存储一致
- **[Invariant Preservation]** 路径创建忽略 icon/color: 对任意 `(icon, color)`，`getOrCreateCategoryByPath(path)` 创建的分类 `icon === null && color === null`。Falsification: 路径创建时传入各种 icon/color，断言新建分类的 icon/color 始终为 null

## Risks / Trade-offs

- [D1] AI 失败后仍跳到 editing 阶段，用户看到空树可能困惑 → toast 提示明确告知 AI 失败，editing 阶段已有"+ 添加一级分类"按钮支持手动操作
- [D2] 一级分类创建从内联输入框改为弹窗，增加一次点击 → 统一体验，且弹窗提供 icon/color 设置是内联输入框无法实现的
- [D3] 透传 icon/color 仅影响子分类和一级分类创建路径 → icon/color 为可选参数，不传时行为不变
