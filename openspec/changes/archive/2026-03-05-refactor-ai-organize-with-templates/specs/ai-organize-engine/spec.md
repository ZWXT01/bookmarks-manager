## REMOVED Requirements

### Requirement: Local feature extraction
**Reason**: 特征提取功能仅服务于 AI 自动设计分类树，该功能已被模板系统替代。
**Migration**: 代码保留但从主流程移除，归入 beta 预留路径。

### Requirement: AI category tree design
**Reason**: AI 自动设计分类树功能已被预置/自定义分类模板系统完全替代。
**Migration**: `designCategoryTree()` 函数保留但从主流程移除，归入"AI 设计模板"beta 预留路径。

## MODIFIED Requirements

### Requirement: Batch bookmark assignment
系统 SHALL 将书签分批发送给 AI，AI 从当前已有的 categories 列表中匹配最合适的分类。

#### Scenario: Assign bookmarks in batches
- **WHEN** Plan 创建并进入 `assigning` 状态
- **THEN** 书签按用户选择的批次大小（10/20/30，默认 20）发送给 AI，AI 仅从当前 categories 列表中选择分类，不创建新分类

#### Scenario: Assignment progress tracking
- **WHEN** 批量归类进行中
- **THEN** 系统通过 Job 机制报告进度（已处理批次数/总批次数）

#### Scenario: Unmatched bookmark goes to uncategorized
- **WHEN** AI 无法为某个书签匹配合适的分类
- **THEN** AI 返回空字符串，系统将该书签在 Plan 中标记为 `needs_review`（category 为空）。用户应用 Plan 时，`needs_review` 书签的 `category_id` 设为 NULL（未分类）

#### Scenario: AI prompt format
- **WHEN** 系统构建 AI 请求
- **THEN** system prompt MUST 包含：(1) 联网访问 URL 了解内容的指令 (2) 当前所有 categories 的完整路径列表 (3) 严格返回 JSON 格式的要求 (4) 无合适分类返回空字符串的规则

#### Scenario: AI request format
- **WHEN** 系统发送批次给 AI
- **THEN** 请求格式为书签列表（含序号、URL、标题），响应格式为 `{"assignments":[{"index":1,"category":"分类路径"}]}`

### Requirement: AI prompt constraint
批量归类时的 AI prompt MUST 将输出限制为当前 categories 表中已有的分类路径，禁止 AI 创建不在列表中的分类。

#### Scenario: AI output validation
- **WHEN** AI 返回的分类路径不在当前 categories 列表中
- **THEN** 系统将该书签在 Plan 中标记为 `needs_review`（category 为空），应用时 `category_id` 设为 NULL
