## ADDED Requirements

### Requirement: AI classify button with scope options
前端 SHALL 在工具栏提供"AI 整理"按钮，点击后展开下拉菜单，包含"全部书签"和"未分类书签"两个选项。

#### Scenario: Click AI organize with all bookmarks
- **WHEN** 用户点击"AI 整理" → "全部书签"
- **THEN** 系统收集所有书签 ID，启动 AI 分类任务

#### Scenario: Click AI organize with uncategorized bookmarks
- **WHEN** 用户点击"AI 整理" → "未分类书签"
- **THEN** 系统收集所有 `category_id IS NULL` 的书签 ID，启动 AI 分类任务

#### Scenario: No active template blocks AI classify
- **WHEN** 用户点击任何 AI 分类入口，但当前无激活模板
- **THEN** 显示 toast 提示"请先选择分类模板"，不启动任务

### Requirement: Selected bookmarks AI classify
前端 SHALL 在选中书签后的批量操作栏中提供"AI 分类"选项。

#### Scenario: Batch AI classify selected bookmarks
- **WHEN** 用户选中多个书签后点击批量操作栏的"AI 分类"
- **THEN** 系统以选中的书签 ID 列表启动 AI 分类任务

#### Scenario: Single selected bookmark AI classify
- **WHEN** 用户选中单个书签后点击批量操作栏的"AI 分类"
- **THEN** 系统以该单个书签 ID 启动 AI 分类任务

### Requirement: Single bookmark context menu AI classify
前端 SHALL 在单个书签的操作菜单（右键/更多按钮）中添加"AI 分类"选项。

#### Scenario: Context menu AI classify
- **WHEN** 用户在单个书签的操作菜单中点击"AI 分类"
- **THEN** 系统以该书签 ID 启动 AI 分类任务

### Requirement: Current page bookmarks AI classify
前端 SHALL 提供"本页书签 AI 分类"入口。

#### Scenario: Classify current page bookmarks
- **WHEN** 用户点击"本页书签 AI 分类"
- **THEN** 系统收集当前列表视图在当前筛选/搜索/排序条件下、当前分页页码实际渲染的书签 ID 集合，启动 AI 分类任务

### Requirement: Batch size selection
前端 SHALL 在启动 AI 分类任务时允许用户选择每批分类数量。

#### Scenario: Select batch size
- **WHEN** 用户启动 AI 分类任务
- **THEN** 显示批次大小选择器，可选 10、20（默认）、30

#### Scenario: Batch size persisted
- **WHEN** 用户选择批次大小后启动任务
- **THEN** 该批次大小传递给后端 `POST /api/ai/classify-batch` 的 `batch_size` 参数

### Requirement: Unified classify-batch API
系统 SHALL 提供 `POST /api/ai/classify-batch` 端点，统一处理所有入口的 AI 分类请求。

#### Scenario: Start classify batch task
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，body 含 `bookmark_ids: number[]` 和可选 `batch_size: 10|20|30`
- **THEN** 系统创建 Plan（状态为 `assigning`，记录当前激活模板的 `template_id`），启动批量归类 Job，返回 `{ success: true, planId }`

#### Scenario: Invalid batch_size rejected
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，`batch_size` 不在 `{10, 20, 30}` 中
- **THEN** 返回 400 错误，提示 batch_size 必须为 10、20 或 30

#### Scenario: Empty bookmark_ids rejected
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，`bookmark_ids` 为空数组
- **THEN** 返回 400 错误

#### Scenario: Another assigning task blocks new task
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，已有一个 `assigning` 状态的 Plan
- **THEN** 返回 409 错误，包含 `activePlanId`

#### Scenario: Preview tasks do not block new task
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，已有多个 `preview` 状态的 Plan 但无 `assigning` 状态的 Plan
- **THEN** 正常创建新 Plan 并启动任务
