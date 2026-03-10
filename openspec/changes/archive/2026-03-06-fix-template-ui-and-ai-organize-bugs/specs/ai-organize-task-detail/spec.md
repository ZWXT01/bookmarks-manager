## ADDED Requirements

### Requirement: AI organize job detail data
后端 SHALL 在渲染 `ai_organize` 类型 job 的详情页时，查询关联的 plan 并将 assignments 数据传给模板。

#### Scenario: Load plan assignments for ai_organize job
- **WHEN** 用户访问 `GET /jobs/:id`，该 job 的 type 为 `ai_organize`
- **THEN** 后端通过 `ai_organize_plans.job_id` 查询关联的 plan，解析 plan 的 `assignments` JSON，将 assignments 列表（含 bookmark_id、category_path、status）和 plan 状态传给 EJS 模板

#### Scenario: Enrich assignments with bookmark info
- **WHEN** 后端加载 plan assignments
- **THEN** 对每条 assignment，关联查询 bookmarks 表获取 title 和 url，返回 `{ bookmark_id, title, url, category_path, status }` 列表

#### Scenario: Deleted bookmark in assignments
- **WHEN** assignment 关联的书签已被删除（bookmarks 表中不存在该 bookmark_id）
- **THEN** 该条 assignment 仍显示在列表中，title 显示为"[已删除的书签]"，url 为空，保留分类建议和状态信息

#### Scenario: No associated plan
- **WHEN** `ai_organize` 类型 job 无关联 plan（plan 已被清理）
- **THEN** 模板显示"无关联的整理计划"提示，不显示 assignments 区域

### Requirement: AI organize job detail UI
前端 SHALL 为 `ai_organize` 类型 job 提供独立的任务详情展示区域，与书签有效性检查任务模板区分。

#### Scenario: Show ai_organize detail section
- **WHEN** 用户查看 `ai_organize` 类型 job 的详情页
- **THEN** 页面显示"AI 整理结果"区块，包含：分类建议列表（每条显示书签标题、URL、建议分类路径、状态）、统计摘要（已分配数、待审核数）、关联 plan 的状态

#### Scenario: Assignment status display
- **WHEN** assignment 的 status 为 `assigned`
- **THEN** 显示建议的分类路径，标记为"已分配"（蓝色标签）

#### Scenario: Needs review status display
- **WHEN** assignment 的 status 为 `needs_review`
- **THEN** 显示"待审核"标签（橙色），分类路径显示为"未匹配"

#### Scenario: Plan status display
- **WHEN** 关联 plan 的状态为 `preview`
- **THEN** 显示"待应用"状态，并提供"前往应用"链接（跳转回主页 AI 整理窗口）

#### Scenario: Plan applied status
- **WHEN** 关联 plan 的状态为 `applied`
- **THEN** 显示"已应用"状态（绿色标签），assignments 中 `assigned` 的条目标记为"已应用"

#### Scenario: Plan canceled status
- **WHEN** 关联 plan 的状态为 `canceled`
- **THEN** 显示"已取消"状态（灰色标签）

#### Scenario: Pagination for assignments
- **WHEN** assignments 数量超过 20 条
- **THEN** 分页展示，每页 20 条，提供上一页/下一页控件

### Requirement: Bookmark check job detail unchanged
书签有效性检查任务（`bookmark_check` 类型）的详情页 SHALL 保持现有展示不变。

#### Scenario: Bookmark check job renders existing template
- **WHEN** 用户查看 `bookmark_check` 类型 job 的详情页
- **THEN** 页面渲染现有的失败项表格，不显示 AI 整理结果区块

### PBT Properties: Assignment Data Enrichment

#### Property: Assignment count preservation
- **INVARIANT** 设 `A` 为 plan assignments JSON 解析后的条目集合，enriched 输出条目数 `|output| === |A|`，无丢失无新增
- **FALSIFICATION** 生成随机 assignments JSON（含空、大量、重复 bookmark_id），加上随机 DB 书签子集，断言输出条目数等于输入条目数

#### Property: Bookmark placeholder correctness
- **INVARIANT** 对每条 assignment：若 `bookmark_id` 存在于 bookmarks 表，则 `title/url` 匹配 DB 值；若不存在，则 `title === "[已删除的书签]"` 且 `url === ""`
- **FALSIFICATION** 生成 DB 书签为引用 ID 的随机子集，断言存在的 ID 匹配 DB、缺失的 ID 使用占位符。包含"plan 创建后书签被删除"的场景
