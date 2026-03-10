## 1. 后端修复

- [x] 1.1 修改 `src/routes/ai.ts` 中 `POST /api/ai/organize` 的 catch 块（L94-99）：移除 `mode` 字段，失败时返回 `{ success: true, planId, treeReady: false, message: e.message }`；成功路径（L101）返回 `{ success: true, planId, treeReady: true }`
- [x] 1.2 修改 `src/routes/categories.ts` 中 `POST /api/categories`（L52-93），从 body 提取 `icon`/`color`，透传给 `createSubCategory()` 和 `createTopCategory()` 的 options 参数（路径格式 `getOrCreateCategoryByPath` 不透传）

## 2. 前端 AI 整理 Bug 修复

- [x] 2.1 修改 `public/app.js` 中 `startOrganize()` 方法（L1612-1624），在 `data.success` 检查后增加 `data.treeReady === false` 判断，toast 提示 `data.message || data.error`，仍跳到 editing 阶段

## 3. 统一分类创建弹窗

- [x] 3.1 在 `public/app.js` 中新增状态变量：`showCreateCategoryModal: false`、`createCategoryParentId: null`、`createCategoryName: ''`、`createCategoryIcon: ''`、`createCategoryColor: ''`
- [x] 3.2 在 `public/app.js` 中新增 `openCreateCategoryModal(parentId)` 方法（重置状态并打开弹窗，parentId 为 null 时表示一级分类）和 `closeCreateCategoryModal()` 方法
- [x] 3.3 在 `public/app.js` 中新增 `confirmCreateCategory()` 方法：从弹窗状态变量读取数据，调用 `POST /api/categories`（body 含 name、parent_id、icon、color），成功后关闭弹窗、刷新分类列表、展开父分类（如有）
- [x] 3.4 移除 `public/app.js` 中 `createSubCategory()` 方法（L979-1004）和 `newCategoryName` 状态变量，`createCategory()` 方法改为调用 `openCreateCategoryModal(null)`
- [x] 3.5 在 `views/index.ejs` 中新增分类创建弹窗 HTML（参照 `showCategoryStyleModal` 的模式，L640-678），包含名称输入、图标选择、颜色选择，弹窗标题根据 `createCategoryParentId` 动态显示"添加分类"或"添加子分类"
- [x] 3.6 修改 `views/index.ejs` 中调用 `createSubCategory(cat.id)` 的按钮（L193），改为调用 `openCreateCategoryModal(cat.id)`
- [x] 3.7 修改 `views/index.ejs` 中一级分类创建区域（L254-257），移除内联输入框 + 按钮，改为单个"+ 添加分类"按钮调用 `openCreateCategoryModal(null)`
