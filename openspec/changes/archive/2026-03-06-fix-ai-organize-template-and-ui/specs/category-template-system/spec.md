## MODIFIED Requirements

### Requirement: Template management sidebar UI
前端 SHALL 在主页侧边栏分类树上方提供模板管理区域。

#### Scenario: Show active template
- **WHEN** 用户访问主页且有激活模板
- **THEN** 侧边栏显示当前激活模板名称和"切换模板"按钮

#### Scenario: Show no template hint
- **WHEN** 用户访问主页且无激活模板
- **THEN** 侧边栏显示"请先选择分类模板"提示和"选择模板"按钮

#### Scenario: Template selector grouped display
- **WHEN** 用户点击"切换模板"或"选择模板"
- **THEN** 弹出模板选择面板（宽度 `max-w-3xl`），模板列表分为"预置模板"和"自定义模板"两个分组区块，每个模板显示名称、类型标签、一级分类数量

#### Scenario: Preset template actions
- **WHEN** 用户查看预置模板列表
- **THEN** 每个预置模板显示"应用"按钮和"重置"按钮（仅当该模板为当前激活模板时显示"重置"），不显示"编辑"或"删除"按钮

#### Scenario: Preset template reset
- **WHEN** 用户点击预置模板的"重置"按钮
- **THEN** 弹出确认对话框："重置将恢复预置分类列表并清空所有书签分布（书签变为未分类），确定继续？"，用户确认后调用 `POST /api/templates/:id/reset`

#### Scenario: Reset API behavior
- **WHEN** 后端收到 `POST /api/templates/:id/reset` 请求
- **THEN** 系统验证模板为 preset 类型，执行独立的重置逻辑（不复用 `applyTemplate()`）：在事务中保存当前模板快照 → 清空所有分类 → 重建预置分类树 → 所有书签 `category_id` 设为 NULL → 删除该模板的旧 snapshot 数据。MUST NOT 调用 `restoreSnapshot()` 恢复书签分布

#### Scenario: Custom template actions
- **WHEN** 用户查看自定义模板列表
- **THEN** 每个自定义模板显示"编辑"、"删除"（非激活时）和"应用"（非激活时）按钮

#### Scenario: Apply template confirmation
- **WHEN** 用户在模板选择面板中点击"应用"
- **THEN** 弹出确认对话框，明确告知"应用模板将替换当前所有分类，所有书签将变为未分类（如果该模板曾使用过，书签分布将自动恢复）"

#### Scenario: Edit template
- **WHEN** 用户点击自定义模板的"编辑"按钮
- **THEN** 打开模板编辑面板（宽度 `max-w-3xl`），可修改模板名称和分类树（增删改一级/二级分类）

#### Scenario: Template edit modal no backdrop close
- **WHEN** 用户在模板编辑面板中点击遮罩层（窗口外区域）
- **THEN** 编辑面板不关闭，防止误触导致编辑丢失

#### Scenario: Template edit modal ESC close with unsaved confirmation
- **WHEN** 用户在模板编辑面板中按 ESC 键且存在未保存的变更（模板名称或分类树与打开时不同）
- **THEN** 弹出自定义确认对话框（使用 `AppDialog.confirm`）："有未保存的修改，确定要关闭吗？"，用户确认后关闭编辑面板，取消则保持编辑状态

#### Scenario: Template edit modal cancel button with unsaved confirmation
- **WHEN** 用户在模板编辑面板中点击"取消"按钮或"X"关闭按钮，且存在未保存的变更
- **THEN** 弹出自定义确认对话框（使用 `AppDialog.confirm`）："有未保存的修改，确定要关闭吗？"，用户确认后关闭编辑面板，取消则保持编辑状态

#### Scenario: Template edit modal cancel without changes
- **WHEN** 用户在模板编辑面板中点击"取消"按钮、"X"关闭按钮或按 ESC 键，且无未保存的变更
- **THEN** 直接关闭编辑面板

#### Scenario: Template edit modal ESC close without changes
- **WHEN** 用户在模板编辑面板中按 ESC 键且无未保存的变更
- **THEN** 直接关闭编辑面板

#### Scenario: Create custom template with source selection
- **WHEN** 用户点击"新建自定义模板"按钮
- **THEN** 打开模板编辑面板，顶部显示"基于"下拉选择器，选项包含"空白模板"和所有预置模板名称

#### Scenario: Create from blank
- **WHEN** 用户在"基于"选择器中选择"空白模板"（默认）
- **THEN** 分类树编辑区域为空

#### Scenario: Create from preset template
- **WHEN** 用户在"基于"选择器中选择某个预置模板
- **THEN** 前端调用 `GET /api/templates/:id` 获取该预置模板的完整 tree，加载到分类树编辑区域供用户修改

#### Scenario: Delete template cascades AI organize tasks
- **WHEN** 用户删除一个自定义模板
- **THEN** 系统先取消所有 `assigning` 状态的关联 plan（终止 job），然后在事务中删除该模板关联的所有 `ai_organize_plans`（`template_id` 匹配）及其关联的 `jobs`、`job_failures` 和 `plan_state_logs` 记录

### Requirement: Preset template seed data fix
预置模板种子数据中的分类名 SHALL NOT 包含 `/` 字符。

#### Scenario: Fix slash in preset category names
- **WHEN** 系统初始化或迁移预置模板种子数据
- **THEN** `UI/UX` MUST 替换为 `UI&UX`，`JavaScript/TypeScript` MUST 替换为 `JavaScript&TypeScript`，`CI/CD` MUST 替换为 `CI&CD`

#### Scenario: Migrate existing database records
- **WHEN** 数据库中已存在含 `/` 的预置模板分类名
- **THEN** 迁移逻辑 MUST 更新已有记录中的 `/` 为 `&`，确保旧数据库也能修复

### Requirement: Beta feature entry points
前端 SHALL 在模板管理区域预留"AI 设计模板"和"AI 改造模板"两个 beta 功能入口。

#### Scenario: Beta buttons visible
- **WHEN** 用户查看模板管理区域
- **THEN** 显示"AI 设计模板 (Beta)"和"AI 改造模板 (Beta)"按钮，带 beta 标签

#### Scenario: Beta buttons disabled
- **WHEN** 用户点击 beta 功能按钮
- **THEN** 显示 toast 提示"该功能正在开发中，敬请期待"

## Property-Based Testing

### PBT: resetTemplate preserves bookmark count
- **INVARIANT**: `resetTemplate()` 执行前后，`SELECT COUNT(*) FROM bookmarks` 不变。重置只清空分类关联，不删除书签
- **FALSIFICATION**: 生成随机数量的书签（部分有分类、部分无分类），执行 `resetTemplate()`，验证书签总数不变且所有 `category_id` 为 NULL
- **BOUNDARY**: 0 个书签 → 无变化；所有书签已是未分类 → 无变化；书签分布在多级分类中 → 全部变为未分类

### PBT: resetTemplate rebuilds exact preset tree
- **INVARIANT**: `resetTemplate()` 执行后，`categories` 表中的分类树与模板 `tree` JSON 定义完全一致（名称、层级、数量）
- **FALSIFICATION**: 在重置前手动修改分类树（添加/删除/重命名分类），执行 `resetTemplate()`，验证分类树与原始 preset tree JSON 完全匹配
- **BOUNDARY**: 分类树已被完全清空 → 重建完整树；分类树与 preset 完全一致 → 重建后仍一致（幂等性）

### PBT: resetTemplate deletes old snapshot
- **INVARIANT**: `resetTemplate()` 执行后，`template_snapshots` 表中不存在该模板 ID 的记录
- **FALSIFICATION**: 先通过 `applyTemplate()` 创建 snapshot 数据，再执行 `resetTemplate()`，验证 snapshot 已清空

### PBT: Seed data migration is idempotent
- **INVARIANT**: 迁移逻辑执行 N 次（N >= 1）后，preset 模板 tree JSON 中不包含 `/` 字符，且结果与执行 1 次完全一致
- **FALSIFICATION**: 对含 `/` 的种子数据执行迁移 1 次、2 次、3 次，比较每次结果的 tree JSON，验证完全一致
- **BOUNDARY**: 数据库中无 preset 模板 → 迁移无操作；tree JSON 中无 `/` → 迁移无操作；`&` 字符已存在 → 不会被二次替换

### PBT: Cascade delete is complete
- **INVARIANT**: `deleteTemplate()` 完成后，数据库中不存在任何引用该模板 ID 的记录（跨 `ai_organize_plans`、`jobs`、`job_failures`、`plan_state_logs`、`category_templates` 五张表）
- **FALSIFICATION**: 创建模板并关联 N 个 plan（随机状态分布），每个 plan 关联 M 个 job_failures，执行 `deleteTemplate()`，全表扫描验证无残留
- **BOUNDARY**: N=0（无关联 plan）→ 直接删除模板；N=1 且状态为 assigning → 先取消再删除；N>5 混合状态 → 全部清理
