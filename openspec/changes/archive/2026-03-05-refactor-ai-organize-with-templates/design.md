## Context

当前书签管理器的 AI 整理功能采用"AI 自动设计分类树 → 用户编辑 → AI 批量归类"的三阶段流程。核心问题：

1. AI 设计的分类树质量不稳定，每次整理都重新设计，不可复用
2. 整理入口单一（仅工具栏一个按钮），无法对选中书签进行 AI 分类
3. 同时只能有一个活跃任务，限制了使用灵活性
4. 任务详情页的单个书签应用按钮破坏了事务一致性

技术栈：TypeScript + Fastify + better-sqlite3（后端），Alpine.js + Tailwind CSS + EJS（前端）。分类强制 2 级层级。

## Goals / Non-Goals

**Goals:**
- 用预置/自定义分类模板替代 AI 自动设计分类树
- 模板可切换，切换时保存/恢复书签分布快照
- 提供多入口 AI 分类（全部/未分类/选中/单个/本页）
- 允许多个已完成任务并存待应用（执行串行）
- 应用时后者覆盖前者，空分类由用户确认删除
- 修复设置页预设下拉框 bug
- 清理废弃代码

**Non-Goals:**
- 不实现 AI 设计模板功能（仅预留 beta 入口）
- 不实现 AI 改造模板功能（仅预留 beta 入口）
- 不修改浏览器扩展的 `POST /api/ai/classify` 单个分类接口
- 不修改导入/导出功能
- 不修改书签检查功能

## Decisions

### D1: 模板存储方案 — 数据库持久化

新增 `category_templates` 表存储模板定义，`template_snapshots` 表存储书签分布快照。

```sql
CREATE TABLE IF NOT EXISTS category_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'preset',  -- 'preset' | 'custom'
  tree TEXT NOT NULL,                    -- JSON: [{name:"一级",children:[{name:"二级"}]}]
  is_active INTEGER NOT NULL DEFAULT 0, -- 当前激活的模板（全局唯一）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_snapshots (
  template_id INTEGER NOT NULL REFERENCES category_templates(id) ON DELETE CASCADE,
  bookmark_id INTEGER NOT NULL,
  category_path TEXT NOT NULL,           -- 如 "技术/编程"
  PRIMARY KEY (template_id, bookmark_id)
);
```

**为什么不用前端存储**：模板和快照数据量可能较大（数千书签的映射），且需要后端事务保证切换的原子性。

**为什么不硬编码预置模板**：存入数据库后，预置模板也可以被用户复制编辑，统一了 CRUD 逻辑。

### D2: 模板切换的原子性

模板切换在单个 SQLite 事务中完成：

```
BEGIN TRANSACTION
  1. 保存当前激活模板的书签分布快照 → template_snapshots
  2. 清空 categories 表
  3. 将所有书签的 category_id 设为 NULL
  4. 根据新模板的 tree JSON 创建 categories 记录
  5. 如果新模板有历史快照 → 从 template_snapshots 恢复书签分布
  6. 更新 is_active 标记
COMMIT
```

**为什么完全替换而非智能合并**：用户明确要求"应用模板时完全替换"。智能合并的边界情况太多（同名不同含义的分类、层级变化等），完全替换语义清晰。

**快照保留策略**：更新模板 `tree` 时保留该模板的历史快照。恢复时按 `category_path` 精确匹配（trim 后比较），路径不匹配的书签保持未分类。

### D3: 状态机简化 — 移除 designing 阶段

旧状态机：`designing → assigning → preview → applied`
新状态机：`assigning → preview → applied`

`designing` 阶段的职责（AI 设计分类树 + 用户编辑）被模板系统完全替代。Plan 创建时直接进入 `assigning` 状态。

**代码影响**：
- `src/ai-organize-plan.ts`：`ACTIVE_STATUSES` 移除 `designing`，`PlanStatus` 类型移除 `designing`，`createPlan()` 初始状态改为 `assigning`，`canTransition()` 移除 `designing` 相关转换
- `src/routes/ai.ts`：移除 `PUT /api/ai/organize/:planId/tree` 路由
- `public/app.js`：移除 `organizePhase === 'editing'` 和 `organizePhase === 'designing'` 相关 UI
- `views/index.ejs`：移除分类树编辑器模板

### D4: 多任务并存策略

**执行层**：`assigning` 状态的 Plan 最多 1 个（通过 `createPlan()` 中的检查保证）。
**待应用层**：`preview` 状态的 Plan 可以多个并存。

修改 `createPlan()` 的活跃检查逻辑：
- 旧逻辑：`ACTIVE_STATUSES = ['designing', 'assigning', 'preview']`，任何一个存在就 409
- 新逻辑：仅检查 `assigning` 状态是否存在，`preview` 状态不阻塞新任务创建

**应用冲突解决**：当多个 `preview` 任务涉及同一书签时，后应用的覆盖先应用的（最后写入生效）。实现方式：应用时直接 `UPDATE bookmarks SET category_id = ? WHERE id = ?`，SQLite 的最后写入自然覆盖。

**Plan 绑定模板**：`ai_organize_plans` 表新增 `template_id` 列（NOT NULL，外键引用 `category_templates(id)`）。Plan 创建时记录当前激活模板 ID。应用 Plan 时，若当前激活模板与 Plan 的 `template_id` 不同，系统先自动切换到 Plan 对应的模板（触发快照保存/恢复），再执行应用操作。

### D5: AI 分类 Prompt 重构

旧 prompt：AI 从锁定的目标分类树中选择（选择题模式）。
新 prompt：AI 从当前已有的 categories 中匹配（基于实际分类）。

请求格式：
```json
{
  "bookmarks": [
    {"index": 1, "url": "https://...", "title": "..."}
  ],
  "categories": ["技术/编程", "技术/前端", "生活/购物", ...]
}
```

响应格式：
```json
{
  "assignments": [
    {"index": 1, "category": "技术/编程"}
  ]
}
```

System prompt 强调：
1. 联网访问 URL 了解内容
2. 只能从提供的 categories 列表中选择
3. 无合适分类则返回空字符串（程序将其放入未分类）
4. 严格返回 JSON

**needs_review 应用行为**：AI 返回空字符串或不在 categories 列表中的路径 → 该书签在 Plan 中标记为 `needs_review`（category 为空）。用户应用 Plan 时，`needs_review` 书签的 `category_id` 设为 NULL（未分类）。用户通过"是否应用整个 Plan"来决定这些书签的最终归属——应用则变为未分类，不应用则保持原分类。

### D6: 多入口 AI 分类的统一后端

所有入口最终调用同一个 `POST /api/ai/classify-batch` 端点：

```typescript
POST /api/ai/classify-batch
Body: {
  bookmark_ids: number[],     // 要分类的书签 ID 列表
  batch_size?: number,        // 每批数量，默认 20，可选 10/20/30
}
```

前端根据入口不同，组装不同的 `bookmark_ids`：
- 全部书签：查询所有书签 ID
- 未分类书签：查询 `category_id IS NULL` 的书签 ID
- 选中书签：直接传选中的 ID
- 单个书签：传单个 ID
- 本页书签：传当前页的 ID（当前列表视图在当前筛选/搜索/排序条件下、当前分页页码实际渲染的书签 ID 集合）

**batch_size 校验**：前端 UI 仅允许从 `{10, 20, 30}` 中选择。后端收到不在此集合中的值时返回 400 错误。

### D7: 预置模板设计

4 版预置模板，种子数据在 `src/db.ts` 的迁移中插入：

**综合通用版**（~12 个一级）：
技术开发、学习教育、工具软件、新闻资讯、社交媒体、娱乐影音、购物电商、生活服务、设计创意、金融理财、游戏、成人内容

**开发者版**（~10 个一级）：
编程语言、框架与库、开发工具、云服务与运维、技术社区、学习资源、AI与数据、开源项目、职业发展、其他

**生活娱乐版**（~10 个一级）：
购物电商、美食餐饮、旅行出行、健康运动、影视音乐、游戏、社交、新闻资讯、学习成长、实用工具

**极简版**（~6 个一级）：
工作、学习、生活、娱乐、工具、其他

每个一级分类下包含 2-5 个二级分类。具体二级分类在实现时细化。

**模板 tree 校验规则**：
- 预置模板：最大深度 2 级、一级最多 20 个、每个一级下二级最多 10 个
- 自定义模板：最大深度 2 级，一级和二级数量不限制
- 通用规则：名称非空（trim 后）、同层禁止重名、名称中禁止包含 `/` 字符

### D8: 空分类确认流程

应用 AI 分类任务后，检测变空的分类（无书签且无子分类），返回给前端让用户确认：

```typescript
// POST /api/ai/organize/:planId/apply 响应
{
  success: true,
  applied_count: number,
  empty_categories: { id: number, name: string }[],  // 变空的分类
  needs_confirm: boolean  // true 表示有空分类需要确认
}
```

前端展示空分类列表，用户逐个选择"删除"或"保留"，然后调用确认接口：

```typescript
// POST /api/ai/organize/:planId/apply/confirm-empty
Body: {
  decisions: { id: number, action: 'delete' | 'keep' }[]
}
```

**无超时**：Plan 在等待空分类确认期间保持中间态（`preview` 状态不变），不设超时。用户下次打开页面时继续确认。服务端在 `confirm-empty` 时重新校验空分类集合（确认时仍为空且为叶子分类），未提交的空分类 ID 默认保留（keep）。

### D9: 设置页预设下拉框 Bug 修复

`views/settings.ejs:448` 的 `this.value = ''` 在选择预设后重置了 select 的值，导致显示回"快捷预设"。

修复：移除 `this.value = ''`，让 select 保持选中状态。

### D10: 启动时恢复 assigning Plan

服务启动时立即检测所有 `assigning` 状态的 Plan，将其标记为 `error`，关联 Job 标记为 `failed`（reason: `server_restart`）。确保服务重启后不会有僵死的 assigning Plan 阻塞新任务创建。

## Risks / Trade-offs

**[模板切换时全部书签变未分类]** → 用户可能误操作导致大量书签失去分类。缓解：切换前弹出确认对话框，明确告知影响；快照机制保证可切回恢复。

**[多任务并存的复杂性]** → 多个 preview 任务涉及同一书签时，用户可能困惑于最终结果。缓解：应用时明确提示"后者覆盖前者"的规则；任务详情页显示创建时间。

**[快照数据量]** → 大量书签（数万）的快照可能占用较多存储。缓解：`template_snapshots` 使用复合主键，无冗余；切换模板时旧快照被覆盖而非追加。

**[移除 designing 阶段的不可逆性]** → 未来如果需要恢复 AI 设计树功能，需要重新添加状态。缓解：beta 入口预留了代码路径，`designCategoryTree()` 函数保留但从主流程移除。

## Migration Plan

1. 数据库迁移在 `src/db.ts` 中以 `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` 方式添加，兼容现有数据
2. 预置模板作为种子数据在迁移中插入（`INSERT OR IGNORE`）
3. 现有 `ai_organize_plans` 表中处于 `designing` 状态的 Plan 在迁移时标记为 `canceled`
4. 旧的 `ai_classification_suggestions` / `ai_simplify_suggestions` 表已在之前的迁移中 DROP，无需处理
5. 回滚策略：如需回滚，删除新增的两张表即可，`ai_organize_plans` 的逻辑变更通过代码回滚处理
