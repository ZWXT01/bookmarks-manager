## ADDED Requirements

### Requirement: Global custom dialog component
系统 SHALL 提供全局自定义弹窗组件 `AppDialog`，替换所有浏览器原生 `confirm()` 和 `alert()` 调用，保持与项目 UI 风格一致。

#### Scenario: Confirm dialog returns Promise
- **WHEN** 代码调用 `AppDialog.confirm(message, options)`
- **THEN** 显示自定义确认弹窗（含消息文本、确认按钮、取消按钮），返回 Promise，用户点击确认 resolve `true`，点击取消 resolve `false`

#### Scenario: Alert dialog returns Promise
- **WHEN** 代码调用 `AppDialog.alert(message, options)`
- **THEN** 显示自定义提示弹窗（含消息文本和确认按钮），返回 Promise，用户点击确认后 resolve

#### Scenario: Dialog styling matches project UI
- **WHEN** 弹窗显示时
- **THEN** 弹窗使用 Tailwind CSS 样式，包含半透明遮罩层（z-50）、居中白色面板、圆角阴影，与项目现有模态框风格一致

#### Scenario: Dialog supports dark theme
- **WHEN** 页面处于暗色主题（`data-theme="dark"`）
- **THEN** 弹窗面板和按钮样式自动适配暗色主题

#### Scenario: Dialog supports custom button text
- **WHEN** 调用 `AppDialog.confirm(message, { confirmText, cancelText })` 传入自定义按钮文本
- **THEN** 确认按钮和取消按钮显示自定义文本，未传入时使用默认值（确认/取消）

#### Scenario: Dialog blocks interaction with background
- **WHEN** 弹窗显示时
- **THEN** 遮罩层阻止用户与背景内容交互，点击遮罩层不关闭弹窗

#### Scenario: Only one dialog at a time
- **WHEN** 已有一个弹窗显示时再次调用 `AppDialog.confirm()` 或 `AppDialog.alert()`
- **THEN** 新弹窗排队等待，前一个弹窗关闭后再显示下一个

### Requirement: Replace all native dialogs
项目中所有浏览器原生 `confirm()` 和 `alert()` 调用 SHALL 替换为 `AppDialog.confirm()` 和 `AppDialog.alert()`。

#### Scenario: Replace confirm in public/app.js
- **WHEN** `public/app.js` 中存在 `confirm()` 调用（共 13 处：删除分类、删除书签、取消检查任务、删除备份、还原数据库等）
- **THEN** 全部替换为 `await AppDialog.confirm(message)`，调用方函数标记为 `async`

#### Scenario: Replace confirm in views/index.ejs
- **WHEN** `views/index.ejs` 中存在 `confirm()` 调用（删除模板、模板编辑未保存确认）
- **THEN** 全部替换为 `await AppDialog.confirm(message)`

#### Scenario: Replace alert in views/job.ejs
- **WHEN** `views/job.ejs` 中存在 `alert()` 调用（批量应用结果、取消失败提示）
- **THEN** 全部替换为 `await AppDialog.alert(message)`

#### Scenario: Replace confirm and alert in views/jobs.ejs
- **WHEN** `views/jobs.ejs` 中存在 `confirm()` 和 `alert()` 调用（清理任务、清空任务）
- **THEN** 全部替换为对应的 `AppDialog` 方法

#### Scenario: Replace confirm in views/settings.ejs
- **WHEN** `views/settings.ejs` 中存在 `confirm()` 调用（恢复默认设置、删除 Token）
- **THEN** 全部替换为 `await AppDialog.confirm(message)`

#### Scenario: Replace alert in views/snapshots.ejs
- **WHEN** `views/snapshots.ejs` 中存在 `alert()` 调用（删除失败、批量删除失败）
- **THEN** 全部替换为 `await AppDialog.alert(message)`

#### Scenario: AppDialog available on all pages
- **WHEN** 任何页面加载时
- **THEN** `AppDialog` 对象在全局作用域可用，弹窗 DOM 容器已挂载到 `<body>`
