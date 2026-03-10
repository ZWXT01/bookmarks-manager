## MODIFIED Requirements

### Requirement: Template management sidebar UI
前端 SHALL 在主页侧边栏分类树上方提供模板管理区域。

#### Scenario: Show active template
- **WHEN** 用户访问主页且有激活模板
- **THEN** 侧边栏显示当前激活模板名称和"切换模板"按钮

#### Scenario: Show no template hint
- **WHEN** 用户访问主页且无激活模板
- **THEN** 侧边栏显示"请先选择分类模板"提示和"选择模板"按钮

#### Scenario: Template selector grouped display
- **WHEN** 用户点击"切换模板"或"选择模板"
- **THEN** 弹出模板选择面板（宽度 `max-w-3xl`），模板列表分为"预置模板"和"自定义模板"两个分组区块，每个模板显示名称、类型标签、一级分类数量

#### Scenario: Preset template actions
- **WHEN** 用户查看预置模板列表
- **THEN** 每个预置模板仅显示"应用"按钮，不显示"复制"、"编辑"或"删除"按钮

#### Scenario: Custom template actions
- **WHEN** 用户查看自定义模板列表
- **THEN** 每个自定义模板显示"编辑"、"删除"（非激活时）和"应用"（非激活时）按钮

#### Scenario: Apply template confirmation
- **WHEN** 用户在模板选择面板中点击"应用"
- **THEN** 弹出确认对话框，明确告知"应用模板将替换当前所有分类，所有书签将变为未分类（如果该模板曾使用过，书签分布将自动恢复）"

#### Scenario: Edit template
- **WHEN** 用户点击自定义模板的"编辑"按钮
- **THEN** 打开模板编辑面板（宽度 `max-w-3xl`），可修改模板名称和分类树（增删改一级/二级分类）

#### Scenario: Template edit modal no backdrop close
- **WHEN** 用户在模板编辑面板中点击遮罩层（窗口外区域）
- **THEN** 编辑面板不关闭，防止误触导致编辑丢失

#### Scenario: Template edit modal ESC close with unsaved confirmation
- **WHEN** 用户在模板编辑面板中按 ESC 键且存在未保存的变更（模板名称或分类树与打开时不同）
- **THEN** 弹出确认对话框："有未保存的修改，确定要关闭吗？"，用户确认后关闭编辑面板，取消则保持编辑状态

#### Scenario: Template edit modal ESC close without changes
- **WHEN** 用户在模板编辑面板中按 ESC 键且无未保存的变更
- **THEN** 直接关闭编辑面板

#### Scenario: Create custom template with source selection
- **WHEN** 用户点击"新建自定义模板"按钮
- **THEN** 打开模板编辑面板，顶部显示"基于"下拉选择器，选项包含"空白模板"和所有预置模板名称

#### Scenario: Create from blank
- **WHEN** 用户在"基于"选择器中选择"空白模板"（默认）
- **THEN** 分类树编辑区域为空

#### Scenario: Create from preset template
- **WHEN** 用户在"基于"选择器中选择某个预置模板
- **THEN** 前端调用 `GET /api/templates/:id` 获取该预置模板的完整 tree，加载到分类树编辑区域供用户修改

### Requirement: Beta feature entry points
前端 SHALL 在模板管理区域预留"AI 设计模板"和"AI 改造模板"两个 beta 功能入口。

#### Scenario: Beta buttons visible
- **WHEN** 用户查看模板管理区域
- **THEN** 显示"AI 设计模板 (Beta)"和"AI 改造模板 (Beta)"按钮，带 beta 标签

#### Scenario: Beta buttons disabled
- **WHEN** 用户点击 beta 功能按钮
- **THEN** 显示 toast 提示"该功能正在开发中，敬请期待"
