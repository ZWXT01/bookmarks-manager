## MODIFIED Requirements

### Requirement: Unified classify-batch API
系统 SHALL 提供 `POST /api/ai/classify-batch` 端点，统一处理所有入口的 AI 分类请求。

#### Scenario: Start classify batch task
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，body 含 `bookmark_ids: (number|string)[]` 和可选 `batch_size: 10|20|30`
- **THEN** 系统对每个元素执行 `Number()` 转换后用 `Number.isInteger()` 校验（严格模式：`"123abc"` → NaN → 过滤），去重后过滤无效值，创建 Plan 并启动批量归类 Job

#### Scenario: String bookmark IDs accepted
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，`bookmark_ids` 包含字符串类型的数字（如 `["1", "2", "3"]`）
- **THEN** 系统将字符串转换为整数后正常处理，不返回"无有效的书签 ID"错误

#### Scenario: Invalid batch_size rejected
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，`batch_size` 不在 `{10, 20, 30}` 中
- **THEN** 返回 400 错误，提示 batch_size 必须为 10、20 或 30

#### Scenario: Duplicate bookmark IDs deduplicated
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，`bookmark_ids` 包含重复 ID（如 `[1, 1, 2, "2"]`）
- **THEN** 系统静默去重，转换后得到 `[1, 2]`，total/processed 基于去重后的数量计算

#### Scenario: Empty bookmark_ids rejected
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，`bookmark_ids` 为空数组（或去重+过滤后为空）
- **THEN** 返回 400 错误

#### Scenario: Another assigning task blocks new task
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，已有一个 `assigning` 状态的 Plan
- **THEN** 返回 409 错误，包含 `activePlanId`

#### Scenario: Preview tasks do not block new task
- **WHEN** 客户端调用 `POST /api/ai/classify-batch`，已有多个 `preview` 状态的 Plan 但无 `assigning` 状态的 Plan
- **THEN** 正常创建新 Plan 并启动任务

### Requirement: Batch size selection
前端 SHALL 在启动 AI 分类任务时允许用户选择每批分类数量。

#### Scenario: Select batch size
- **WHEN** 用户启动 AI 分类任务
- **THEN** 显示批次大小选择器，可选 10、20（默认）、30

#### Scenario: Template guidance hint in batch classify
- **WHEN** 批量分类窗口显示（分类前）
- **THEN** 窗口显示引导提示："建议先在侧边栏选择合适的分类模板，否则将按当前实际分类进行划分"（仅提示，非强制）

#### Scenario: Batch size persisted
- **WHEN** 用户选择批次大小后启动任务
- **THEN** 该批次大小传递给后端 `POST /api/ai/classify-batch` 的 `batch_size` 参数

### Requirement: Organize API bookmark ID coercion
系统 SHALL 在 `POST /api/ai/organize` 端点也对 bookmark_ids 做类型转换。

#### Scenario: Organize API accepts string IDs
- **WHEN** 客户端调用 `POST /api/ai/organize`，scope 为 `ids:` 前缀格式
- **THEN** 系统使用与 classify-batch 相同的 `Number()` + `Number.isInteger()` 严格转换逻辑，并静默去重

### PBT Properties: Bookmark ID Coercion

#### Property: Idempotency
- **INVARIANT** 设 `f(xs)` 为 ID 转换管道（Number → isInteger 过滤 → 去重），则 `f(xs) === f(f(xs))`
- **FALSIFICATION** 生成混合类型数组（`[1, "1", "01", " 1 ", 1.0, "1e2", "0x10", "abc", "1abc", NaN, Infinity]`），断言 `f(xs)` 等于 `f(f(xs))`

#### Property: Strict rejection
- **INVARIANT** 任何字符串 `s`，若 `Number(s)` 不是正整数，则 `s` 不贡献任何输出元素
- **FALSIFICATION** 模糊测试字符串（unicode、控制字符、超长字符串、混合数字字母如 `"１２3"`、`"1\u0000"`），断言无非法元素进入输出

#### Property: Dedup correctness
- **INVARIANT** 输出无重复：`∀i≠j, out[i]≠out[j]`，且输出中每个 `k` 在输入中至少有一个 `x` 满足 `Number(x)===k && Number.isInteger(k) && k>0`
- **FALSIFICATION** 生成大量碰撞输入（`[1, "1", "1.0", "001", "+1"]`），断言输出中每个整数仅出现一次
