## ADDED Requirements

### Requirement: Local feature extraction
系统 SHALL 从书签数据中本地提取统计特征，不调用 AI。特征包括：域名分布 TOP N、标题关键词频率 TOP N、现有分类统计。

#### Scenario: Extract features from bookmarks
- **WHEN** 系统对书签集合执行特征提取
- **THEN** 返回域名分布（TOP 200）、标题关键词频率（TOP 100）、现有分类及其书签计数，总数据量 MUST 控制在可单次发送给 AI 的范围内

#### Scenario: Empty bookmarks
- **WHEN** 书签集合为空
- **THEN** 返回空的特征摘要

### Requirement: AI category tree design
系统 SHALL 将特征摘要发送给 AI，由 AI 设计完整的二级分类树。分类树 MUST 遵循现有 2 级层级约束（一级/二级）。

#### Scenario: AI designs category tree
- **WHEN** 系统将特征摘要发送给 AI
- **THEN** AI 返回一个完整的分类树 JSON，包含 8-15 个一级分类，每个一级下 0-5 个二级分类

#### Scenario: AI respects existing categories
- **WHEN** 特征摘要中包含现有分类信息
- **THEN** AI SHOULD 优先复用现有分类名称，减少不必要的重命名

#### Scenario: AI call failure
- **WHEN** AI 调用失败或返回无效响应
- **THEN** 系统报告错误，Plan 保持 `designing` 状态，不产生副作用

### Requirement: Batch bookmark assignment
系统 SHALL 将书签分批发送给 AI，AI 从锁定的分类树中选择最匹配的分类（选择题模式）。

#### Scenario: Assign bookmarks in batches
- **WHEN** 分类树已锁定，系统开始批量归类
- **THEN** 书签按批次（每批 30-50 条）发送给 AI，AI 仅从目标分类树中选择分类，不创建新分类

#### Scenario: Assignment progress tracking
- **WHEN** 批量归类进行中
- **THEN** 系统通过 Job 机制报告进度（已处理数/总数）

#### Scenario: Incremental mode
- **WHEN** 用户选择增量模式
- **THEN** 系统仅处理未分类的书签（`category_id IS NULL`），已分类书签保持不变

#### Scenario: Full mode
- **WHEN** 用户选择全量模式
- **THEN** 系统处理所有书签，包括已有分类的书签

### Requirement: AI prompt constraint
批量归类时的 AI prompt MUST 将输出限制为目标分类树中的分类路径，禁止 AI 创建不在目标树中的分类。

#### Scenario: AI output validation
- **WHEN** AI 返回的分类路径不在目标分类树中
- **THEN** 系统将该书签标记为归类失败，不分配分类
