## Context

当前书签管理系统的 AI 分类/精简功能由 6 个文件实现，采用"先分类→再精简"两步流程。分类时 AI 自由创建分类导致分类爆炸，精简步骤试图修复但引入更多中间状态和操作复杂度。3 张建议表、多种应用模式（逐条/批量/自动）、两套并行路径（通用 vs 按级别）使代码难以维护，数据丢失风险高。

现有技术栈：Fastify + better-sqlite3 + OpenAI SDK，前端为 EJS + 原生 JS（Alpine.js 风格）。分类层级强制 2 级，`category-service.ts` 提供完整的分类 CRUD。Job 队列系统（`jobs.ts`）已有，可复用。

书签规模：3-5 万条。

## Goals / Non-Goals

**Goals:**
- 将"分类+精简"合并为"整理"单一流程：先设计分类树，再批量归类
- 消除中间状态复杂度：用 Plan 对象统一管理整个流程
- 原子应用 + 备份快照 + 冲突检测，确保数据安全
- 统一流程：AI 生成分类树草案 → 用户编辑确认 → AI 批量归类
- 支持三种 scope：全量(all) / 增量(uncategorized) / 指定分类(category)
- 代码量从 6 个 AI 文件收敛到 2 个

**Non-Goals:**
- 不改变分类层级结构（保持 2 级）
- 不修改 `category-service.ts`、导出/导入、浏览器扩展等非 AI 模块
- 不实现多 Plan 并行（同一时间只有一个活跃 Plan）
- 不实现分类树的协同编辑
- 不做 AI 模型选择/切换 UI（沿用现有 AI 配置）

## Decisions

### Decision 1: "先设计后归类"替代"先分类后精简"

**选择**: Phase 1 设计分类树 → Phase 2 批量归类，取消独立的精简步骤。

**理由**: 当前"自由分类→精简"本质是先制造问题再修复。先确定分类体系再往里放书签，从根源消除分类爆炸。

**替代方案**: 保留两步但简化流程 — 拒绝，因为根本问题（自由创建分类）未解决。

### Decision 2: Phase 1 本地特征提取 + AI 设计

**选择**: 从 3-5 万书签中本地提取统计特征（域名 TOP 200、关键词 TOP 100），压缩为 ~2KB 摘要发给 AI 设计分类树。

**理由**: 5 万条书签无法直接发给 AI（token 限制）。本地提取特征是零成本操作，且摘要足以让 AI 设计合理的分类体系。

**替代方案**: 随机采样 500 条书签发给 AI — 可行但信息损失大，域名长尾分布会被忽略。

### Decision 3: Phase 2 选择题模式

**选择**: 批量归类时，AI prompt 中列出完整的目标分类树，AI 只能从中选择，不能创建新分类。

**理由**: 约束 AI 输出空间，消除分类爆炸的可能性。选择题比开放题的输出更稳定、更便宜（输出 token 更少）。

**实现**: prompt 中明确列出所有分类路径，要求 AI 返回 `{"assignments": [{"index": 1, "category": "技术开发/编程"}]}`。对不在目标树中的返回值做校验拒绝。

### Decision 4: Plan 对象统一管理流程状态

**选择**: 用单个 `ai_organize_plans` 表 + Plan 对象管理整个流程，替代 3 张建议表。

**状态机**:
```
designing ──(confirm tree)──▶ assigning ──(all batches done)──▶ preview ──(apply)──▶ applied
    │                            │    │                           │                    │
    │                            │    ├─(retryable fail)─▶ failed ─(retry)─▶ assigning │
    │                            │    └─(unrecoverable)──▶ error                       │
    └──────────(cancel)──────────┴─────────(cancel)───────────────┘     (rollback ≤24h)─▶ rolled_back
```
- `failed`: 可重试的失败（如连续 5 批 AI 调用失败），用户可选择 retry 回到 assigning 或 cancel
- `error`: 不可恢复的错误（如数据库损坏），终态
- 终态（applied/canceled/rolled_back/error）上的重复操作为 no-op

**理由**: 单一状态机比多张建议表 + 多个 job 状态的组合更容易追踪和调试。

### Decision 5: 原子应用 + 备份快照

**选择**: 应用 Plan 时，先将当前状态（分类表 + 书签-分类映射）序列化为 JSON 快照存入 Plan 的 `backup_snapshot` 字段，然后在单个 SQLite 事务中执行所有变更。

**备份内容**:
```json
{
  "categories": [{"id": 1, "name": "...", "parent_id": null, ...}],
  "bookmark_categories": [{"bookmark_id": 1, "category_id": 5}, ...]
}
```

**理由**: SQLite 事务保证原子性。备份快照支持手动回滚。5 万条书签的映射 JSON 约 1-2MB，存储成本可忽略。

**替代方案**: 使用 SQLite 的 SAVEPOINT — 只能在同一连接内回滚，不支持跨会话回滚。

### Decision 6: 复用现有 Job 队列

**选择**: Phase 1 的 AI 调用和 Phase 2 的批量归类都通过现有 `jobs.ts` 的 `jobQueue` 执行，复用 `createJob`/`updateJob`/`getJob` 机制。

**理由**: Job 队列已有进度追踪、取消、状态管理能力，无需重复实现。

### Decision 7: 单个书签的实时分类保留

**选择**: `POST /api/ai/classify`（单个书签分类）保留不动，它用于浏览器扩展保存书签时的实时分类。

**理由**: 这是独立的轻量功能，与批量整理流程无关，且浏览器扩展依赖它。

### Decision 8: 统一流程（取消 auto/manual 模式区分）

**选择**: 不区分 auto/manual 模式。统一流程为：AI 生成分类树草案 → 用户在编辑器中查看/修改 → 确认锁定 → AI 批量归类。

**理由**: 用户始终需要审核 AI 生成的分类树，"auto"只是跳过编辑步骤，但这会降低用户对结果的信心。统一流程更简单，且不阻止用户直接确认（等效于 auto）。

### Decision 9: Scope 参数

**选择**: 支持三种 scope：
- `all`: 所有书签重新归类
- `uncategorized`: 仅 `category_id IS NULL` 的书签
- `category:<id>`: 指定分类下的书签（用于重新整理某个分类）

**理由**: 全量用于首次整理或大规模重组；增量用于处理新导入的未分类书签；指定分类用于局部调整。

### Decision 10: AI 重试策略（可配置）

**选择**: AI 调用参数可配置，默认值：
- 单次调用超时：60s
- 每批次最大重试：2 次（指数退避）
- 连续失败批次阈值：5 批 → Plan 转 `failed`

**理由**: 不同 AI 服务商/模型的响应速度差异大，硬编码不灵活。默认值基于 OpenAI GPT-4o-mini 的典型响应时间。

### Decision 11: 批量归类失败处理

**选择**: 单批次失败（重试耗尽后）跳过该批次，继续处理后续批次。失败批次中的书签 ID 记录到 `failedBatchBookmarkIds`。连续 5 个批次失败则 Plan 转 `failed`。

**理由**: 跳过策略最大化归类覆盖率。连续失败阈值防止在 AI 服务完全不可用时浪费资源。

### Decision 12: 未归类书签处理

**选择**: AI 无法归类的书签（低信号、无标题等）在 assignments 中标记为 `needs_review`。preview 界面单独展示待审核书签列表，用户可手动分配分类。

**理由**: 强制分配会降低整体质量，保留原分类不动则用户无感知。标记为待审核让用户主动决策。

### Decision 13: 分类命名验证

**选择**: 分类名称规则：
- 同级唯一（case-insensitive，`casefold(trim(name))` 比较）
- 长度限制 ≤ 50 字符（trim 后）
- 自动 trim 首尾空白

**理由**: 防止 AI 生成重复或过长的分类名。同级唯一而非全局唯一，允许不同父分类下有同名子分类（如"教程"可出现在"前端"和"后端"下）。

### Decision 14: 分类树数量限制

**选择**: AI 设计的分类树约束：
- 一级分类：3-20 个
- 二级分类：不限（受总数约束）
- 总分类数：≤ 200

**理由**: 下限 3 防止过度笼统，上限 20 防止一级分类爆炸。总数 200 是 3-5 万书签规模下的合理上限。

### Decision 15: 现有分类智能复用

**选择**: AI 设计分类树时，prompt 中包含现有分类列表作为参考。apply 时通过 `casefold(trim(name))` 匹配现有分类，匹配到则复用其 ID，未匹配到则创建新分类。

**理由**: 避免创建大量重复分类。名称匹配是最直观的复用策略，且与分类命名验证规则一致。

### Decision 16: 冲突检测与处理

**选择**: apply 时检测数据漂移：对比每个书签的 `updated_at` 与 Plan 的 `created_at`，`updated_at > created_at` 的书签标记为冲突。冲突书签列表返回给前端，用户逐个选择"覆盖"或"跳过"。

**理由**: 整理流程可能持续数分钟，期间用户可能通过其他途径修改书签。展示冲突让用户做最终决策，避免静默覆盖。

### Decision 17: Diff 预览粒度

**选择**: Diff 预览三层粒度：
1. 分类级汇总：新增 X 个分类、移动 Y 个书签、Z 个空分类待清理
2. 钻取：点击分类展开查看其下书签列表
3. 手动修改：用户可在 preview 中修改单个书签的归类

**理由**: 汇总提供全局视图，钻取支持抽查，手动修改支持微调。三层递进满足不同审核深度。

### Decision 18: 空分类清理

**选择**: apply 后因书签被移走而变空的旧分类，在 Diff 预览中标记并列出，用户勾选决定是否删除。

**理由**: 自动删除可能误删用户有意保留的空分类（如占位分类）。用户选择更安全。

### Decision 19: 取消语义

**选择**: 用户在任意非终态取消 Plan 时，Plan 状态转为 `canceled`，已完成的部分归类结果保留在 Plan 记录中但不可恢复执行。Plan 记录永久保留（受清理策略约束）。

**理由**: 保留记录便于审计和参考。不可恢复简化状态机，避免"半完成"状态的复杂恢复逻辑。

### Decision 20: 回滚窗口

**选择**: apply 后 24 小时内可回滚。超过 24 小时后 `backup_snapshot` 字段清空（节省存储），回滚 API 返回 403。

**理由**: 24 小时足够用户发现问题。长期保留大体积快照（1-2MB）无意义，且旧快照与当前数据偏差越来越大，回滚反而危险。

### Decision 21: Plan 进度追踪

**选择**: Plan 对象内置进度字段：
- `phase`: 当前阶段（designing / assigning / preview）
- `batches_done`: 已完成批次数
- `batches_total`: 总批次数
- `failed_batch_ids`: 失败的批次编号列表
- `needs_review_count`: 待审核书签数

前端通过轮询 `GET /api/ai/organize/:planId` 获取进度。

**理由**: 内置于 Plan 对象比依赖 Job 队列的进度更精确，且支持 phase 级别的进度展示。

### Decision 22: AI 输入字段

**选择**: 批量归类时每个书签发送给 AI 的字段：`url`、`title`、`current_category`（当前分类名称，无分类则为 null）。

**理由**: url 提供域名信号，title 提供内容信号，current_category 提供历史参考。不发送 description 等字段以控制 token 用量。

### Decision 23: Plan 清理策略

**选择**: 保留最近 5 个 Plan 记录。创建新 Plan 时检查，超出 5 个则删除最旧的非 `applied` 状态 Plan（`canceled`/`rolled_back`/`error`/`failed`）。`applied` 状态的 Plan 不计入清理（但 24h 后 snapshot 会被清空）。

**理由**: 避免 Plan 记录无限增长。保留 applied 记录作为历史审计。

## Risks / Trade-offs

**[5 万条书签的备份快照体积]** → `bookmark_categories` 映射约 1-2MB JSON，存入 SQLite TEXT 字段。可接受，但如果未来书签量增长到百万级需要改用文件存储。

**[Phase 2 批量归类的 AI 调用次数]** → 5 万条 / 每批 50 条 = 1000 次 AI 调用。按 GPT-4o-mini 价格约 $0.5-1。可通过增大批次（如 100 条/批）减少调用次数，但需注意 token 限制。

**[AI 设计的分类树质量]** → 依赖特征摘要的质量。如果书签内容高度同质（如全是技术类），AI 可能设计出过于细分的分类。用户可在 Phase 1 手动调整缓解。

**[旧数据清理]** → 删除 3 张旧建议表时，如果有未应用的建议会丢失。但用户确认当前为测试数据，可接受。

**[冲突检测的 updated_at 依赖]** → 需要 bookmarks 表有 `updated_at` 字段且在每次修改时自动更新。如果当前表结构缺少此字段，需要迁移添加。

**[24h 回滚窗口的时区问题]** → 使用 UTC 时间戳比较，避免时区歧义。

## Property-Based Testing Properties

### 状态机不变量

| Property | Invariant | Falsification Strategy |
|----------|-----------|----------------------|
| 转换合法性 | 任意相邻状态对 `(s_i, s_{i+1}) ∈ AllowedTransitions` | 生成随机事件序列（含非法跳转如 designing→applied），断言拒绝 |
| 单活跃 Plan | `\|ActivePlans\| ≤ 1`，Active = {designing, assigning, preview} | 并发创建/推进 Plan，断言 DB 中永远不超过 1 个活跃 Plan |
| 终态吸收 | 终态上的重复操作为 no-op：`cancel(cancel(p)) = cancel(p)` | 对终态重复执行相同命令，断言状态和副作用不变 |
| failed 隔离 | `failed` 仅通过显式 retry 恢复，不会隐式推进到 applied | 在 failed 状态触发后台调度，断言无状态推进 |

### 分类树不变量

| Property | Invariant | Falsification Strategy |
|----------|-----------|----------------------|
| 数量边界 | `3 ≤ L1 ≤ 20`，`depth ≤ 2`，`total ≤ 200` | 生成边界树（0/2/21 个 L1，3 层深度，201 节点），断言校验失败 |
| 同级唯一 | 兄弟节点 `casefold(trim(name_i)) ≠ casefold(trim(name_j))` | 生成仅大小写/空白不同的兄弟名（"News"、" news "、"NEWS"） |
| 名称长度 | `len(trim(name)) ≤ 50` 且 `trim(trim(name)) = trim(name)` | 生成 49/50/51 字符名称、全空白名称、Unicode 边界 |
| 复用确定性 | 兄弟顺序排列不影响分类 ID 映射 | 多次打乱兄弟顺序，断言归一化树 + 复用映射一致 |

### 批量归类不变量

| Property | Invariant | Falsification Strategy |
|----------|-----------|----------------------|
| 批次分区 | 批次大小 50（末批 1-50），覆盖全部 scope 书签 | 生成 N∈{0,1,49,50,51,100,101} 书签，断言精确分区 |
| 归类合法性 | `assignedCategoryPath ∈ PlanTreePaths` | Stub AI 返回不存在的路径，断言标记为 needs_review |
| 重试上限 | 每批次重试 ≤ 2 次，超时 60s 计为失败 | 注入超时/错误模式，断言重试次数上限和跳过行为 |
| 连续失败阈值 | 连续失败计数器：失败+1，成功归零，达 5 则 Plan→failed | 生成成功/失败流（FFFFS、SFFFFF 等），断言阈值行为 |
| 书签状态完备 | 已处理书签恰好处于 {assigned, needs_review} 之一 | 生成不可归类输出和跳过批次，断言无遗漏/重复 |

### 原子应用 + 回滚不变量

| Property | Invariant | Falsification Strategy |
|----------|-----------|----------------------|
| 原子性 | apply 后状态为完整目标态（减去冲突跳过）或完整原态，无中间态 | 在事务内随机 SQL 语句处注入失败，断言 DB 不变量 |
| 快照先行 | `backup_ts ≤ first_write_ts` | 在 backup/apply 步骤间崩溃，断言无未备份的变更 |
| 冲突检测 | `bookmark.updated_at > plan.created_at` 的书签被跳过并列为冲突 | 在 Plan 创建后随机修改书签，断言跳过集 = 谓词集 |
| 往返一致 | `rollback(apply(S)) = S`（24h 内，排除审计元数据） | 快照 DB → apply 随机 Plan → rollback → 逐字节比较 |
| 回滚窗口 | `age > 24h` 时回滚被拒绝 | 时间旅行测试：23:59:59 允许，24:00:01 拒绝 |
| 幂等性 | 对同一 Plan 重复 apply 为 no-op 或硬拒绝 | 对同一 Plan ID 调用两次 apply（含并发），断言无重复效果 |

### Scope 不变量

| Property | Invariant | Falsification Strategy |
|----------|-----------|----------------------|
| 子集关系 | `Selected(uncategorized) ⊆ Selected(all)` | 生成随机书签/分类分配，比较计算集合 |
| 确定性 | `resolve(scope, S)` 在固定快照上多次调用返回相同集合 | 同一状态下多次计算，断言输出稳定 |

### Plan 清理不变量

| Property | Invariant | Falsification Strategy |
|----------|-----------|----------------------|
| applied 保护 | applied 状态的 Plan 永远不被自动删除 | 生成大量 old applied + non-applied Plan，运行清理，断言 applied 保留 |
| 幂等性 | `cleanup(cleanup(S)) = cleanup(S)` | 对同一 DB 快照重复运行清理，diff 结果 |
| 单调性 | 清理不增加 Plan 数量，不删除较新的而保留较旧的非 applied Plan | 模糊插入顺序/时间戳，运行清理，断言顺序一致性 |
