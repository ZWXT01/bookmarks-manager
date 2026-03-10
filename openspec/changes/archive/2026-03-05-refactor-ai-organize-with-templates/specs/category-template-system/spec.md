## ADDED Requirements

### Requirement: Template database storage
系统 SHALL 使用 `category_templates` 表存储分类模板，包含 `id`（自增主键）、`name`（模板名称）、`type`（`preset` 或 `custom`）、`tree`（JSON 格式的分类树）、`is_active`（是否为当前激活模板，全局唯一）、`created_at`、`updated_at`。

#### Scenario: Table creation on startup
- **WHEN** 应用启动执行数据库迁移
- **THEN** `category_templates` 表 MUST 被创建（`CREATE TABLE IF NOT EXISTS`）

#### Scenario: Preset templates seeded
- **WHEN** 应用首次启动且 `category_templates` 表为空
- **THEN** 系统 MUST 插入 4 版预置模板（综合通用版、开发者版、生活娱乐版、极简版），`type` 为 `preset`

#### Scenario: Seed idempotency
- **WHEN** 应用非首次启动且预置模板已存在
- **THEN** 系统 MUST NOT 重复插入预置模板（使用 `INSERT OR IGNORE` 或先检查）

### Requirement: Template snapshot storage
系统 SHALL 使用 `template_snapshots` 表存储每个模板下的书签-分类映射快照，复合主键为 `(template_id, bookmark_id)`，包含 `category_path`（如 "技术/编程"）。

#### Scenario: Snapshot table creation
- **WHEN** 应用启动执行数据库迁移
- **THEN** `template_snapshots` 表 MUST 被创建，`template_id` 外键引用 `category_templates(id)` 且 `ON DELETE CASCADE`

### Requirement: Preset template content
系统 SHALL 提供 4 版预置模板，每版包含一级分类和对应的二级分类，覆盖工作/生活/娱乐场景。

#### Scenario: General template
- **WHEN** 用户查看"综合通用版"模板
- **THEN** 模板包含约 12 个一级分类（技术开发、学习教育、工具软件、新闻资讯、社交媒体、娱乐影音、购物电商、生活服务、设计创意、金融理财、游戏、成人内容），每个一级下包含 2-5 个二级分类

#### Scenario: Developer template
- **WHEN** 用户查看"开发者版"模板
- **THEN** 模板包含约 10 个一级分类，以技术开发为主（编程语言、框架与库、开发工具、云服务与运维、技术社区、学习资源、AI与数据、开源项目、职业发展、其他）

#### Scenario: Lifestyle template
- **WHEN** 用户查看"生活娱乐版"模板
- **THEN** 模板包含约 10 个一级分类，以生活娱乐为主（购物电商、美食餐饮、旅行出行、健康运动、影视音乐、游戏、社交、新闻资讯、学习成长、实用工具）

#### Scenario: Minimal template
- **WHEN** 用户查看"极简版"模板
- **THEN** 模板包含约 6 个一级分类（工作、学习、生活、娱乐、工具、其他），每个一级下包含 2-3 个二级分类

### Requirement: Template tree validation
系统 SHALL 在创建和更新模板时校验 `tree` JSON 结构。

#### Scenario: Preset template tree validation
- **WHEN** 校验 `type: 'preset'` 的模板 tree
- **THEN** 最大深度 MUST 为 2 级、一级分类最多 20 个、每个一级下二级最多 10 个、名称非空（trim 后）、同层禁止重名、名称中禁止包含 `/` 字符

#### Scenario: Custom template tree validation
- **WHEN** 校验 `type: 'custom'` 的模板 tree
- **THEN** 最大深度 MUST 为 2 级、名称非空（trim 后）、同层禁止重名、名称中禁止包含 `/` 字符，一级和二级数量不限制

#### Scenario: Invalid tree rejected
- **WHEN** 客户端提交不符合校验规则的 tree
- **THEN** 返回 400 错误，包含具体的校验失败原因

### Requirement: Template snapshot retention on edit
系统 SHALL 在模板 `tree` 被编辑后保留该模板的历史快照。

#### Scenario: Update template tree with existing snapshots
- **WHEN** 客户端更新模板的 `tree`，该模板已有历史快照
- **THEN** 系统保留快照不清空。下次从快照恢复时按 `category_path` 精确匹配（trim 后比较），路径不匹配的书签保持未分类

### Requirement: Template CRUD API
系统 SHALL 提供模板的增删改查 API。

#### Scenario: List all templates
- **WHEN** 客户端调用 `GET /api/templates`
- **THEN** 返回所有模板列表，包含 `id`、`name`、`type`、`is_active`、`created_at`、`updated_at`，不含 `tree` 字段（减少传输量）

#### Scenario: Get template detail
- **WHEN** 客户端调用 `GET /api/templates/:id`
- **THEN** 返回模板完整信息，包含 `tree` JSON

#### Scenario: Create custom template
- **WHEN** 客户端调用 `POST /api/templates`，body 含 `name` 和 `tree`
- **THEN** 系统创建 `type: 'custom'` 的模板，返回创建的模板

#### Scenario: Create template from preset
- **WHEN** 客户端调用 `POST /api/templates`，body 含 `name`、`tree` 和 `source_id`（源模板 ID）
- **THEN** 系统创建 `type: 'custom'` 的模板（复制源模板的 tree 并允许修改），返回创建的模板

#### Scenario: Update template
- **WHEN** 客户端调用 `PUT /api/templates/:id`，body 含 `name` 和/或 `tree`
- **THEN** 系统更新模板的 `name`/`tree` 和 `updated_at`

#### Scenario: Update preset template rejected
- **WHEN** 客户端调用 `PUT /api/templates/:id`，目标模板 `type` 为 `preset`
- **THEN** 返回 403 错误，预置模板不可直接修改

#### Scenario: Delete custom template
- **WHEN** 客户端调用 `DELETE /api/templates/:id`，目标模板 `type` 为 `custom`
- **THEN** 系统删除该模板及其关联的 `template_snapshots`（通过 CASCADE）

#### Scenario: Delete preset template rejected
- **WHEN** 客户端调用 `DELETE /api/templates/:id`，目标模板 `type` 为 `preset`
- **THEN** 返回 403 错误，预置模板不可删除

#### Scenario: Delete active template rejected
- **WHEN** 客户端调用 `DELETE /api/templates/:id`，目标模板 `is_active` 为 1
- **THEN** 返回 400 错误，当前激活的模板不可删除

### Requirement: Apply template
系统 SHALL 提供 `POST /api/templates/:id/apply` 端点，在单个数据库事务中完成模板应用。

#### Scenario: Apply template (first time, no active template)
- **WHEN** 客户端调用 `POST /api/templates/:id/apply`，当前无激活模板
- **THEN** 系统在事务中：清空 `categories` 表 → 所有书签 `category_id` 设为 NULL → 根据模板 `tree` 创建 categories 记录 → 设置该模板 `is_active = 1`

#### Scenario: Apply template (switch to new template)
- **WHEN** 客户端调用 `POST /api/templates/:id/apply`，当前有激活模板 A，目标模板 B 无历史快照
- **THEN** 系统在事务中：保存模板 A 的书签分布到 `template_snapshots` → 清空 `categories` 表 → 所有书签 `category_id` 设为 NULL → 根据模板 B 的 `tree` 创建 categories → 设置模板 B `is_active = 1`，模板 A `is_active = 0`

#### Scenario: Apply template (switch back to used template)
- **WHEN** 客户端调用 `POST /api/templates/:id/apply`，目标模板 B 有历史快照
- **THEN** 系统在事务中：保存当前模板快照 → 清空 categories → 根据模板 B 的 tree 创建 categories → 从 `template_snapshots` 恢复模板 B 的书签分布 → 更新 `is_active`

#### Scenario: Snapshot saves current bookmark distribution
- **WHEN** 系统保存模板快照
- **THEN** 对每个有 `category_id` 的书签，将 `(template_id, bookmark_id, category_path)` 写入 `template_snapshots`，其中 `category_path` 为该分类的完整路径（如 "技术/编程"）

#### Scenario: Snapshot restore maps paths to categories
- **WHEN** 系统从快照恢复书签分布
- **THEN** 对每条快照记录，查找新创建的 categories 中路径匹配的分类 ID，将书签的 `category_id` 更新为该 ID；如果路径不匹配（模板被编辑过），该书签保持未分类

#### Scenario: Apply same active template is no-op
- **WHEN** 客户端调用 `POST /api/templates/:id/apply`，目标模板已是当前激活模板
- **THEN** 返回成功但不执行任何操作

### PBT Properties: Template System

#### Property: Template switch atomicity
- **INVARIANT** `applyTemplate()` 是全有或全无：失败时 `categories`、`bookmarks.category_id`、`is_active`、`template_snapshots` 均与操作前一致；成功时 `|ActiveTemplate| = 1`
- **FALSIFICATION** 在事务各子步骤后注入失败点，验证回滚完整性

#### Property: Active template uniqueness
- **INVARIANT** 任意时刻 `count(is_active=1) ≤ 1`
- **FALSIFICATION** 随机序列调用 `applyTemplate(tid)`（含重复同 tid），每步后断言唯一性

#### Property: Apply same template is idempotent
- **INVARIANT** 若 `B` 已激活，`applyTemplate(B)` 不改变任何行
- **FALSIFICATION** 随机 DB + 激活模板 B，快照 DB，调用两次 `applyTemplate(B)`，断言深度相等

#### Property: Snapshot round-trip
- **INVARIANT** 若模板 tree 路径未变，`saveSnapshot(T)` → 清空 → 重建 → `restoreSnapshot(T)` 后 `∀b: path_pre(b) = path_post(b)`
- **FALSIFICATION** 随机模板 + 随机书签分布，执行 save→clear→recreate→restore，比较 `(b→path)` 映射

#### Property: Unmatched snapshot paths stay uncategorized
- **INVARIANT** `∀(T,b,p) where trim(p) ∉ Paths(T): category_id(b) = NULL`
- **FALSIFICATION** 编辑模板删除/重命名路径后恢复快照，验证受影响书签为 NULL

#### Property: Tree validation — preset bounds
- **INVARIANT** preset 校验通过 iff: depth≤2 ∧ topLevel≤20 ∧ ∀top:children≤10 ∧ ∀name:trim(name)≠'' ∧ '/'∉name ∧ 同层无重名
- **FALSIFICATION** 生成边界违规树（21 个一级、11 个二级、含 `/` 名称、空名称、同层重名），断言拒绝

#### Property: Tree validation — custom vs preset divergence
- **INVARIANT** 超出 preset 数量限制但满足其他规则的 tree，custom 接受而 preset 拒绝
- **FALSIFICATION** 生成 21 个一级或 11 个二级的 tree，断言 preset 拒绝 + custom 接受

#### Property: Duplicate detection is per-sibling-set
- **INVARIANT** 不同父节点下的同名子节点合法；同父节点下的同名子节点非法
- **FALSIFICATION** 生成跨父同名（应通过）和同父同名（应拒绝）的 tree

### Requirement: Template management sidebar UI
前端 SHALL 在主页侧边栏分类树上方提供模板管理区域。

#### Scenario: Show active template
- **WHEN** 用户访问主页且有激活模板
- **THEN** 侧边栏显示当前激活模板名称和"切换模板"按钮

#### Scenario: Show no template hint
- **WHEN** 用户访问主页且无激活模板
- **THEN** 侧边栏显示"请先选择分类模板"提示和"选择模板"按钮

#### Scenario: Template selector
- **WHEN** 用户点击"切换模板"或"选择模板"
- **THEN** 弹出模板选择面板，列出所有模板（预置和自定义），每个模板显示名称、类型标签、一级分类数量

#### Scenario: Apply template confirmation
- **WHEN** 用户在模板选择面板中点击"应用"
- **THEN** 弹出确认对话框，明确告知"应用模板将替换当前所有分类，所有书签将变为未分类（如果该模板曾使用过，书签分布将自动恢复）"

#### Scenario: Edit template
- **WHEN** 用户点击自定义模板的"编辑"按钮
- **THEN** 打开模板编辑面板，可修改模板名称和分类树（增删改一级/二级分类）

#### Scenario: Create custom template from preset
- **WHEN** 用户点击预置模板的"复制为自定义"按钮
- **THEN** 系统复制该预置模板为新的自定义模板，打开编辑面板

#### Scenario: Create blank custom template
- **WHEN** 用户点击"新建自定义模板"按钮
- **THEN** 打开模板编辑面板，初始为空分类树

### Requirement: Beta feature entry points
前端 SHALL 在模板管理区域预留"AI 设计模板"和"AI 改造模板"两个 beta 功能入口。

#### Scenario: Beta buttons visible
- **WHEN** 用户查看模板管理区域
- **THEN** 显示"AI 设计模板 (Beta)"和"AI 改造模板 (Beta)"按钮，带 beta 标签

#### Scenario: Beta buttons disabled
- **WHEN** 用户点击 beta 功能按钮
- **THEN** 显示 toast 提示"该功能正在开发中，敬请期待"
