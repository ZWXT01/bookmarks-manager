## ADDED Requirements

### Requirement: Create organize plan
系统 SHALL 支持创建整理计划（Plan），Plan 包含目标分类树和书签分配映射。每个 Plan 有唯一 ID 和状态生命周期。

#### Scenario: Create new plan
- **WHEN** 用户发起整理请求
- **THEN** 系统创建一个状态为 `designing` 的 Plan，返回 Plan ID

#### Scenario: Plan status lifecycle
- **WHEN** Plan 被创建
- **THEN** 状态按 `designing` → `assigning` → `preview` → `applied` 顺序流转，任何阶段可转为 `canceled`

### Requirement: Edit target category tree
系统 SHALL 允许用户在 Plan 处于 `designing` 状态时编辑目标分类树（增删改分类节点）。

#### Scenario: Add category to plan tree
- **WHEN** 用户向 Plan 的目标分类树添加一个分类节点
- **THEN** 该节点出现在目标分类树中，层级 MUST 不超过 2 级

#### Scenario: Remove category from plan tree
- **WHEN** 用户从 Plan 的目标分类树中删除一个分类节点
- **THEN** 该节点及其子节点从目标分类树中移除

#### Scenario: Reject edit on non-designing plan
- **WHEN** 用户尝试编辑状态不为 `designing` 的 Plan 的分类树
- **THEN** 系统拒绝操作并返回错误

### Requirement: Compute diff
系统 SHALL 能计算当前数据库状态与 Plan 目标态之间的差异（Diff），包括：新增分类数、删除分类数、移动书签数。

#### Scenario: Diff with category changes
- **WHEN** Plan 目标分类树与当前分类树不同
- **THEN** Diff 结果 MUST 包含新增分类列表、待删除分类列表、书签移动映射

#### Scenario: Diff with no changes
- **WHEN** Plan 目标态与当前状态完全一致
- **THEN** Diff 结果显示无变更

### Requirement: Atomic apply with backup
系统 SHALL 在单个数据库事务中应用 Plan 的所有变更。应用前 MUST 创建状态快照（备份），应用失败时 MUST 自动回滚。

#### Scenario: Successful apply
- **WHEN** 用户确认应用 Plan
- **THEN** 系统在单事务中：创建备份快照 → 创建新分类 → 移动书签 → 清理空分类，Plan 状态变为 `applied`

#### Scenario: Apply failure rollback
- **WHEN** 应用过程中任何步骤失败
- **THEN** 整个事务回滚，数据库状态不变，Plan 状态保持 `preview`

#### Scenario: Apply only in preview status
- **WHEN** 用户尝试应用状态不为 `preview` 的 Plan
- **THEN** 系统拒绝操作并返回错误

### Requirement: Manual rollback
系统 SHALL 支持对已应用的 Plan 进行手动回滚，恢复到应用前的备份快照。

#### Scenario: Rollback applied plan
- **WHEN** 用户对状态为 `applied` 的 Plan 执行回滚
- **THEN** 系统从备份快照恢复分类和书签分配，Plan 状态变为 `rolled_back`

#### Scenario: Reject rollback on non-applied plan
- **WHEN** 用户尝试回滚状态不为 `applied` 的 Plan
- **THEN** 系统拒绝操作并返回错误

### Requirement: Plan data storage
系统 SHALL 使用 `ai_organize_plans` 表存储 Plan 数据，包含：id、job_id、status、target_tree（JSON）、assignments（JSON）、diff_summary（JSON）、backup_snapshot（JSON）、created_at、applied_at。

#### Scenario: Plan persistence
- **WHEN** Plan 被创建或更新
- **THEN** 所有字段 MUST 持久化到 `ai_organize_plans` 表
