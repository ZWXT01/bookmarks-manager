## ADDED Requirements

### Requirement: Organize entry point
前端 SHALL 提供统一的"AI 整理"入口，替换现有的"AI 分类"和"AI 精简"两个独立入口。

#### Scenario: User starts organize
- **WHEN** 用户点击"AI 整理"按钮
- **THEN** 系统显示整理向导，提供"AI 自动设计"和"手动设计"两种模式选择

### Requirement: Category tree editor
前端 SHALL 在 Phase 1 提供分类树编辑界面，用户可查看 AI 生成的分类树草案并进行增删改操作。

#### Scenario: View AI-designed tree
- **WHEN** AI 完成分类树设计
- **THEN** 前端以树状结构展示分类草案，每个节点可编辑名称、删除、或添加子分类

#### Scenario: Confirm tree
- **WHEN** 用户对分类树满意并点击"确认"
- **THEN** 前端调用 confirm API 锁定分类树，进入 Phase 2

### Requirement: Assignment progress display
前端 SHALL 在 Phase 2 显示批量归类的实时进度。

#### Scenario: Show progress
- **WHEN** 批量归类进行中
- **THEN** 前端显示进度条（已处理/总数）和当前状态消息

### Requirement: Diff preview
前端 SHALL 在归类完成后展示 Diff 预览，让用户了解将要发生的变更。

#### Scenario: Show diff summary
- **WHEN** 归类完成，Plan 进入 `preview` 状态
- **THEN** 前端显示变更摘要：新增分类数、移动书签数、删除空分类数，并提供"应用"和"放弃"按钮

### Requirement: Apply and rollback controls
前端 SHALL 提供应用和回滚操作的 UI 控件。

#### Scenario: Apply from preview
- **WHEN** 用户在 Diff 预览界面点击"应用"
- **THEN** 前端调用 apply API，显示应用结果

#### Scenario: Rollback after apply
- **WHEN** 用户在应用后点击"回滚"
- **THEN** 前端调用 rollback API，显示回滚结果

### Requirement: Remove legacy AI UI
前端 MUST 移除现有的"AI 分类"按钮/modal、"AI 精简"按钮/modal、分类建议列表、精简建议列表等旧 UI 元素。

#### Scenario: Legacy UI removed
- **WHEN** 用户访问书签管理页面
- **THEN** 页面中不存在旧的 AI 分类/精简相关 UI 元素
