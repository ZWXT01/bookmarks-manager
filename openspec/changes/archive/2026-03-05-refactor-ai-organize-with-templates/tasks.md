## 1. 数据库迁移

- [x] 1.1 在 `src/db.ts` 中新增 `category_templates` 表（id, name, type, tree, is_active, created_at, updated_at）
- [x] 1.2 在 `src/db.ts` 中新增 `template_snapshots` 表（template_id, bookmark_id, category_path，复合主键，外键 CASCADE）
- [x] 1.3 编写 4 版预置模板种子数据（综合通用版、开发者版、生活娱乐版、极简版），在迁移中以 `INSERT OR IGNORE` 插入
- [x] 1.4 迁移时将现有 `designing` 状态的 `ai_organize_plans` 记录标记为 `canceled`
- [x] 1.5 在 `ai_organize_plans` 表新增 `template_id` 列（NOT NULL，外键引用 `category_templates(id)`）

## 2. 模板服务层

- [x] 2.1 新建 `src/template-service.ts`，实现模板 CRUD 函数（listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate）
- [x] 2.2 实现 `validateTree(tree, type)` 函数：preset 校验 depth≤2、一级≤20、二级≤10；custom 仅校验 depth≤2；通用规则：名称 trim 后非空、禁止 `/`、同层禁止重名
- [x] 2.3 实现 `applyTemplate()` 函数：单事务内完成保存快照 → 清空 categories → 创建新分类 → 恢复快照 → 更新 is_active
- [x] 2.4 实现 `saveSnapshot()` 函数：将当前激活模板的书签-分类映射写入 template_snapshots
- [x] 2.5 实现 `restoreSnapshot()` 函数：从 template_snapshots 恢复书签分布，按 `category_path` trim 后精确匹配，路径不匹配的书签保持未分类

## 3. 模板 API 路由

- [x] 3.1 新建 `src/routes/templates.ts`，注册 `GET /api/templates`（列表，不含 tree）和 `GET /api/templates/:id`（详情，含 tree）
- [x] 3.2 实现 `POST /api/templates`（创建自定义模板）和 `PUT /api/templates/:id`（更新，仅 custom 类型）
- [x] 3.3 实现 `DELETE /api/templates/:id`（删除，仅 custom 且非 active）
- [x] 3.4 实现 `POST /api/templates/:id/apply`（应用模板，调用 applyTemplate）

## 4. Plan 状态机重构

- [x] 4.1 修改 `src/ai-organize-plan.ts`：`PlanStatus` 类型移除 `designing`，`ACTIVE_STATUSES` 改为仅 `['assigning']`
- [x] 4.2 修改 `createPlan()`：初始状态改为 `assigning`，活跃检查仅检查 `assigning` 状态（`preview` 不阻塞），创建时记录当前激活模板的 `template_id`
- [x] 4.3 修改 `canTransition()`：移除 `designing` 相关转换，更新状态变更日志的初始 reason
- [x] 4.4 修改 `computeDiff()`：移除新增/删除分类的 diff 逻辑，改为仅计算书签移动和变空分类
- [x] 4.5 实现 `recoverStalePlans()`：服务启动时将所有 `assigning` 状态 Plan 标记为 `error`，关联 Job 标记为 `failed`（reason: `server_restart`）
- [x] 4.6 修改 `applyPlan()`：若 Plan 的 `template_id` 与当前激活模板不同，先自动调用 `applyTemplate(plan.template_id)` 切换模板，再执行应用操作
- [x] 4.7 修改 `applyPlan()`：`needs_review` 书签的 `category_id` 设为 NULL
- [x] 4.8 修改 `confirmEmpty()`：重新校验空分类集合（确认时仍为空且为叶子分类），未提交的空分类 ID 默认保留（keep）

## 5. AI 分类引擎重构

- [x] 5.1 修改 `src/ai-organize.ts`：将 `designCategoryTree()` 和 `extractFeatures()` 从主流程移除（保留函数但不导出/不调用）
- [x] 5.2 重写 `assignBookmarks()` 的 AI prompt：从"目标分类树选择题"改为"当前 categories 列表匹配"，请求/响应格式按 design.md D5 规范
- [x] 5.3 修改 `assignBookmarks()` 支持用户可选的批次大小参数（10/20/30，默认 20）
- [x] 5.4 修改 AI 返回验证逻辑：分类路径不在 categories 列表中的标记为 `needs_review`，空字符串也标记为 `needs_review`

## 6. 多入口 AI 分类后端

- [x] 6.1 在 `src/routes/ai.ts` 中新增 `POST /api/ai/classify-batch` 端点：接收 bookmark_ids + batch_size（校验 ∈ {10,20,30}，否则 400），检查激活模板，创建 Plan（记录 template_id）并启动 Job
- [x] 6.2 重构 `POST /api/ai/organize` 端点：移除 designCategoryTree 调用，改为直接创建 assigning 状态的 Plan
- [x] 6.3 修改 `GET /api/ai/organize/active`：仅返回 `assigning` 状态的 plan
- [x] 6.4 新增 `GET /api/ai/organize/pending` 端点：返回所有 `preview` 状态的 Plan 列表
- [x] 6.5 修改 `POST /api/ai/organize/:planId/apply`：增加空分类检测，返回 `empty_categories` 和 `needs_confirm`
- [x] 6.6 新增 `POST /api/ai/organize/:planId/apply/confirm-empty` 端点：处理用户对空分类的删除/保留决定
- [x] 6.7 在服务启动入口（`src/index.ts` 或 `src/app.ts`）调用 `recoverStalePlans()`，确保重启后清理残留 assigning Plan

## 7. 前端：模板管理侧边栏 UI

- [x] 7.1 在 `views/index.ejs` 侧边栏分类树上方添加模板管理区域（显示当前激活模板名称 / 无模板提示）
- [x] 7.2 在 `public/app.js` 中添加模板相关状态变量和 API 调用函数（loadTemplates, applyTemplate, createTemplate, updateTemplate, deleteTemplate）
- [x] 7.3 实现模板选择面板（弹窗/下拉）：列出所有模板，显示名称、类型标签、一级分类数量，"应用"按钮带确认对话框
- [x] 7.4 实现模板编辑面板：修改名称和分类树（增删改一级/二级分类），支持"复制为自定义"和"新建空模板"
- [x] 7.5 添加 beta 功能入口按钮："AI 设计模板 (Beta)"和"AI 改造模板 (Beta)"，点击显示 toast 提示

## 8. 前端：多入口 AI 分类 UI

- [x] 8.1 重构工具栏"AI 整理"按钮为下拉菜单：包含"全部书签"和"未分类书签"选项
- [x] 8.2 在批量操作栏（选中书签后显示的操作条）中添加"AI 分类"按钮
- [x] 8.3 在单个书签操作菜单中添加"AI 分类"选项
- [x] 8.4 实现批次大小选择器（10/20/30，默认 20），在启动 AI 分类前显示
- [x] 8.5 实现统一的 `startClassifyBatch(bookmarkIds, batchSize)` 前端函数，所有入口调用此函数

## 9. 前端：AI 整理流程 UI 重构

- [x] 9.1 移除 `organizePhase === 'designing'` 和 `organizePhase === 'editing'` 相关 UI（分类树编辑器模板）
- [x] 9.2 重构 AI 整理 Modal：移除分类树编辑阶段，直接从范围选择进入 assigning 进度显示
- [x] 9.3 修改 Diff 预览阶段：增加空分类确认 UI（列出空分类，每个旁有"删除"/"保留"选择）
- [x] 9.4 实现待应用任务列表 UI：显示所有 `preview` 状态的 Plan，可点击查看详情或应用

## 10. 任务详情页改造

- [x] 10.1 修改 `views/job.ejs`：`ai_classify` 类型的分类建议表格移除"操作"列（单个应用按钮）
- [x] 10.2 修改 `views/job.ejs`："一键应用全部"按钮改为"应用"
- [x] 10.3 清理 `views/job.ejs` 中 `ai_simplify` 类型的精简建议 UI 代码

## 11. Bug 修复

- [x] 11.1 修复 `views/settings.ejs`：AI 预设下拉框选择后移除 `this.value = ''`，保持选中状态显示

## 12. 代码清理

- [x] 12.1 清理 `src/ai-organize.ts` 中 `designCategoryTree()` / `extractFeatures()` 的导出和主流程调用
- [x] 12.2 清理 `public/app.js` 中旧的 AI 分类/精简相关函数（aiClassifyOne 等废弃方法）
- [x] 12.3 清理 `views/index.ejs` 中旧的 AI 分类/精简 Modal 和按钮
- [x] 12.4 移除 `src/routes/ai.ts` 中 `PUT /api/ai/organize/:planId/tree` 路由
