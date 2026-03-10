## MODIFIED Requirements

### Requirement: Organize entry point
前端 SHALL 提供"AI 整理"按钮，点击后直接打开 AI 整理窗口。

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

### Requirement: Diff preview
前端 SHALL 在归类完成后展示 Diff 预览，让用户了解将要发生的变更。

#### Scenario: Show diff summary
- **WHEN** 归类完成，Plan 进入 `preview` 状态
- **THEN** 前端显示变更摘要：移动书签数、待审核数，并提供"应用"和"放弃"按钮

### Requirement: Apply and rollback controls
前端 SHALL 提供应用和回滚操作的 UI 控件。

#### Scenario: Apply from preview
- **WHEN** 用户在 Diff 预览界面点击"应用"
- **THEN** 前端调用 apply API（请求 body 为 `{}`），如果返回 `needs_confirm: true`，显示空分类确认界面

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

### Requirement: Pending plans list
前端 SHALL 显示所有待应用的 Plan 列表。

#### Scenario: Show pending plans
- **WHEN** 用户打开 AI 整理面板且有多个 `preview` 状态的 Plan
- **THEN** 显示待应用任务列表，每个任务显示创建时间、范围、书签数量，可点击查看详情或应用

## REMOVED Requirements

### Requirement: Settings page batch size
**Reason**: AI 整理窗口和批量分类窗口已各自提供 batch size 选择器（10/20/30），设置页的"每批分类数量"配置（15/30/50/100）值域不一致且冗余。
**Migration**: 移除 `views/settings.ejs` 中 `ai_batch_size` 的 `<label>` 块（约 L166-174）。后端设置存储中的旧值保留但不再使用。
