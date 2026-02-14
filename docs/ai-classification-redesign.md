# AI 分类能力重构设计（时序安全版）

## 1. 背景与问题

当前 AI 分类链路存在以下核心问题：

1. 建议生成、建议应用、分类精简（合并）是分散实现，缺少统一状态机。
2. 缺少“快照版本”概念，任务运行期间数据已变化时仍可能继续应用旧建议。
3. 分类精简存在两套实现（旧表与 level 表），展示和应用路径不一致。
4. 前端与后端字段语义不一致时，容易出现“有建议但无法正确显示/应用”的问题。
5. 应用动作多为逐条执行，缺少可回滚的批次事务与冲突报告。

## 2. 目标

1. 提供一个“单入口、可预览、可批量、安全应用”的 AI 整理流程。
2. 消除应用建议/书签迁移/分类合并的时序竞态。
3. 支持部分应用、失败回滚、冲突可解释。
4. 保持现有 API 兼容的前提下平滑迁移。

## 3. 核心方案：Session + Plan + Apply

### 3.1 Session（会话）

每次 AI 操作先创建 `ai_session`，记录：

- 操作范围（全量/未分类/选中）
- 基线版本号（`base_revision`）
- 生成参数（模型、批大小、level）
- 当前状态（`draft/running/reviewing/applying/done/failed`）

### 3.2 Plan（建议计划）

所有 AI 输出统一落到 `ai_plan_items`，以“动作”建模：

- `bookmark_classify`: 书签 -> 分类
- `bookmark_merge`: 书签去重/合并
- `category_merge`: 分类合并

每条建议记录：

- `session_id`
- `item_type`
- `target_id`（书签或分类）
- `proposal_json`（目标分类、置信度、说明）
- `depends_on`（依赖的其他动作，支持拓扑顺序）
- `status`（`pending/applied/skipped/conflict/failed`）
- `base_revision`

### 3.3 Apply（原子应用）

应用时不再直接“逐条更新”，而是：

1. 先做冲突检测（版本、目标存在性、名称冲突、依赖完整性）。
2. 按顺序执行：
   1. 分类创建/重命名
   2. 分类合并
   3. 书签移动与应用分类建议
3. 每个“应用批次”在事务内执行，失败则回滚该批。
4. 返回结构化结果：成功数、冲突数、失败原因。

## 4. 时序安全机制

### 4.1 全局修订号（revision）

- 在 `settings` 增加 `data_revision`（整数）。
- 任何影响分类/书签归属的写操作都 `+1`。

### 4.2 失效判定

建议应用前检查：

1. `item.base_revision` 是否落后于当前 `data_revision`。
2. `target_id` 是否仍存在。
3. 当前分类路径是否仍满足建议前置条件。

不满足则标记 `conflict`，不强行应用。

## 5. 交互流程（用户视角）

1. “AI 智能整理”单入口（替代分散弹窗）。
2. 第一步选择范围与目标（只分类 / 分类+精简）。
3. 第二步生成建议（实时进度）。
4. 第三步审核（按建议类型分组、批量勾选、冲突高亮）。
5. 第四步应用（一次性执行，给出报告，可导出失败项）。

## 6. API 草案

1. `POST /api/ai/sessions`
2. `POST /api/ai/sessions/:id/generate`
3. `GET /api/ai/sessions/:id/items`
4. `POST /api/ai/sessions/:id/apply`
5. `POST /api/ai/sessions/:id/cancel`

兼容层保留旧接口：`/api/ai/classify-batch`、`/api/ai/apply-*`，内部转发到 session 流程。

## 7. 分阶段实施

### Phase 0（已完成）

1. 统一 `ai_classification_suggestions` 字段为 `suggested_category`。
2. 修复任务页与首页字段不一致导致的建议展示/应用异常。
3. 自动应用时，按 `job_id` 标记 `applied`，避免跨任务污染。

### Phase 1

1. 引入 `data_revision` 与冲突检测（最小可用版）。
2. 为现有 apply 接口增加“冲突返回”而非静默覆盖。

### Phase 2

1. 引入 `ai_session` + `ai_plan_items` 新表。
2. 接入统一审核页（替代分散建议页）。

### Phase 3

1. 下线旧精简表/旧应用接口。
2. 增加“回放与审计”能力（谁在何时应用了哪些动作）。

## 8. 评估指标

1. 建议应用成功率（无冲突直接成功）。
2. 冲突检出率（冲突被正确阻止，而不是误应用）。
3. 人工回退次数（应明显下降）。
4. 从“生成建议”到“完成应用”的平均操作步数。
5. 任务失败可解释率（失败项含结构化原因）。
