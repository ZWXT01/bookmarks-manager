## ADDED Requirements

### Requirement: Start organize
系统 SHALL 提供 `POST /api/ai/organize` 端点启动整理流程，创建 Plan 并触发 Phase 1（特征提取 + AI 分类树设计）。

#### Scenario: Start with AI auto-design
- **WHEN** 客户端调用 `POST /api/ai/organize` 且 `mode` 为 `auto`
- **THEN** 系统创建 Plan，执行特征提取，调用 AI 设计分类树，返回 `{ planId, jobId }`

#### Scenario: Start with manual design
- **WHEN** 客户端调用 `POST /api/ai/organize` 且 `mode` 为 `manual`
- **THEN** 系统创建空 Plan（无目标分类树），返回 `{ planId }`，等待用户手动编辑分类树

#### Scenario: Start with scope parameter
- **WHEN** 客户端调用 `POST /api/ai/organize` 且 `scope` 为 `uncategorized`
- **THEN** Phase 2 仅处理未分类书签；`scope` 为 `all` 时处理所有书签

#### Scenario: Missing AI config
- **WHEN** AI 配置（base_url/api_key/model）未设置
- **THEN** 返回 400 错误，提示配置 AI

### Requirement: Get plan details
系统 SHALL 提供 `GET /api/ai/organize/:planId` 端点返回 Plan 详情，包括目标分类树、归类进度、Diff 预览。

#### Scenario: Get plan in designing status
- **WHEN** 客户端请求处于 `designing` 状态的 Plan
- **THEN** 返回 Plan 基本信息和目标分类树（可能为空或 AI 生成的草案）

#### Scenario: Get plan in preview status
- **WHEN** 客户端请求处于 `preview` 状态的 Plan
- **THEN** 返回 Plan 完整信息，包括 Diff 摘要（新增分类数、移动书签数、删除分类数）

#### Scenario: Plan not found
- **WHEN** 客户端请求不存在的 Plan ID
- **THEN** 返回 404 错误

### Requirement: Edit plan tree
系统 SHALL 提供 `PUT /api/ai/organize/:planId/tree` 端点允许用户编辑 Plan 的目标分类树。

#### Scenario: Update target tree
- **WHEN** 客户端发送新的分类树 JSON
- **THEN** 系统验证层级不超过 2 级，更新 Plan 的目标分类树

#### Scenario: Confirm tree and start assignment
- **WHEN** 客户端发送 `{ confirm: true }` 参数
- **THEN** 系统锁定分类树，Plan 状态变为 `assigning`，启动 Phase 2 批量归类 Job

### Requirement: Apply plan
系统 SHALL 提供 `POST /api/ai/organize/:planId/apply` 端点原子应用 Plan。

#### Scenario: Apply plan
- **WHEN** 客户端调用 apply 端点
- **THEN** 系统在单事务中应用所有变更，返回应用结果摘要

### Requirement: Rollback plan
系统 SHALL 提供 `POST /api/ai/organize/:planId/rollback` 端点回滚已应用的 Plan。

#### Scenario: Rollback plan
- **WHEN** 客户端调用 rollback 端点
- **THEN** 系统从备份快照恢复，返回回滚结果

### Requirement: Cancel plan
系统 SHALL 提供 `POST /api/ai/organize/:planId/cancel` 端点取消进行中的 Plan。

#### Scenario: Cancel active plan
- **WHEN** 客户端调用 cancel 端点
- **THEN** 系统取消关联的 Job（如有），Plan 状态变为 `canceled`
