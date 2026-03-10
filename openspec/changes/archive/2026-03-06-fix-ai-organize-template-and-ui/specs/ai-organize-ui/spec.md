## MODIFIED Requirements

### Requirement: Organize entry point
前端 SHALL 提供"AI 整理"按钮，点击后直接打开 AI 整理窗口。窗口职责限定为任务发起和进度显示。

#### Scenario: AI organize button direct open
- **WHEN** 用户点击工具栏"AI 整理"按钮
- **THEN** 直接打开 AI 整理窗口，窗口内提供整理范围选择器（全部书签/未分类书签/指定分类）

#### Scenario: No active template blocks entry
- **WHEN** 用户点击任何 AI 分类入口，但当前无激活模板
- **THEN** 显示 toast 提示"请先选择分类模板"，不启动任务

#### Scenario: Batch size selection before start
- **WHEN** 用户选择 AI 分类范围后
- **THEN** 显示批次大小选择器（10/20/30，默认 20），用户确认后启动任务

#### Scenario: Template guidance hint
- **WHEN** AI 整理窗口处于 idle 阶段（分类前）
- **THEN** 窗口显示引导提示："建议先在侧边栏选择合适的分类模板，否则将按当前实际分类进行划分"（仅提示，非强制）

### Requirement: Assignment progress display
前端 SHALL 显示批量归类的实时进度。

#### Scenario: Show progress
- **WHEN** 批量归类进行中
- **THEN** 前端显示进度环（已处理批次/总批次）和当前状态消息

#### Scenario: View task detail button during assigning
- **WHEN** 批量归类进行中（organizePhase === 'assigning'）且 organizePlan 包含 job_id
- **THEN** 进度区域显示"查看任务详情"按钮，点击跳转到 `/jobs/:jobId`

#### Scenario: Auto redirect on completion
- **WHEN** 批量归类完成，Plan 进入 `preview` 状态
- **THEN** 前端自动跳转到任务详情页 `/jobs/:jobId`，用户在任务详情页查看 Diff 预览和执行应用操作

### Requirement: Pending plans list
前端 SHALL 在 AI 整理面板中显示所有待应用的 Plan 列表，点击跳转到对应任务详情页。

#### Scenario: Show pending plans with links
- **WHEN** 用户打开 AI 整理面板且有多个 `preview` 状态的 Plan
- **THEN** 显示待应用任务列表，每个任务显示创建时间、范围、书签数量，点击跳转到对应的 `/jobs/:jobId` 任务详情页

### Requirement: Active plan recovery on 409
前端 SHALL 在收到 409 错误时提示用户有正在执行的任务。

#### Scenario: 409 triggers notification
- **WHEN** 启动 AI 分类任务收到 HTTP 409 响应
- **THEN** 前端显示 toast 提示"有正在执行的 AI 分类任务，请等待完成后再试"

## REMOVED Requirements

### Requirement: Diff preview
**Reason**: Diff 预览功能已从主页弹窗迁移至任务详情页（`ai-organize-task-detail` spec），主页弹窗不再承担此职责。
**Migration**: 归类完成后自动跳转到任务详情页，用户在任务详情页查看 Diff 预览。

### Requirement: Apply and rollback controls
**Reason**: 应用和回滚控件已从主页弹窗迁移至任务详情页（`ai-organize-task-detail` spec），主页弹窗不再承担此职责。
**Migration**: 用户在任务详情页执行应用、冲突解决和回滚操作。
