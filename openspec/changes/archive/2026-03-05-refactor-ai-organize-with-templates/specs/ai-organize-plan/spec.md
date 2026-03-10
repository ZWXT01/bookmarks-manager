## MODIFIED Requirements

### Requirement: Create organize plan
系统 SHALL 支持创建整理计划（Plan），Plan 包含书签分配映射。每个 Plan 有唯一 ID、状态生命周期和绑定的模板 ID。

#### Scenario: Create new plan
- **WHEN** 用户发起整理请求（通过 `POST /api/ai/classify-batch`）
- **THEN** 系统创建一个状态为 `assigning` 的 Plan，记录当前激活模板的 `template_id`（NOT NULL），同时创建关联的 Job，返回 Plan ID

#### Scenario: Plan status lifecycle
- **WHEN** Plan 被创建
- **THEN** 状态按 `assigning` → `preview` → `applied` 顺序流转，任何非终态阶段可转为 `canceled`

### Requirement: Compute diff
系统 SHALL 能计算 Plan 的归类结果与当前数据库状态之间的差异（Diff），包括：移动书签数、变空分类数。

#### Scenario: Diff with bookmark moves
- **WHEN** Plan 的 assignments 包含书签分类变更
- **THEN** Diff 结果 MUST 包含书签移动映射（from_category → to_category）和变空分类列表

#### Scenario: Diff with no changes
- **WHEN** Plan 的所有 assignments 与当前书签分类一致
- **THEN** Diff 结果显示无变更

### Requirement: Atomic apply with backup
系统 SHALL 在单个数据库事务中应用 Plan 的所有变更。应用前 MUST 创建状态快照（备份），应用失败时 MUST 自动回滚。

#### Scenario: Successful apply
- **WHEN** 用户确认应用 Plan
- **THEN** 系统在单事务中：若 Plan 的 `template_id` 与当前激活模板不同，先自动切换模板（触发快照保存/恢复）→ 创建备份快照 → 移动书签到目标分类（`needs_review` 书签的 `category_id` 设为 NULL）→ 检测变空分类 → 返回空分类列表供用户确认，Plan 状态保持 `preview` 直到用户确认空分类处理

#### Scenario: Apply with empty category confirmation
- **WHEN** 应用后存在变空的分类
- **THEN** 系统返回 `{ applied_count, empty_categories: [{id, name}], needs_confirm: true }`，Plan 状态保持 `preview`，不设超时，等待用户对每个空分类选择"删除"或"保留"

#### Scenario: Confirm empty categories
- **WHEN** 用户提交空分类处理决定
- **THEN** 系统重新校验空分类集合（确认时仍为空且为叶子分类），在事务中执行删除/保留操作，未提交的空分类 ID 默认保留（keep），Plan 状态变为 `applied`

#### Scenario: Apply failure rollback
- **WHEN** 应用过程中任何步骤失败
- **THEN** 整个事务回滚，数据库状态不变，Plan 状态保持 `preview`

#### Scenario: Apply only in preview status
- **WHEN** 用户尝试应用状态不为 `preview` 的 Plan
- **THEN** 系统拒绝操作并返回错误

### Requirement: Multi-task coexistence
系统 SHALL 允许多个 `preview` 状态的 Plan 并存，但同时只能有一个 `assigning` 状态的 Plan。

#### Scenario: Create plan with existing preview plans
- **WHEN** 用户发起新的整理请求，已有多个 `preview` 状态的 Plan 但无 `assigning` 状态的 Plan
- **THEN** 系统正常创建新 Plan

#### Scenario: Create plan with existing assigning plan
- **WHEN** 用户发起新的整理请求，已有一个 `assigning` 状态的 Plan
- **THEN** 系统抛出 409 错误，返回 `activePlanId`

#### Scenario: Apply with overlapping bookmarks across plans
- **WHEN** 多个 `preview` 状态的 Plan 涉及同一书签，用户依次应用
- **THEN** 后应用的 Plan 覆盖先应用的 Plan 对该书签的分类（最后写入生效，以 apply 顺序为准）

#### Scenario: Apply plan bound to different template
- **WHEN** 用户应用一个 `preview` Plan，但当前激活模板与该 Plan 的 `template_id` 不同
- **THEN** 系统先自动切换到 Plan 对应的模板（触发快照保存/恢复），再执行应用操作

### Requirement: Stale plan timeout cleanup
系统 SHALL 在 `createPlan()` 执行时，自动将超时的 `assigning` 状态 plan 标记为 `error`，使新 plan 可以正常创建。

#### Scenario: Timeout stale assigning plan
- **WHEN** `createPlan()` 执行时存在 `assigning` 状态的 plan，且该 plan 的 `created_at` 距当前时间超过 2 小时（`PLAN_TIMEOUT_MS = 7_200_000`）
- **THEN** 系统将该 plan 状态转为 `error`，同步将关联 job 标记为 `failed`，写入状态变更日志（reason: `timeout`），然后继续创建新 plan

#### Scenario: Active assigning plan within timeout window
- **WHEN** `createPlan()` 执行时存在 `assigning` 状态的 plan，但 `created_at` 距当前时间未超过 2 小时
- **THEN** 系统抛出 `PlanError(409, 'active plan already exists')`，响应体包含 `activePlanId`

#### Scenario: Preview plans not subject to blocking
- **WHEN** `createPlan()` 执行时仅存在 `preview` 状态的 plan（无论数量）
- **THEN** 系统正常创建新 plan，不抛出 409

### Requirement: Startup recovery for assigning plans
系统 SHALL 在服务启动时立即清理所有残留的 `assigning` 状态 Plan。

#### Scenario: Recover stale assigning plans on startup
- **WHEN** 服务启动，数据库中存在 `assigning` 状态的 Plan
- **THEN** 系统立即将所有 `assigning` Plan 标记为 `error`，关联 Job 标记为 `failed`，写入状态变更日志（reason: `server_restart`）

#### Scenario: No assigning plans on startup
- **WHEN** 服务启动，数据库中无 `assigning` 状态的 Plan
- **THEN** 无操作

### PBT Properties: Plan System

#### Property: State machine valid transitions only
- **INVARIANT** 仅允许 `assigning→preview|canceled|error`、`preview→applied|canceled`，终态不可转换
- **FALSIFICATION** 随机动作序列（createPlan、markPreview、apply、cancel、confirmEmpty），断言系统状态匹配参考 FSM，非法动作返回 4xx 且不变更 DB

#### Property: Max one assigning plan
- **INVARIANT** `count(status='assigning') ≤ 1`，`createPlan` 在存在 assigning 时返回 409（preview 不阻塞）
- **FALSIFICATION** 随机交错 `createPlan` 和 `completeAssigning→preview`，断言 409 边界精确匹配 assigning 存在性

#### Property: Last-applied-wins per bookmark
- **INVARIANT** 对 apply 序列 `P1..Pk`，`final(category(b)) = last_i(assignment_i(b))`，以 apply 顺序为准
- **FALSIFICATION** 生成 ≥2 个 preview Plan 含重叠书签 + 冲突分配，随机顺序 apply，计算预期 last-writer，断言 DB 匹配

#### Property: Disjoint plans commute
- **INVARIANT** 若 `Bookmarks(Pa) ∩ Bookmarks(Pb) = ∅` 且无空分类删除，则 `apply(Pa);apply(Pb)` 与 `apply(Pb);apply(Pa)` 结果一致
- **FALSIFICATION** 生成不相交 Plan，约束 `empty_categories=[]`，比较两种顺序的结果

#### Property: Plan binds template_id immutably
- **INVARIANT** `plan.template_id = activeTemplateId_at_create` 且不可变；`applyPlan(plan)` 后 `ActiveTemplate = {plan.template_id}`
- **FALSIFICATION** 在模板 A 下创建 Plan，切换到模板 B，apply Plan，断言激活模板恢复为 A 且 plan.template_id 不变

#### Property: Empty category default keep
- **INVARIANT** `confirmEmpty(P, D)` 中未提交的空分类 ID 保留（keep），仅 `D(id)='delete'` 的被删除
- **FALSIFICATION** 随机选择空分类子集提交，断言未提交的 ID 仍存在

#### Property: Re-validation safety on confirm
- **INVARIANT** 确认时分类不再为空或不再为叶子 → 即使 decision='delete' 也不删除
- **FALSIFICATION** apply 返回空分类后，向某空分类添加书签/子分类，再 confirm delete，断言该分类存活

#### Property: Startup recovery idempotent
- **INVARIANT** `startupRecover()` 后 `count(status='assigning')=0`；连续执行两次结果一致
- **FALSIFICATION** 生成含多种状态的 DB，执行 recovery 两次，断言无额外变更

#### Property: needs_review → NULL on apply
- **INVARIANT** `∀a ∈ Plan.assignments, a.status='needs_review' ⇒ bookmark(a.id).category_id = NULL`（apply 后）
- **FALSIFICATION** 生成混合 assigned/needs_review 的 Plan，apply 后逐书签断言

#### Property: Later needs_review overrides earlier assignment
- **INVARIANT** 若最后 apply 的 Plan 对书签 b 标记 needs_review，则 `category_id(b) = NULL`，无论先前 Plan 如何分配
- **FALSIFICATION** 两个 Plan 重叠书签 b：第一个分配路径，第二个标记 needs_review，按此顺序 apply，断言 NULL

## REMOVED Requirements

### Requirement: Edit target category tree
**Reason**: 分类树编辑功能已被模板系统替代，用户通过模板管理界面编辑分类，不再在 Plan 中编辑。
**Migration**: 移除 `updatePlanTree()` 函数和 `PUT /api/ai/organize/:planId/tree` 路由。

### Requirement: Plan state change logging - designing related
**Reason**: `designing` 状态已从状态机中移除。
**Migration**: 日志中不再出现 `from_status: 'designing'` 或 `to_status: 'designing'` 的记录。`createPlan()` 的初始日志改为 `{ from_status: null, to_status: 'assigning', reason: 'user_create' }`。
