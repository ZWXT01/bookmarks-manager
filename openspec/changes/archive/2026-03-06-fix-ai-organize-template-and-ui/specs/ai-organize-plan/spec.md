## MODIFIED Requirements

### Requirement: Atomic apply with backup
系统 SHALL 在单个数据库事务中应用 Plan 的所有变更。应用前 MUST 创建状态快照（备份），应用失败时 MUST 自动回滚。

#### Scenario: Successful apply
- **WHEN** 用户确认应用 Plan
- **THEN** 系统在单事务中：若 Plan 的 `template_id` 与当前激活模板不同，先自动切换模板（触发快照保存/恢复）→ 创建备份快照 → 移动书签到目标分类（`needs_review` 书签的 `category_id` 设为 NULL）→ 检测变空的源分类 → 返回空分类列表供用户确认，Plan 状态保持 `preview` 直到用户确认空分类处理

#### Scenario: Empty category detection scoped to source categories
- **WHEN** 应用 Plan 后需要检测变空的分类
- **THEN** 系统 MUST 仅检查被移出书签的源分类（即书签原来所在的分类）是否变空，源为"未分类"（`category_id IS NULL`）的书签 MUST 忽略不检查。系统 MUST NOT 全局扫描所有空叶子分类

#### Scenario: Apply with empty category confirmation
- **WHEN** 应用后存在变空的源分类
- **THEN** 系统返回 `{ applied_count, empty_categories: [{id, name}], needs_confirm: true }`，Plan 状态保持 `preview`，不设超时，等待用户对每个空分类选择"删除"或"保留"

#### Scenario: Confirm empty categories
- **WHEN** 用户提交空分类处理决定
- **THEN** 系统重新校验空分类集合（仅对源分类 ID 确认时仍为空且为叶子分类），在事务中执行删除/保留操作，未提交的空分类 ID 默认保留（keep），Plan 状态变为 `applied`

#### Scenario: Apply failure rollback
- **WHEN** 应用过程中任何步骤失败
- **THEN** 整个事务回滚，数据库状态不变，Plan 状态保持 `preview`

#### Scenario: Apply only in preview status
- **WHEN** 用户尝试应用状态不为 `preview` 的 Plan
- **THEN** 系统拒绝操作并返回错误

#### Scenario: Apply API returns template info
- **WHEN** 应用 Plan 的 API 返回结果
- **THEN** 响应 MUST 包含 `template_name` 字段（Plan 绑定的模板名称），供前端在冲突解决 UI 中显示"将应用于模板 X"

### Requirement: Compute diff
系统 SHALL 能计算 Plan 的归类结果与当前数据库状态之间的差异（Diff），包括：移动书签数、变空分类数。

#### Scenario: Diff with bookmark moves
- **WHEN** Plan 的 assignments 包含书签分类变更
- **THEN** Diff 结果 MUST 包含书签移动映射（from_category → to_category）和变空分类列表

#### Scenario: Diff with no changes
- **WHEN** Plan 的所有 assignments 与当前书签分类一致
- **THEN** Diff 结果显示无变更

### Requirement: Cascade delete plans on template deletion
系统 SHALL 在删除模板时，按 plan 状态分别处理后级联删除该模板关联的所有 AI 整理计划及其关联的 Job。

#### Scenario: Delete template with assigning plan
- **WHEN** 用户删除一个模板，该模板有关联的 `assigning` 状态 plan
- **THEN** 系统先取消该 plan（调用 `jobQueue.cancelJob()` 终止 job，将 plan 状态设为 `canceled`），然后在事务中删除该 plan 及其关联的 `jobs` 和 `job_failures` 记录

#### Scenario: Delete template with preview plan
- **WHEN** 用户删除一个模板，该模板有关联的 `preview` 状态 plan
- **THEN** 系统在事务中直接删除该 plan 及其关联的 `jobs` 和 `job_failures` 记录

#### Scenario: Delete template cascades to terminal plans
- **WHEN** 用户删除一个模板，该模板有关联的终态 plan（`applied`、`canceled`、`rolled_back`、`error`）
- **THEN** 系统在事务中删除这些 plan 及其关联的 `jobs` 和 `job_failures` 记录

#### Scenario: Cascade delete ordering
- **WHEN** 系统执行级联删除
- **THEN** 删除顺序 MUST 为：`job_failures` → `jobs` → `plan_state_logs` → `ai_organize_plans` → `category_templates`，确保外键约束不被违反

## Property-Based Testing

### PBT: Empty category detection is subset of source categories
- **INVARIANT**: `applyPlan()` 返回的 `empty_categories` 集合 MUST 是被移出书签的源分类 ID 集合的子集。对于任意 assignments 组合，`empty_categories.every(ec => sourceCategoryIds.has(ec.id))` 恒为 true
- **FALSIFICATION**: 生成随机 assignments（含 `assigned` 和 `needs_review`），其中部分书签来自"未分类"（`category_id IS NULL`），验证返回的空分类中不包含任何非源分类 ID，且不包含"未分类"
- **BOUNDARY**: 所有书签均来自"未分类" → `empty_categories` 为空；所有书签来自同一分类且全部移走 → 该分类出现在 `empty_categories` 中；书签从 A 移到 A（同分类）→ A 不出现在 `empty_categories` 中

### PBT: Apply is idempotent on bookmark total count
- **INVARIANT**: `applyPlan()` 执行前后，`SELECT COUNT(*) FROM bookmarks` 的值不变。应用操作只移动书签，不创建或删除书签
- **FALSIFICATION**: 生成随机 plan（含冲突书签、needs_review 书签、正常书签），执行 `applyPlan()`，比较前后书签总数
- **BOUNDARY**: 空 assignments → 书签总数不变；所有 assignments 都是 `needs_review` → 书签总数不变

### PBT: Apply failure preserves database state
- **INVARIANT**: 若 `applyPlan()` 抛出异常，数据库中 `bookmarks.category_id`、`categories` 表、`ai_organize_plans.status` 均与调用前完全一致
- **FALSIFICATION**: 在 `applyPlan()` 内部注入故障（如无效 category_path），验证事务回滚后数据库状态与快照一致
- **BOUNDARY**: 第一条 assignment 就失败 → 全部回滚；最后一条 assignment 失败 → 全部回滚

### PBT: Cascade delete leaves no orphan records
- **INVARIANT**: `deleteTemplate()` 完成后，`ai_organize_plans`、`jobs`、`job_failures`、`plan_state_logs` 中不存在任何 `template_id` 或 `plan_id` 指向已删除模板的记录
- **FALSIFICATION**: 创建模板并关联多个不同状态的 plan（assigning、preview、applied、canceled），执行 `deleteTemplate()`，查询所有关联表验证无残留
- **BOUNDARY**: 模板无关联 plan → 直接删除成功；模板有 1 个 assigning plan → 先取消再删除；模板有混合状态 plan → 全部清理

### PBT: Confirm empty categories default-keep safety
- **INVARIANT**: `confirmEmpty()` 中，用户未提交决定的空分类 ID 默认保留（keep），即 `decisions` 中未出现的 ID 对应的分类在操作后仍存在于 `categories` 表中
- **FALSIFICATION**: 生成 N 个空分类 ID，仅提交其中 M 个（M < N）的决定，验证未提交的 N-M 个分类仍存在
- **BOUNDARY**: 提交空 decisions 数组 → 所有空分类保留；提交全部为 delete → 全部删除；提交的 ID 不在当前空分类集合中 → 忽略无效 ID
