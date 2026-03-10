## MODIFIED Requirements

### Requirement: Batch bookmark assignment
系统 SHALL 将书签分批发送给 AI，AI 从当前已有的 categories 列表中匹配最合适的分类。

#### Scenario: Assign bookmarks in batches
- **WHEN** Plan 创建并进入 `assigning` 状态
- **THEN** 书签按用户选择的批次大小（10/20/30，默认 20）发送给 AI，AI 仅从当前 categories 列表中选择分类，不创建新分类

#### Scenario: Assignment progress tracking via Plan
- **WHEN** 批量归类进行中
- **THEN** 系统通过 Plan 机制报告进度（已处理批次数/总批次数）

#### Scenario: Assignment progress synced to Job
- **WHEN** `assignBookmarks` 确定 batches 数量后
- **THEN** 系统 MUST 调用 `updateJob(db, jobId, { total: bookmarks.length })` 同步 job 的 total 字段

#### Scenario: Job processed count updated per batch
- **WHEN** 每个 batch 处理完成后
- **THEN** 系统 MUST 调用 `updateJob(db, jobId, { processed: cumulativeProcessedCount })` 同步 job 的 processed 字段，其中 `cumulativeProcessedCount` 为截至当前 batch 已处理的书签总数

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

### PBT Properties: Job Progress Sync

#### Property: Monotonicity
- **INVARIANT** processed 更新序列 `p0, p1, ..., pn` 满足 `p_{t+1} >= p_t`，且 `p_t = Σ_{i=1..t} batch_size_i`
- **FALSIFICATION** 生成随机书签数量 N 和随机 batch 分区，stub `updateJob` 记录调用，断言 processed 值单调递增且等于累计和

#### Property: Bounds preservation
- **INVARIANT** 每次进度更新满足 `0 <= processed <= total`，且 `total = N`（去重后书签数）在设置后不变
- **FALSIFICATION** 同上生成器，注入边界 batch 分区（含空 batch），断言不出现 `processed > total`

#### Property: Final consistency
- **INVARIANT** 若 `assignBookmarks` 成功完成，最后一次更新满足 `processed_final === total === N`
- **FALSIFICATION** 生成随机 N 和分区，运行至完成，断言最终 `processed === N`。注入中途异常，断言不出现虚假的 `processed=N` 更新
