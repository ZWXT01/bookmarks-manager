## ADDED Requirements

### Requirement: Classify batch endpoint
系统 SHALL 提供 `POST /api/ai/classify-batch` 端点，接收书签 ID 列表和可选的批次大小，创建 Plan 并启动批量归类。

#### Scenario: Start classify batch
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，body 含 `{ bookmark_ids: [1,2,3], batch_size: 20 }`
- **THEN** 系统创建 Plan（scope 记录为 `custom:<count>`，记录当前激活模板的 `template_id`），创建 Job，启动 `assignBookmarks()`，返回 `{ success: true, planId }`

#### Scenario: Invalid batch_size
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，`batch_size` 不在 `{10, 20, 30}` 中
- **THEN** 返回 400 错误，提示 batch_size 必须为 10、20 或 30

#### Scenario: Missing AI config
- **WHEN** AI 配置（base_url/api_key/model）未设置
- **THEN** 返回 400 错误，提示配置 AI

#### Scenario: No active template
- **WHEN** 当前无激活模板（`category_templates` 中无 `is_active = 1` 的记录）
- **THEN** 返回 400 错误，提示先选择分类模板

### Requirement: Template CRUD routes
系统 SHALL 提供模板管理的 RESTful API 路由。

#### Scenario: GET /api/templates
- **WHEN** 客户端调用 `GET /api/templates`
- **THEN** 返回模板列表（不含 tree 字段）

#### Scenario: GET /api/templates/:id
- **WHEN** 客户端调用 `GET /api/templates/:id`
- **THEN** 返回模板完整信息（含 tree）

#### Scenario: POST /api/templates
- **WHEN** 客户端调用 `POST /api/templates`，body 含 `{ name, tree }`
- **THEN** 创建自定义模板，返回创建结果

#### Scenario: PUT /api/templates/:id
- **WHEN** 客户端调用 `PUT /api/templates/:id`，body 含 `{ name?, tree? }`
- **THEN** 更新模板（仅 custom 类型），返回更新结果

#### Scenario: DELETE /api/templates/:id
- **WHEN** 客户端调用 `DELETE /api/templates/:id`
- **THEN** 删除模板（仅 custom 且非 active），返回删除结果

#### Scenario: POST /api/templates/:id/apply
- **WHEN** 客户端调用 `POST /api/templates/:id/apply`
- **THEN** 在事务中应用模板（保存快照 → 替换分类 → 恢复快照），返回应用结果

### Requirement: Confirm empty categories endpoint
系统 SHALL 提供 `POST /api/ai/organize/:planId/apply/confirm-empty` 端点，处理用户对空分类的删除/保留决定。

#### Scenario: Confirm empty categories
- **WHEN** 客户端调用 `POST /api/ai/organize/:planId/apply/confirm-empty`，body 含 `{ decisions: [{id, action: 'delete'|'keep'}] }`
- **THEN** 系统重新校验空分类集合（确认时仍为空且为叶子分类），在事务中执行删除/保留操作，未提交的空分类 ID 默认保留（keep），Plan 状态变为 `applied`

### Requirement: List preview plans endpoint
系统 SHALL 提供 `GET /api/ai/organize/pending` 端点，返回所有 `preview` 状态的 Plan 列表。

#### Scenario: List pending plans
- **WHEN** 客户端调用 `GET /api/ai/organize/pending`
- **THEN** 返回所有 `preview` 状态的 Plan 列表（按 `created_at` 降序），每个 Plan 包含 id、scope、batches_done、batches_total、needs_review_count、created_at

## MODIFIED Requirements

### Requirement: Start organize
系统 SHALL 保留 `POST /api/ai/organize` 端点但重构其行为：不再调用 `designCategoryTree()`，改为直接创建 `assigning` 状态的 Plan。

#### Scenario: Start organize (refactored)
- **WHEN** 客户端调用 `POST /api/ai/organize`，body 含 `{ scope: 'all'|'uncategorized' }`
- **THEN** 系统检查是否有激活模板，创建 Plan（直接进入 `assigning` 状态），启动批量归类 Job，返回 `{ success: true, planId }`

#### Scenario: Missing AI config
- **WHEN** AI 配置未设置
- **THEN** 返回 400 错误

#### Scenario: No active template
- **WHEN** 无激活模板
- **THEN** 返回 400 错误，提示先选择分类模板

### Requirement: Get active plan
系统 SHALL 修改 `GET /api/ai/organize/active` 端点，仅返回 `assigning` 状态的 plan（`preview` 状态的 plan 通过 `/pending` 端点获取）。

#### Scenario: Active assigning plan exists
- **WHEN** 存在 `assigning` 状态的 plan
- **THEN** 返回该 plan 的详情

#### Scenario: No active plan
- **WHEN** 不存在 `assigning` 状态的 plan
- **THEN** 返回 `{ active: null }`

### Requirement: Apply plan
系统 SHALL 修改 `POST /api/ai/organize/:planId/apply` 端点，增加空分类确认流程。

#### Scenario: Apply plan with empty categories
- **WHEN** 应用后存在变空的分类
- **THEN** 返回 `{ success: true, applied_count, empty_categories: [{id, name}], needs_confirm: true }`，Plan 状态暂不变更

#### Scenario: Apply plan without empty categories
- **WHEN** 应用后无变空的分类
- **THEN** 返回 `{ success: true, applied_count, empty_categories: [], needs_confirm: false }`，Plan 状态变为 `applied`

### Requirement: Create category with style
`POST /api/categories` SHALL 支持在创建子分类和一级分类时透传 `icon` 和 `color` 参数。（无变更，保持现有行为）

#### Scenario: Create subcategory with icon and color
- **WHEN** 客户端调用 `POST /api/categories`，body 含 `name`、`parent_id`、`icon`、`color`
- **THEN** 系统调用 `createSubCategory(db, name, parentId, { icon, color })`，返回创建的分类

#### Scenario: Create top category with icon and color
- **WHEN** 客户端调用 `POST /api/categories`，body 含 `name`（无 `parent_id`），`icon`、`color`
- **THEN** 系统调用 `createTopCategory(db, name, { icon, color })`，返回创建的分类

## REMOVED Requirements

### Requirement: Edit plan tree
**Reason**: 分类树编辑功能已被模板系统替代。
**Migration**: 移除 `PUT /api/ai/organize/:planId/tree` 路由。

### Requirement: 409 response includes active plan ID
**Reason**: 409 逻辑变更——仅 `assigning` 状态阻塞，`preview` 不阻塞。
**Migration**: 409 仍返回 `activePlanId`，但仅在 `assigning` 状态冲突时触发。
