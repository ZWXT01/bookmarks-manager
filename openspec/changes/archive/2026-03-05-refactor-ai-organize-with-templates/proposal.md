## Why

当前 AI 整理功能采用"AI 自动设计分类树 → 用户编辑 → AI 批量归类"的流程，存在以下问题：AI 设计的分类树质量不稳定且不可复用，用户无法预定义自己偏好的分类体系；整理入口单一（仅工具栏按钮），无法对选中的单个/多个书签进行 AI 分类；同时只能有一个活跃任务，且任务详情页的单个书签应用按钮与整体应用的事务一致性冲突。需要重构为基于分类模板的 AI 匹配系统，提供多入口分类能力和更好的事务控制。

## What Changes

### 新增：分类模板系统
- 新增 `category_templates` 数据库表，存储预置模板和用户自定义模板
- 提供 4 版预置模板（综合通用版、开发者版、生活娱乐版、极简版），作为种子数据插入
- 用户可自定义模板，也可基于预置模板复制编辑后另存为自定义模板
- 新增 `template_snapshots` 数据库表，存储每个模板下的书签-分类映射快照
- 应用模板时完全替换当前 `categories` 表，所有书签变为未分类
- 切换模板时保存当前模板的书签分布快照，切回已用过的模板时从快照恢复书签分布
- 模板管理 UI 放在主页侧边栏分类树上方
- 预留 beta 功能入口：AI 设计模板、AI 改造模板

### 重构：AI 分类流程
- **BREAKING** 移除 AI 自动设计分类树功能（`designCategoryTree()`、`extractFeatures()`）从主流程
- AI 分类改为：分批发送书签（URL/标题）+ 当前已有分类 → AI 联网匹配最合适的分类
- 用户未选择/应用模板时提示先配置模板
- 用户可选择每批分类数量（10/20/30）
- 严格规范 AI 请求/响应 JSON 格式，无匹配则放入未分类
- 状态机从 `designing → assigning → preview → applied` 简化为 `assigning → preview → applied`

### 新增：多入口 AI 分类
- AI 整理按钮内提供"全部书签"/"未分类书签"两种选择
- 选中单个/多个书签后可进行批量 AI 分类
- 单个书签操作菜单增加"AI 分类"选项
- 本页书签 AI 分类
- 书签操作类（批量操作栏）添加 AI 分类选项

### 修改：多任务策略
- **BREAKING** 允许多个已完成（`preview` 状态）的任务并存待应用
- 同时只能有一个正在执行（`assigning` 状态）的任务
- 应用时同一书签出现在多个任务中，后创建的任务覆盖先创建的
- 应用后书签被移走导致旧分类变空时，列出空分类让用户确认删除或保留

### 修改：任务详情页
- 去掉单个书签的"应用建议"按钮
- 仅展示每个书签的建议分类
- "应用全部"按钮改为"应用"

### Bug 修复
- `views/settings.ejs`：AI 分类快捷预设选择 OpenAI/其他后，下拉框显示仍是"快捷预设"而非选中项（`this.value = ''` 重置了选中值）

### 清理
- 移除 `designing` 阶段相关 UI（分类树编辑器）
- 清理 `ai_classify`/`ai_simplify` 相关废弃代码（`views/job.ejs` 中的旧建议表格和应用按钮）

## Capabilities

### New Capabilities
- `category-template-system`: 分类模板的数据库存储、预置模板种子数据、模板 CRUD API、模板应用/切换逻辑（含快照保存与恢复）、模板管理侧边栏 UI
- `ai-classify-multi-entry`: 多入口 AI 分类触发机制——AI 整理按钮（全部/未分类）、选中书签批量分类、单个书签操作菜单 AI 分类、本页书签分类、批量操作栏 AI 分类选项

### Modified Capabilities
- `ai-organize-engine`: 移除 `designCategoryTree()`/`extractFeatures()` 从主流程，重写 `assignBookmarks()` 的 prompt 为基于已有分类的匹配模式，支持用户可选的批次大小（10/20/30）
- `ai-organize-plan`: 状态机移除 `designing` 阶段，允许多个 `preview` 状态任务并存（执行串行），应用时后者覆盖前者，空分类用户确认删除
- `ai-organize-api`: 路由重构——移除 `POST /api/ai/organize`（旧的自动设计流程），新增模板相关 API 路由，新增多入口分类启动路由，修改应用路由支持空分类确认
- `ai-organize-ui`: 移除分类树编辑器 UI，新增多入口分类 UI，任务详情页改造（去掉单个应用按钮，"应用全部"改为"应用"），清理 `ai_classify`/`ai_simplify` 废弃 UI 代码

## Impact

- **数据库**：新增 `category_templates` 表和 `template_snapshots` 表（`src/db.ts`）；`ai_organize_plans` 表逻辑变更（允许多个 preview 并存）
- **后端**：`src/ai-organize.ts`（移除 designCategoryTree/extractFeatures，重写 assignBookmarks prompt）、`src/ai-organize-plan.ts`（状态机变更、多任务并存、空分类确认）、`src/routes/ai.ts`（路由重构、新增模板 API）、`src/category-service.ts`（模板应用/切换逻辑）
- **前端**：`public/app.js`（模板管理、多入口 AI 分类、任务详情改造）、`views/index.ejs`（侧边栏模板管理 UI、多入口 UI）、`views/settings.ejs`（预设下拉框 bug 修复）、`views/job.ejs`（任务详情页改造）
- **API 变更**：新增模板 CRUD 路由（`GET/POST/PUT/DELETE /api/templates`）、新增模板应用路由（`POST /api/templates/:id/apply`）、新增多入口分类启动路由（`POST /api/ai/classify-batch`）、修改 `POST /api/ai/organize/:planId/apply` 响应增加空分类确认流程
