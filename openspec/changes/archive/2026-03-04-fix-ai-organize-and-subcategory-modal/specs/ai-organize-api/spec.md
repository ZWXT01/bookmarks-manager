## MODIFIED Requirements

### Requirement: Start organize
系统 SHALL 提供 `POST /api/ai/organize` 端点启动整理流程，创建 Plan 并触发 Phase 1（特征提取 + AI 分类树设计）。

#### Scenario: Start with AI auto-design success
- **WHEN** 客户端调用 `POST /api/ai/organize`，AI 设计分类树成功
- **THEN** 返回 `{ success: true, planId, treeReady: true }`

#### Scenario: Start with AI auto-design failure
- **WHEN** 客户端调用 `POST /api/ai/organize`，`designCategoryTree()` 抛出异常
- **THEN** plan 保留在 `designing` 状态，返回 `{ success: true, planId, treeReady: false, message: e.message }`，响应中不包含 `mode` 字段

#### Scenario: Start with scope parameter
- **WHEN** 客户端调用 `POST /api/ai/organize` 且 `scope` 为 `uncategorized`
- **THEN** Phase 2 仅处理未分类书签；`scope` 为 `all` 时处理所有书签

#### Scenario: Missing AI config
- **WHEN** AI 配置（base_url/api_key/model）未设置
- **THEN** 返回 400 错误，提示配置 AI

### Requirement: Create category with style
`POST /api/categories` SHALL 支持在创建子分类和一级分类时透传 `icon` 和 `color` 参数。

#### Scenario: Create subcategory with icon and color
- **WHEN** 客户端调用 `POST /api/categories`，body 含 `name`、`parent_id`、`icon`、`color`
- **THEN** 系统调用 `createSubCategory(db, name, parentId, { icon, color })`，返回创建的分类

#### Scenario: Create top category with icon and color
- **WHEN** 客户端调用 `POST /api/categories`，body 含 `name`（无 `parent_id`），`icon`、`color`
- **THEN** 系统调用 `createTopCategory(db, name, { icon, color })`，返回创建的分类

#### Scenario: Path format creation ignores icon/color
- **WHEN** 客户端调用 `POST /api/categories`，body 含路径格式 `name`（如 "技术/编程"）和 `icon`/`color`
- **THEN** 系统调用 `getOrCreateCategoryByPath(db, name)`，不透传 `icon`/`color`

#### Scenario: Create category without icon/color
- **WHEN** 客户端调用 `POST /api/categories`，body 不含 `icon`/`color`
- **THEN** 行为与修改前一致，`icon`/`color` 默认为 `null`
