## MODIFIED Requirements

### Requirement: AI organize job detail UI
前端 SHALL 为 `ai_organize` 类型 job 提供独立的任务详情展示区域，包含整理计划的完整预览和应用流程。

#### Scenario: Show ai_organize detail section
- **WHEN** 用户查看 `ai_organize` 类型 job 的详情页
- **THEN** 页面显示"AI 整理结果"区块，包含：分类建议列表（每条显示书签标题、URL、建议分类路径、状态）、统计摘要（已分配数、待审核数）、关联 plan 的状态

#### Scenario: Plan preview and apply in task detail
- **WHEN** 关联 plan 的状态为 `preview`
- **THEN** 任务详情页显示"待应用"状态标签、Diff 摘要（移动书签数、待审核数）、"应用"按钮和"放弃"按钮，用户在此页面直接操作应用流程

#### Scenario: Apply plan from task detail
- **WHEN** 用户在任务详情页点击"应用"按钮
- **THEN** 前端调用 apply API，如果返回 `needs_confirm: true`，在任务详情页内显示空分类确认界面（含模板名称提示），如果返回冲突列表，显示冲突解决界面

#### Scenario: Conflict resolution shows template name
- **WHEN** 应用 plan 时返回冲突或空分类确认界面
- **THEN** 界面 MUST 显示"将应用于模板：{template_name}"提示，让用户明确知道操作目标模板

#### Scenario: Discard plan from task detail
- **WHEN** 用户在任务详情页点击"放弃"按钮
- **THEN** 前端调用 cancel API，显示"已取消"提示，plan 状态变为 `canceled`，但 plan 数据仍保留在任务详情中可查看

#### Scenario: Reopen task detail after discard
- **WHEN** 用户放弃 plan 后再次打开同一任务详情
- **THEN** 页面显示 plan 的"已取消"状态，assignments 列表仍可查看但不可操作

#### Scenario: Plan applied status
- **WHEN** 关联 plan 的状态为 `applied`
- **THEN** 显示"已应用"状态（绿色标签），assignments 中 `assigned` 的条目标记为"已应用"

#### Scenario: Assignment status display
- **WHEN** assignment 的 status 为 `assigned`
- **THEN** 显示建议的分类路径，标记为"已分配"（蓝色标签）

#### Scenario: Needs review status display
- **WHEN** assignment 的 status 为 `needs_review`
- **THEN** 显示"待审核"标签（橙色），分类路径显示为"未匹配"

### Requirement: AJAX pagination for assignments and failures
任务详情页中 assignments 和 failures 的分页 SHALL 使用 AJAX 无刷新加载，与现有 suggestions 分页方式一致。分页仅在非流式阶段可用。

#### Scenario: Assignments AJAX pagination
- **WHEN** plan 状态为 `preview`/`applied`/`canceled`/`rolled_back` 且 assignments 数量超过 20 条，用户点击下一页
- **THEN** 前端通过 `GET /api/ai/organize/:planId/assignments?page=N&page_size=20` 获取数据，替换表格内容，不刷新页面

#### Scenario: Failures AJAX pagination
- **WHEN** failures 数量超过 20 条，用户点击下一页
- **THEN** 前端通过 `GET /api/jobs/:jobId/failures?page=N&page_size=20` 获取数据，替换表格内容，不刷新页面

#### Scenario: Pagination state preserved
- **WHEN** 用户在 assignments 或 failures 表格中翻页
- **THEN** 当前页码显示在分页控件中，URL 不变，页面其他区域状态不受影响

#### Scenario: Pagination disabled during SSE streaming
- **WHEN** plan 状态为 `assigning`（SSE 流式推送进行中）
- **THEN** assignments 列表仅显示实时追加的结果，分页控件隐藏不可用。流结束后（plan 进入 `preview` 状态），自动切换为标准 AJAX 分页模式

### Requirement: Hide failures section when empty
任务详情页 SHALL 在无失败项时隐藏失败项组件。

#### Scenario: No failures hides section
- **WHEN** job 的 `failed` 计数为 0 且 `job_failures` 表中无关联记录
- **THEN** 任务详情页不渲染失败项区块（包括标题和表格）

#### Scenario: Has failures shows section
- **WHEN** job 的 `failed` 计数大于 0
- **THEN** 任务详情页正常渲染失败项区块

### Requirement: SSE incremental batch results
任务详情页 SHALL 在批量处理过程中通过 SSE 实时接收并增量显示每批完成的分类结果。

#### Scenario: Receive batch assignments via SSE
- **WHEN** 后端完成一批书签的 AI 分类
- **THEN** SSE 事件流发送 `batch_assignments` 事件，payload 包含该批的 assignments 列表（`[{bookmark_id, title, url, category_path, status}]`）

#### Scenario: Frontend appends batch results
- **WHEN** 前端收到 `batch_assignments` SSE 事件
- **THEN** 将该批 assignments 追加到已有列表末尾，更新统计摘要，无需等待全部批次完成

#### Scenario: SSE fallback to polling
- **WHEN** SSE 连接断开
- **THEN** 前端自动切换到轮询模式（3 秒间隔），通过 API 获取最新 assignments 列表

### Requirement: Dynamic back button navigation
任务详情页的返回按钮 SHALL 根据来源页面动态导航。

#### Scenario: Back to job list
- **WHEN** 用户从任务列表页（`/jobs`）进入任务详情页
- **THEN** 返回按钮导航到 `/jobs`

#### Scenario: Back to home
- **WHEN** 用户从首页（`/`）或其他页面进入任务详情页
- **THEN** 返回按钮导航到 `/`

#### Scenario: Referer unavailable fallback
- **WHEN** 浏览器未发送 Referer header
- **THEN** 返回按钮默认导航到 `/`
