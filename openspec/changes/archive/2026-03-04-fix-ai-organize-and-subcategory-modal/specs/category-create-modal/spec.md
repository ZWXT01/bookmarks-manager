## ADDED Requirements

### Requirement: Unified category creation modal
前端 SHALL 提供统一的分类创建弹窗，同时用于子分类创建和一级分类创建，替换浏览器原生 `prompt()` 和内联输入框。

#### Scenario: Open modal for subcategory
- **WHEN** 用户点击侧边栏分类节点的"+"按钮
- **THEN** 弹窗打开，标题显示"添加子分类"，`createCategoryParentId` 设为该分类 ID

#### Scenario: Open modal for top category
- **WHEN** 用户点击分类区域的"+ 添加分类"按钮
- **THEN** 弹窗打开，标题显示"添加分类"，`createCategoryParentId` 为 null

#### Scenario: Modal contains name, icon, color inputs
- **WHEN** 分类创建弹窗打开
- **THEN** 弹窗包含：名称输入框（必填）、图标选择（emoji grid）、颜色选择（color grid）、取消/确认按钮

#### Scenario: Confirm creates category with style
- **WHEN** 用户填写名称并选择图标/颜色后点击确认
- **THEN** 前端调用 `POST /api/categories`（body 含 name、parent_id、icon、color），成功后关闭弹窗、刷新分类列表、展开父分类（如有）

#### Scenario: Cancel closes modal
- **WHEN** 用户点击取消或弹窗外部区域
- **THEN** 弹窗关闭，不执行任何操作

#### Scenario: Inline input removed
- **WHEN** 用户查看分类管理区域
- **THEN** 原有的内联输入框 + 按钮已被替换为"+ 添加分类"按钮
