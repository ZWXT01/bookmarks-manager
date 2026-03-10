## MODIFIED Requirements

### Requirement: Organize entry point
前端 SHALL 提供多入口的"AI 分类"功能，替换现有的单一"AI 整理"入口。

#### Scenario: AI organize button with dropdown
- **WHEN** 用户点击工具栏"AI 整理"按钮
- **THEN** 展开下拉菜单，包含"全部书签"和"未分类书签"两个选项

#### Scenario: No active template blocks entry
- **WHEN** 用户点击任何 AI 分类入口，但当前无激活模板
- **THEN** 显示 toast 提示"请先选择分类模板"，不启动任务

#### Scenario: Batch size selection before start
- **WHEN** 用户选择 AI 分类范围后
- **THEN** 显示批次大小选择器（10/20/30，默认 20），用户确认后启动任务

### Requirement: Assignment progress display
前端 SHALL 显示批量归类的实时进度。

#### Scenario: Show progress
- **WHEN** 批量归类进行中
- **THEN** 前端显示进度环（已处理批次/总批次）和当前状态消息

### Requirement: Diff preview
前端 SHALL 在归类完成后展示 Diff 预览，让用户了解将要发生的变更。

#### Scenario: Show diff summary
- **WHEN** 归类完成，Plan 进入 `preview` 状态
- **THEN** 前端显示变更摘要：移动书签数、待审核数，并提供"应用"和"放弃"按钮

### Requirement: Apply and rollback controls
前端 SHALL 提供应用和回滚操作的 UI 控件。

#### Scenario: Apply from preview
- **WHEN** 用户在 Diff 预览界面点击"应用"
- **THEN** 前端调用 apply API，如果返回 `needs_confirm: true`，显示空分类确认界面

#### Scenario: Empty category confirmation UI
- **WHEN** apply 返回空分类列表
- **THEN** 前端显示空分类列表，每个分类旁有"删除"/"保留"选择，底部有"确认"按钮。不设超时，用户下次打开页面时继续确认

#### Scenario: Rollback after apply
- **WHEN** 用户在应用后点击"回滚"
- **THEN** 前端调用 rollback API，显示回滚结果

### Requirement: Active plan recovery on 409
前端 SHALL 在收到 409 错误时提示用户有正在执行的任务。

#### Scenario: 409 triggers notification
- **WHEN** 启动 AI 分类任务收到 HTTP 409 响应
- **THEN** 前端显示 toast 提示"有正在执行的 AI 分类任务，请等待完成后再试"

### Requirement: Task detail page refactoring
前端 SHALL 重构 AI 整理任务详情页（`views/job.ejs`），移除单个书签应用按钮。

#### Scenario: Show assignment results without apply buttons
- **WHEN** 用户查看 AI 整理任务详情页
- **THEN** 每个书签仅展示建议的分类路径，不显示单个"应用"按钮

#### Scenario: Apply button text
- **WHEN** 用户查看 AI 整理任务详情页
- **THEN** 底部显示"应用"按钮（而非"应用全部"或"一键应用全部"）

### Requirement: Pending plans list
前端 SHALL 显示所有待应用的 Plan 列表。

#### Scenario: Show pending plans
- **WHEN** 用户打开 AI 整理面板且有多个 `preview` 状态的 Plan
- **THEN** 显示待应用任务列表，每个任务显示创建时间、范围、书签数量，可点击查看详情或应用

## REMOVED Requirements

### Requirement: Category tree editor
**Reason**: 分类树编辑功能已被模板系统替代。
**Migration**: 移除 `organizePhase === 'editing'` 和 `organizePhase === 'designing'` 相关 UI 代码。

### Requirement: Remove legacy AI UI
**Reason**: 需求范围扩大——不仅移除旧 AI 分类/精简 UI，还需移除分类树编辑器。
**Migration**: 移除 `views/job.ejs` 中 `ai_classify` 类型的分类建议表格和单个应用按钮，移除 `ai_simplify` 类型的精简建议 UI，移除 `views/index.ejs` 中的分类树编辑器模板。
