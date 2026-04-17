# bookmarks-manager 现代化 UI/UX 重设计 变更与全量回归测试记录

更新时间：2026-04-17

关联文档：

- [功能上下文与范围](./01-feature-context.md)
- [交付计划](./02-delivery-plan.md)
- [执行任务板](./03-execution-board.md)

## 1. 使用说明

- 本文件是全量变更与全量回归测试项的唯一记录位置。
- 每个 `phase=dev` 任务都必须在本文件中补充新引入的后端 / 前端 / UI 变更。
- 本文件服务于整个需求开发完成后的全量回归测试阶段，不是“一任务一个测试项”的简表。
- 开发阶段可以做快速验证，但最终交付以前，仍需按本文件执行全量回归。
- 任一必跑回归项未通过前，对应交付物不得视为可交付。
- 若测试过程中因修复问题修改代码，必须记录对应 commit / `fix_ref`。
- 每次任务或测试结束后，必须清理工作区，避免残留无关脏变更。
- 本轮所有 `phase=dev` 任务在正式编码前都必须先完成 1 次 Gemini MCP 审阅，并把“采用 / 不采用 / 裁剪原因”回写到对应 issue 条目。

## 2. 真实站点与测试前提

| key | value | status (`todo` / `ready` / `blocked`) | notes |
|---|---|---|---|
| base_url | `https://bookmarks.1018666.xyz` | ready | 真实站点已由用户提供 |
| login_entry | `https://bookmarks.1018666.xyz/login` | ready | 登录入口已明确 |
| test_account | `admin / 密码脱敏` | ready | 管理员账号已由用户提供，密码不入库 |
| api_key / secret | Web UI 走 Session；AI 配置已提供，文档仅保留 `base_url` / `model` 与“key 已提供但不入库” | ready | 真实 key 只在运行时使用 |
| third_party_dependency | `https://grok2api.1018666.xyz/v1` + `grok-4.20-0309-reasoning` | ready | provider 配置已提供，连通性在首轮 live 回归中验证 |
| playwright_allowed | 已获用户许可，可对真实站点执行 Playwright MCP | ready | 允许真实站点回归与抓拍 |
| evidence_path | `docs/planning/modern-ui-ux-redesign/evidence/` + `.playwright-mcp/modern-ui-ux-redesign/` | ready | 索引与截图分离存放 |

## 3. 开发任务变更记录

## UIR-G1-001

- issue_id：`UIR-G1-001`
- title：冻结 UI/UX 基线与执行前提
- wave：`W1`
- issue_ref：[执行任务板 - UIR-G1-001](./03-execution-board.md)
- commit_refs：`N/A (planning gate)`
- commit_message_examples：`[UIR-G1-001][dev] freeze redesign gate and evidence path`
- gemini_review_required：是；已确认 `Gemini session ca2862ca-c89d-46c9-bd3c-888873667194` 为本轮基线
- last_updated_at：2026-04-17
- delivery_gate：`ready`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | planning | redesign gate | establish | `docs/planning/modern-ui-ux-redesign/*` | 不改代码契约 |
| uiux | guideline | Gemini 审阅门禁 | establish | 全量 UI 任务 | 后续每个 `phase=dev` 任务必须先审阅 |
| uiux | scope | Web 管理端 + extension popup 边界 | freeze | `views/*.ejs`、`public/*`、`extension-new/popup.*` | 本轮明确纳入 extension popup |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| frontend | planning | redesign gate | 已根据用户补充信息完成 gate 收口 | 无直接用户可见变化 | 仅为执行门禁 |
| uiux | scope | extension popup in-scope | 本轮 scope 从“排除 popup”更新为“纳入 popup UI/UX” | 后续任务会覆盖扩展 popup | 只做 popup UI，不改底层保存机制 |
| ops | runtime | live site + AI prerequisites | 已记录真实站点、Playwright 许可与 AI 配置（脱敏） | 后续真实站点回归可执行 | secrets 不入库 |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-GLOBAL-001 | 全局壳体 | 设计基线冻结后需验证首页 / 次级页壳体一致性 |
| REG-GLOBAL-003 | 选择器契约 | Gate 明确要求现有 `data-testid` 不可无替代删除 |
| REG-EXT-001 | extension popup shell | scope 已明确包含 popup UI |
| REG-AI-001 | AI organize live | 真实站点与 provider 前置已补齐 |

## UIR-DEV-010

- issue_id：`UIR-DEV-010`
- title：共享设计系统与页面壳体契约
- wave：`W1`
- issue_ref：[执行任务板 - UIR-DEV-010](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-010][dev] establish shared design tokens and shell`
- gemini_review_required：是；聚焦设计 Token、表单 / 按钮 / 卡片 / 空态 / 动效统一方案
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | stylesheet | shared design tokens | refactor | `public/app.css` | 保留深色模式语义与已有类兼容 |
| frontend | component | shared dialog shell | refine | `public/dialog.js` | 不改确认 / 提示业务语义 |
| uiux | page_shell | shared header / container / empty state rules | introduce | `views/*.ejs` | 页面入口与 `data-testid` 保持兼容 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| frontend | stylesheet | shared design tokens | 待执行 | 全站视觉更统一 |  |
| uiux | page_shell | shared shell | 待执行 | 次级页面层级更清晰 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-GLOBAL-001 | 全局壳体 | 共享壳体首要验证项 |
| REG-GLOBAL-003 | 选择器契约 | 共享壳体改造后必须保持选择器稳定 |
| REG-GLOBAL-005 | 主题与持久化 | 深色模式与持久化不能被共享样式破坏 |
| REG-A11Y-001 | 模态焦点 | 共享 dialog 与 shell 的可访问性验证 |

## UIR-DEV-020

- issue_id：`UIR-DEV-020`
- title：登录页现代化改造
- wave：`W1`
- issue_ref：[执行任务板 - UIR-DEV-020](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-020][dev] modernize login page shell`
- gemini_review_required：是；聚焦首屏层级、表单反馈、错误态与暗色兼容
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | template | login page shell | redesign | `views/login.ejs` | 不改 `/login` 提交字段与错误消息合同 |
| uiux | form | login inputs / error state | polish | `views/login.ejs` | `remember` 复选框与按钮语义不变 |
| uiux | visual | login hero / spacing / focus | polish | `views/login.ejs`, `public/app.css` | 保留静态 Tailwind 资源合同 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | login | shell and form feedback | 待执行 | 登录首屏更现代、错误态更清晰 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-LOGIN-001 | 登录首屏 | 基础视觉与静态资源合同 |
| REG-LOGIN-002 | 错误态 | 登录失败提示与表单焦点 |
| REG-LOGIN-003 | 记住我与提交 | 保持输入与提交语义 |

## UIR-DEV-030

- issue_id：`UIR-DEV-030`
- title：设置页布局与表单体验重构
- wave：`W1`
- issue_ref：[执行任务板 - UIR-DEV-030](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-030][dev] redesign settings page layout`
- gemini_review_required：是；聚焦设置分组、响应式表单、AI 诊断区域层级
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | template | settings page sections | redesign | `views/settings.ejs` | 不改 `/settings`、`/api/settings*` 契约 |
| frontend | component | form grid / status / token panel | refactor | `views/settings.ejs`, `public/app.css` | 保留现有 `data-testid` |
| uiux | responsive | settings mobile layout | harden | `views/settings.ejs` | 移动端改单列，不改字段名 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | settings | unified cards and forms | 待执行 | 设置页更清晰、可读、可操作 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-SET-001 | 设置页壳体 | 静态资源与视觉统一 |
| REG-SET-002 | 检查默认参数 | 保存与即时生效 |
| REG-SET-003 | 备份参数 | 分组与表单体验 |
| REG-SET-004 | AI 诊断 | 诊断区壳体与结果展示 |
| REG-SET-005 | Token 管理 | 列表、创建、删除 |
| REG-SET-006 | 移动端布局 | 单列与触控可用性 |

## UIR-DEV-040

- issue_id：`UIR-DEV-040`
- title：任务列表与详情页统一改造
- wave：`W1`
- issue_ref：[执行任务板 - UIR-DEV-040](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-040][dev] redesign jobs center pages`
- gemini_review_required：是；聚焦状态标签、进度区、失败表和详情层级
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | template | jobs list page | redesign | `views/jobs.ejs` | 不改分页与链接入口 |
| frontend | template | job detail page | redesign | `views/job.ejs` | 不改 `/jobs/:id/events`、取消按钮语义 |
| uiux | component | progress / failure / status badges | polish | `views/job.ejs`, `public/app.css` | 失败分页与 organize 详情块需保留 selector |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | jobs | list and detail shell | 待执行 | 任务状态与详情更可读 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-JOBS-001 | 任务列表 | 列表 / 分页 / 状态 |
| REG-JOB-001 | 详情进度 | 进度条和汇总信息 |
| REG-JOB-002 | 取消任务 | 取消按钮与状态变化 |
| REG-JOB-003 | 失败分页 | 页大小 / 翻页合同 |
| REG-JOB-004 | organize 详情块 | AI organize 详情区展示 |

## UIR-DEV-050

- issue_id：`UIR-DEV-050`
- title：快照页统一改造
- wave：`W1`
- issue_ref：[执行任务板 - UIR-DEV-050](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-050][dev] redesign snapshots page`
- gemini_review_required：是；聚焦统计卡、筛选条、列表项与删除确认
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | template | snapshots page shell | redesign | `views/snapshots.ejs` | 不改 `/api/snapshots*` 与静态文件访问合同 |
| uiux | list | grouped snapshot rows | polish | `views/snapshots.ejs` | 保留查看 / 下载 / 删除入口 |
| uiux | dialog | single / batch delete confirm | polish | `views/snapshots.ejs`, `public/app.css` | 不改删除 API 语义 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | snapshots | list and filter shell | 待执行 | 快照筛选与管理更直观 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-SNAP-001 | 壳体与统计 | 首屏布局 |
| REG-SNAP-002 | 搜索过滤 | 关键筛选行为 |
| REG-SNAP-003 | 日期过滤 | 日期与清空 |
| REG-SNAP-004 | 查看链接 | 页面打开 |
| REG-SNAP-005 | 下载链接 | 文件合同 |
| REG-SNAP-006 | 单条删除 | 删除确认 |
| REG-SNAP-007 | 批量删除 | 选择 / 删除收口 |

## UIR-DEV-060

- issue_id：`UIR-DEV-060`
- title：首页信息架构与导航壳体重构
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-060](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-060][dev] redesign home workspace shell`
- gemini_review_required：是；聚焦首页 IA、分类 tabs、侧边工具区和移动端 drawer
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | template | home workspace shell | redesign | `views/index.ejs` | 不改首页数据来源与页面入口 |
| uiux | navigation | category tabs / subcategory panel | refactor | `views/index.ejs`, `public/app.js` | 保留分类 selector 与 loadCategory 行为 |
| uiux | responsive | mobile drawer and header action grouping | harden | `views/index.ejs`, `public/app.css` | 不可遮挡主列表与 modal |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | home | IA shell and navigation | 待执行 | 首页层级更清晰、移动端更稳 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-HOME-001 | 首页桌面壳体 | 主工作区布局 |
| REG-HOME-002 | 首页移动端壳体 | drawer / overlay / header |
| REG-HOME-003 | 分类导航 | all / uncategorized / child |
| REG-HOME-004 | 主题与视图持久化 | header 交互 |

## UIR-DEV-070

- issue_id：`UIR-DEV-070`
- title：首页搜索、工具栏与列表区改造
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-070](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-070][dev] refine home search and list toolbar`
- gemini_review_required：是；聚焦高频搜索、筛选、列表与批量操作区
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | component | search toolbar | redesign | `views/index.ejs`, `public/app.js` | 不改 `/api/bookmarks` 参数语义 |
| frontend | component | advanced filter panel | polish | `views/index.ejs`, `public/app.js` | 保留已有状态 / 排序 / 顺序选择器 |
| uiux | list | batch action bar / empty state | polish | `views/index.ejs`, `public/app.css` | 批量操作逻辑不变 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | home | toolbar and list zone | 待执行 | 搜索与筛选更直观、批量反馈更清晰 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-HOME-010 | 关键字搜索 | 搜索输入与提交 |
| REG-HOME-011 | 高级筛选 | 状态 / 排序 / 顺序 |
| REG-HOME-012 | 表格视图 | 行列表达 |
| REG-HOME-013 | 卡片视图 | 卡片表达 |
| REG-HOME-014 | 批量操作条 | 选中后操作入口 |
| REG-HOME-015 | 空态 | 无结果反馈 |

## UIR-DEV-080

- issue_id：`UIR-DEV-080`
- title：首页书签行、卡片与 CRUD 弹窗改造
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-080](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-080][dev] polish bookmark cards rows and dialogs`
- gemini_review_required：是；聚焦单条动作、表单反馈、键盘和批量选择体验
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | component | bookmark row / card actions | redesign | `views/index.ejs`, `public/app.js` | 保留 edit / move / delete selector |
| frontend | dialog | add / edit / move bookmark modals | polish | `views/index.ejs`, `public/app.js` | 不改书签 CRUD 接口 |
| uiux | interaction | keyboard + focus for CRUD dialogs | harden | `views/index.ejs`, `public/app.css` | `Escape` / `Enter` 继续可用 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | bookmark CRUD | row / card / dialogs | 待执行 | 操作更快、反馈更顺滑 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-HOME-020 | 添加书签 | add modal |
| REG-HOME-021 | 编辑书签 | edit modal keyboard |
| REG-HOME-022 | 移动书签 | move modal |
| REG-HOME-023 | 删除书签 | delete action / confirm |

## UIR-DEV-090

- issue_id：`UIR-DEV-090`
- title：分类管理与分类弹窗族改造
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-090](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-090][dev] redesign category management flows`
- gemini_review_required：是；聚焦分类管理 modal、样式、创建和拖拽反馈
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | dialog | category manager modal | redesign | `views/index.ejs`, `public/app.js` | 不改分类数据结构 |
| frontend | dialog | create / style category dialogs | polish | `views/index.ejs`, `public/app.js` | 保留字段名与现有按钮语义 |
| uiux | interaction | drag / reorder feedback | harden | `views/index.ejs`, `public/app.css` | 不改 `/api/categories/reorder` 语义 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | category | manage and dialogs | 待执行 | 分类维护更直观 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-CAT-001 | 分类管理打开 / 搜索 | manager shell |
| REG-CAT-002 | 添加分类 | root / child |
| REG-CAT-003 | 分类样式 | icon / color |
| REG-CAT-004 | 拖拽排序 | drag / reorder |

## UIR-DEV-100

- issue_id：`UIR-DEV-100`
- title：模板选择与模板编辑体验改造
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-100](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-100][dev] polish template selector and editor`
- gemini_review_required：是；聚焦预设 / 自定义切换、预览与编辑器信息架构
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | dialog | template select modal | redesign | `views/index.ejs`, `public/app.js` | 保留 tabs、preset/custom selector |
| frontend | dialog | template editor | polish | `views/index.ejs`, `public/app.js` | 保留高度边界与保存 / 取消 selector |
| uiux | preview | template preview panel | polish | `views/index.ejs`, `public/app.css` | 不改模板 apply 业务规则 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | template | selector and editor | 待执行 | 模板流更清楚、更易用 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-TPL-001 | 模板选择 tabs | preset / custom |
| REG-TPL-002 | 预设模板预览 / 复制 / 应用 | preview/copy/use |
| REG-TPL-003 | 模板编辑器 | create/save/cancel |

## UIR-DEV-110

- issue_id：`UIR-DEV-110`
- title：导入 / 导出 / 检查 / 备份 / 当前任务面板改造
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-110](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-110][dev] unify ops modals and current job panel`
- gemini_review_required：是；聚焦运维型 modal 统一反馈与互不冲突
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | dialog | import / export / check / backup modals | redesign | `views/index.ejs`, `public/app.js` | 不改各自 API / 表单契约 |
| frontend | component | import/check progress panels | polish | `views/index.ejs`, `public/app.js` | 保留取消与进度 selector |
| uiux | status | current job banner | polish | `views/index.ejs`, `public/app.css` | 不改 `/api/jobs/current` 语义 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | ops tools | modals and banner | 待执行 | 工具型操作更统一、更稳定 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-OPS-001 | 导入 | form + progress |
| REG-OPS-002 | 导出 | modal + download |
| REG-OPS-003 | 检查 | start / progress / finish |
| REG-OPS-004 | 备份 | list / run / upload / restore |
| REG-OPS-005 | 当前任务 | banner / cancel |

## UIR-DEV-120

- issue_id：`UIR-DEV-120`
- title：AI organize 模态与状态机 UI 改造
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-120](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-120][dev] redesign ai organize modal states`
- gemini_review_required：是；聚焦 assigning / preview / failed / applied 的连续性与可理解性
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | dialog | organize modal shell | redesign | `views/index.ejs`, `public/app.js` | 不改 `/api/ai/organize*` 状态机语义 |
| frontend | component | preview table/mobile list/pager | polish | `views/index.ejs`, `public/app.js` | 保留 preview guard、page 按钮 selector |
| uiux | status | failed / retry / applied / open job actions | polish | `views/index.ejs`, `public/app.css` | 与 job detail 联动保持兼容 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | ai organize | modal states | 待执行 | AI organize 更容易理解与审核 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-AI-001 | idle / guard | 起始态 |
| REG-AI-002 | assigning | 进度与取消 |
| REG-AI-003 | preview | mobile/desktop/pager |
| REG-AI-004 | apply/discard | 应用与放弃 |
| REG-AI-005 | failed/error | 重试与异常态 |


## UIR-DEV-125

- issue_id：`UIR-DEV-125`
- title：浏览器扩展 popup UI/UX 与 roundtrip 体验改造
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-125](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-125][dev] redesign extension popup shell and feedback`
- gemini_review_required：是；聚焦 popup 布局、按钮分组、状态反馈与错误态
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | template | extension popup shell | redesign | `extension-new/popup.html` | 不改 popup 功能入口与字段语义 |
| frontend | stylesheet | extension popup visual system | redesign | `extension-new/popup.css` | 与 Web 端设计系统保持统一，但不依赖 Web 资源 |
| frontend | interaction | extension popup action feedback | polish | `extension-new/popup.js` | 保存服务端 / token / 书签 / 快照 / 同时保存逻辑保持兼容 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | extension popup | shell / status / action feedback | 待执行 | popup 更现代、可读、反馈更清晰 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-EXT-001 | popup 壳体与设置 | 服务端 / token 配置 UI |
| REG-EXT-002 | 保存书签 | popup 主动作 |
| REG-EXT-003 | 保存快照 | popup 主动作 |
| REG-EXT-004 | 同时保存 | popup 组合动作 |
| REG-EXT-005 | runtime / error state | 失败提示与反馈收口 |

## UIR-DEV-130

- issue_id：`UIR-DEV-130`
- title：可访问性、动效与响应式硬化
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-130](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-130][dev] harden accessibility motion and responsive details`
- gemini_review_required：是；聚焦焦点管理、键盘、动效节奏、移动端溢出与暗色对比
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | interaction | modal focus / keyboard handling | harden | `views/*.ejs`, `public/app.js`, `public/dialog.js` | 不改原有快捷键语义 |
| uiux | motion | transition and feedback system | harden | `public/app.css`, `views/*.ejs` | 避免引入性能型闪烁 |
| uiux | responsive | overflow / touch target / dark contrast | harden | `views/*.ejs`, `public/app.css` | 不改业务流程 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| uiux | a11y/responsive | global hardening | 待执行 | 更稳、更自然、更可访问 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-A11Y-001 | 模态焦点 trap | focus restore |
| REG-A11Y-002 | 键盘交互 | Esc / Enter / tab order |
| REG-A11Y-003 | 移动端触控 | overflow / touch targets |
| REG-A11Y-004 | 动效节奏 / 对比度 | dark mode / transition |

## UIR-DEV-140

- issue_id：`UIR-DEV-140`
- title：UI 契约测试与浏览器回放刷新
- wave：`W2`
- issue_ref：[执行任务板 - UIR-DEV-140](./03-execution-board.md)
- commit_refs：待执行
- commit_message_examples：`[UIR-DEV-140][dev] refresh selector contracts and browser validations`
- gemini_review_required：否；本任务以测试契约对齐为主，但仍需复核新结构是否偏离既定设计
- last_updated_at：2026-04-17
- delivery_gate：`open`

### 3.1 计划引入内容

| area | object_type | object_name | change_type | impacted_modules | compatibility_notes |
|---|---|---|---|---|---|
| frontend | test | page shell contract tests | update | `tests/integration/page-assets.test.ts` | 旧 selector 必须保留 |
| frontend | test | repo playwright smoke | update | `e2e/*.spec.ts` | 对齐新布局，不改变业务断言 |
| frontend | test | browser validate scripts / MCP smoke checklist | update | `scripts/*browser-validate.ts`, `scripts/playwright-issue-regression-validate.ts` | 作为回归主线资产 |

### 3.2 实际引入内容

| area | object_type | object_name | actual_change | user_visible_impact | notes |
|---|---|---|---|---|---|
| frontend | test | UI contract suite refresh | 待执行 | 降低“UI 改了但回归脚本全坏”风险 |  |

### 3.3 关联回归用例

| case_id | case_scope | notes |
|---|---|---|
| REG-GLOBAL-003 | 选择器契约 | 测试资产的核心回归项 |
| REG-SET-001 | 设置壳体 | page-assets 示例 |
| REG-HOME-001 | 首页壳体 | browser harness / MCP smoke |
| REG-OPS-005 | current-job banner | 现有历史浏览器回放高风险点 |
| REG-EXT-001 | popup 壳体与设置 | extension action popup validate |
| REG-EXT-004 | popup 同时保存 | extension roundtrip validate |
| REG-AI-003 | organize preview | 现有 UI 契约高风险点 |

## 4. 全量回归用例清单

> `object_type` 建议细到：`crud` / `api` / `button` / `dialog` / `drawer` / `form` / `list` / `filter` / `sort` / `pagination` / `component` / `copy` / `visual` / `permission`

| case_id | source_issue_id | area | object_type | object_name | page_or_entry | preconditions | scenario | steps | expected_result | screenshot_ref | status | status_note | last_run_at | failed_reason | fix_ref |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| REG-GLOBAL-001 | UIR-DEV-010 | uiux | visual | 全局页面壳体一致性 | `/`、`/settings`、`/jobs`、`/snapshots` | 已登录 | 打开四个主要页面 | 依次访问页面并观察 header、容器、卡片、页边距 | 视觉层级统一、无旧样式残留、无溢出 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-GLOBAL-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-GLOBAL-002 | UIR-DEV-010 | uiux | component | 按钮 / 表单 / 空态统一性 | 全站 | 已登录 | 验证共享组件风格 | 打开首页、设置、快照页，检查主次按钮、输入框、空态 | 共享组件风格与状态一致 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-GLOBAL-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-GLOBAL-003 | UIR-DEV-140 | frontend | component | `data-testid` 契约稳定性 | 全站模板与测试 | 代码已部署 | 核对关键 selector | 运行 page-assets / repo Playwright / browser validate 套件 | 核心 selector 未被无替代删除 | `docs/planning/modern-ui-ux-redesign/evidence/REG-GLOBAL-003.md` | todo | 待开发阶段与真实站点双重验证 |  |  |  |
| REG-GLOBAL-004 | UIR-DEV-130 | uiux | component | 全局焦点可见与按钮禁用态 | 全站 | 已登录 | 检查 focus / disabled | 用键盘切换多个页面 CTA 与表单输入 | focus ring 清晰；disabled 态可辨识 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-GLOBAL-004.png` | todo | 待真实站点执行 |  |  |  |
| REG-GLOBAL-005 | UIR-DEV-010 | uiux | visual | 主题切换与持久化 | `/`、`/settings`、`/job/:id` | 已登录 | 切换明暗色并刷新 | 分别切换主题、刷新页面、跨页打开 | 主题切换生效、刷新后保留、各页对比度正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-GLOBAL-005.png` | todo | 待真实站点执行 |  |  |  |
| REG-LOGIN-001 | UIR-DEV-020 | frontend | form | 登录页首屏渲染 | `/login` | 未登录 | 访问登录页 | 打开登录页 | 标题、输入框、按钮、静态 Tailwind 资源正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-LOGIN-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-LOGIN-002 | UIR-DEV-020 | frontend | copy | 登录失败错误态 | `/login` | 错误用户名或密码 | 提交错误登录 | 输入错误凭证并提交 | 错误提示清晰、布局不抖动、焦点回到合理位置 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-LOGIN-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-LOGIN-003 | UIR-DEV-020 | frontend | form | 记住我与提交语义 | `/login` | 可用测试账号 | 勾选 remember 并登录 | 勾选“记住我”，输入正确凭证提交 | 登录成功；checkbox 与提交语义未破坏 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-LOGIN-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-SET-001 | UIR-DEV-030 | frontend | visual | 设置页壳体与静态资源 | `/settings` | 已登录 | 打开设置页 | 访问设置页 | 页面引用静态 Tailwind 资源，整体布局统一 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SET-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-SET-002 | UIR-DEV-030 | frontend | form | 检查默认参数保存 | `/settings` | 已登录 | 修改检查参数并保存 | 调整重试次数和重试间隔，提交保存 | 保存成功，输入回填正确，无布局错位 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SET-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-SET-003 | UIR-DEV-030 | frontend | form | 备份参数保存 | `/settings` | 已登录 | 修改备份参数并保存 | 调整启用状态、间隔、保留份数并保存 | 保存反馈清晰；分组卡片与表单可读 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SET-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-SET-004 | UIR-DEV-030 | frontend | component | AI 诊断壳体与结果区 | `/settings` | 已登录，存在 AI 配置 | 打开 AI 设置区并触发诊断 | 点击诊断按钮，观察结果区 | 诊断按钮、结果区、字段选择器仍可用 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SET-004.png` | todo | 待真实站点执行 |  |  |  |
| REG-SET-005 | UIR-DEV-030 | frontend | crud | API Token 管理 | `/settings` | 已登录 | 创建 / 删除 token | 创建一条 token，再删除 | 列表、按钮、提示与表单交互正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SET-005.png` | todo | 待真实站点执行 |  |  |  |
| REG-SET-006 | UIR-DEV-030 | uiux | visual | 设置页移动端单列布局 | `/settings` | 已登录，移动端视口 | 移动端打开设置页 | 在窄屏打开并滚动 | 表单不卡死、不横向溢出、操作可触达 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SET-006.png` | todo | 待真实站点执行 |  |  |  |
| REG-JOBS-001 | UIR-DEV-040 | frontend | list | 任务列表渲染与分页 | `/jobs` | 已登录，存在任务数据 | 打开任务列表并翻页 | 访问任务页并操作分页 | 列表、状态标签、分页器显示正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-JOBS-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-JOB-001 | UIR-DEV-040 | frontend | component | 任务详情进度区 | `/jobs/:id` | 已登录，存在任务详情 | 打开详情页 | 访问任务详情页 | 标题、状态、进度条、统计信息层级清晰 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-JOB-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-JOB-002 | UIR-DEV-040 | frontend | button | 任务取消动作 | `/jobs/:id` | 已登录，存在可取消任务 | 点击取消任务 | 打开运行中任务详情并取消 | 状态刷新为已取消；按钮隐藏或禁用 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-JOB-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-JOB-003 | UIR-DEV-040 | frontend | pagination | 失败明细分页与页大小 | `/jobs/:id` | 已登录，任务含 failure 数据 | 翻页和改 page size | 打开失败表，翻到第二页，再改每页条数 | 表格稳定，分页逻辑正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-JOB-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-JOB-004 | UIR-DEV-040 | frontend | component | AI organize 详情块 | `/jobs/:id` | 已登录，存在 organize 任务 | 打开 organize 任务详情 | 访问 preview/failed/applied 等详情 | 详情块层级清晰，交互按钮仍可用 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-JOB-004.png` | todo | 待真实站点执行 |  |  |  |
| REG-SNAP-001 | UIR-DEV-050 | frontend | visual | 快照页统计卡与筛选条 | `/snapshots` | 已登录，存在快照数据 | 打开快照页 | 访问页面 | 统计卡、搜索条、筛选控件与批量条层级清晰 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SNAP-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-SNAP-002 | UIR-DEV-050 | frontend | filter | 快照关键字搜索 | `/snapshots` | 已登录，存在命中数据 | 输入搜索词 | 输入关键字并等待结果 | 仅展示命中快照，布局不抖动 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SNAP-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-SNAP-003 | UIR-DEV-050 | frontend | filter | 快照日期过滤与清除 | `/snapshots` | 已登录，存在不同日期快照 | 选择日期并清除 | 设置日期过滤，再点击清除 | 过滤结果正确，清除后恢复列表 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SNAP-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-SNAP-004 | UIR-DEV-050 | frontend | button | 快照查看链接 | `/snapshots` | 已登录，存在快照数据 | 查看单条快照 | 点击“查看” | 正确打开快照 HTML，内容完整 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SNAP-004.png` | todo | 待真实站点执行 |  |  |  |
| REG-SNAP-005 | UIR-DEV-050 | frontend | button | 快照下载链接 | `/snapshots` | 已登录，存在快照数据 | 下载单条快照 | 点击“下载” | 下载文件名与内容合同正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SNAP-005.png` | todo | 待真实站点执行 |  |  |  |
| REG-SNAP-006 | UIR-DEV-050 | frontend | dialog | 快照单条删除 | `/snapshots` | 已登录，存在快照数据 | 删除单条快照 | 点击删除并确认 | 列表、数据库、文件资产同步收口 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SNAP-006.png` | todo | 待真实站点执行 |  |  |  |
| REG-SNAP-007 | UIR-DEV-050 | frontend | dialog | 快照批量删除 | `/snapshots` | 已登录，存在多条快照 | 勾选多条并删除 | 全选或多选后执行批删 | 选中计数、确认框、批删结果正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-SNAP-007.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-001 | UIR-DEV-060 | uiux | visual | 首页桌面端工作台壳体 | `/` | 已登录，桌面视口 | 打开首页桌面端 | 访问首页并观察 header、sidebar、tabs、content | 工作台层级清晰，无滚动冲突和遮挡 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-002 | UIR-DEV-060 | uiux | drawer | 首页移动端抽屉与 overlay | `/` | 已登录，移动端视口 | 打开 / 关闭抽屉 | 点击汉堡按钮、打开抽屉、关闭抽屉 | 抽屉过渡自然，不遮挡或卡住主内容 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-003 | UIR-DEV-060 | frontend | component | 分类导航与子分类面板 | `/` | 已登录，存在分类树 | 切换 all/uncategorized/child | 依次点选“全部”“未分类”和子分类 | tabs 与子分类面板行为正确、可滚动可达 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-004 | UIR-DEV-060 | frontend | component | 首页主题切换与视图偏好持久化 | `/` | 已登录 | 切换主题与视图模式并刷新 | 切换主题、切换表格 / 卡片并刷新 | 主题与视图模式均可持久化 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-004.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-010 | UIR-DEV-070 | frontend | filter | 首页关键字搜索 | `/` | 已登录，存在书签数据 | 输入搜索词并搜索 | 输入关键字并提交搜索 | 列表正确过滤，搜索框样式与反馈正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-010.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-011 | UIR-DEV-070 | frontend | filter | 首页高级筛选 apply/reset | `/` | 已登录 | 打开高级筛选并应用 / 重置 | 选择状态、排序、顺序，点击应用，再重置 | 列表、状态和 UI 反馈正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-011.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-012 | UIR-DEV-070 | uiux | list | 首页表格视图 | `/` | 已登录，表格视图 | 浏览表格列表 | 观察行信息、分类、动作区、hover 态 | 信息密度合理，动作按钮可触达 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-012.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-013 | UIR-DEV-070 | uiux | list | 首页卡片视图 | `/` | 已登录，卡片视图 | 切换到卡片模式 | 浏览卡片列表与交互 | 卡片结构清晰、操作入口可见 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-013.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-014 | UIR-DEV-070 | frontend | button | 首页批量操作条 | `/` | 已登录，存在多条书签 | 勾选多条书签 | 勾选多条书签，触发批量条 | 批量条出现、按钮状态正确、无遮挡 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-014.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-015 | UIR-DEV-070 | uiux | visual | 首页空态 / 无结果态 | `/` | 已登录，可构造无结果查询 | 搜索无结果 | 输入不会命中的关键词 | 空态文案清晰、布局完整、返回动作合理 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-015.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-020 | UIR-DEV-080 | frontend | dialog | 添加书签弹窗 | `/` | 已登录 | 打开并提交 add modal | 点击添加书签、填写表单、提交 | 弹窗布局清晰，书签新增成功 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-020.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-021 | UIR-DEV-080 | frontend | dialog | 编辑书签弹窗键盘交互 | `/` | 已登录，存在书签 | 打开 edit modal | 点击编辑，测试 `Escape` 关闭、`Enter` 提交 | 键盘交互仍有效，表单状态正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-021.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-022 | UIR-DEV-080 | frontend | dialog | 单条移动书签弹窗 | `/` | 已登录，存在分类数据 | 打开 move modal 并移动 | 选择目标分类并确认 | 书签移动成功，UI 刷新合理 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-022.png` | todo | 待真实站点执行 |  |  |  |
| REG-HOME-023 | UIR-DEV-080 | frontend | crud | 单条删除书签 | `/` | 已登录，存在书签 | 触发删除 | 点击删除按钮并确认 | 删除成功，列表与计数收口 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-HOME-023.png` | todo | 待真实站点执行 |  |  |  |
| REG-CAT-001 | UIR-DEV-090 | frontend | dialog | 分类管理 modal 打开与搜索 | `/` | 已登录，存在分类树 | 打开分类管理并搜索 | 打开 modal，输入关键词过滤 | modal 结构清晰，搜索结果正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-CAT-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-CAT-002 | UIR-DEV-090 | frontend | crud | 新建一级 / 子分类 | `/` | 已登录 | 打开创建分类弹窗 | 分别创建一级分类和子分类 | 创建流程成功，反馈清晰 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-CAT-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-CAT-003 | UIR-DEV-090 | frontend | dialog | 分类样式编辑 | `/` | 已登录，存在分类 | 打开样式弹窗并保存 | 修改 icon / color 并保存 | 样式更新成功且 UI 同步 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-CAT-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-CAT-004 | UIR-DEV-090 | frontend | component | 分类拖拽排序反馈 | `/` | 已登录，存在多个分类 | 进行拖拽排序 | 在分类管理中拖拽调整顺序 | 拖拽反馈清晰，排序结果稳定 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-CAT-004.png` | todo | 待真实站点执行 |  |  |  |
| REG-TPL-001 | UIR-DEV-100 | frontend | dialog | 模板选择 tabs 与卡片 | `/` | 已登录，存在 preset/custom 模板 | 打开模板选择 | 在自定义 / 预设 tab 间切换 | tabs、卡片、按钮状态正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-TPL-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-TPL-002 | UIR-DEV-100 | frontend | component | 预设模板预览 / 复制 / 应用 | `/` | 已登录，存在预设模板 | 打开预览并执行复制 / 应用 | 点击预览、创建副本、创建并应用 | 各动作文案、状态与确认路径清晰 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-TPL-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-TPL-003 | UIR-DEV-100 | frontend | dialog | 模板编辑器创建 / 保存 / 取消 | `/` | 已登录 | 打开编辑器 | 创建新模板，修改名称和树结构，测试保存 / 取消 | 编辑器结构清晰，高度边界与按钮状态正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-TPL-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-OPS-001 | UIR-DEV-110 | frontend | dialog | 导入表单与进度弹窗 | `/` | 已登录，存在导入样例文件 | 提交导入 | 选择文件、配置选项、提交导入 | 表单区、进度区、取消 / 关闭入口均正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-OPS-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-OPS-002 | UIR-DEV-110 | frontend | dialog | 导出 modal 与下载 | `/` | 已登录，存在书签数据 | 打开导出并下载 | 选择 scope / format，点击下载 | 下载合同正确，modal 交互正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-OPS-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-OPS-003 | UIR-DEV-110 | frontend | dialog | 检查 modal 与进度状态 | `/` | 已登录，存在可检查书签 | 启动检查任务 | 打开检查 modal，启动检查并观察进度 | 状态、进度、完成反馈正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-OPS-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-OPS-004 | UIR-DEV-110 | frontend | dialog | 备份 modal 列表与动作 | `/` | 已登录，存在备份数据 | 打开备份 modal 并执行动作 | 查看列表，运行备份，删除，上传或还原 | 各动作按钮、列表区、状态提示清晰 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-OPS-004.png` | todo | 待真实站点执行 |  |  |  |
| REG-OPS-005 | UIR-DEV-110 | frontend | component | 当前任务 banner 与取消 | `/` | 已登录，存在当前任务 | 观察并取消当前任务 | 在首页看到 banner，点击取消 | banner 状态与取消反馈正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-OPS-005.png` | todo | 待真实站点执行 |  |  |  |
| REG-EXT-001 | UIR-DEV-125 | frontend | visual | extension popup 壳体与设置区 | `extension popup` | 已加载扩展；可访问真实站点 | 打开 popup | 打开 popup，检查服务端地址、token、动作分组与状态文案 | popup 结构清晰，设置区与动作区层级合理 | `docs/planning/modern-ui-ux-redesign/evidence/REG-EXT-001.md` | todo | 待 extension roundtrip 执行 |  |  |  |
| REG-EXT-002 | UIR-DEV-125 | frontend | form | extension popup 保存配置 | `extension popup` | 已加载扩展 | 保存 server url 与 token | 在 popup 输入服务端地址和 token 并保存 | 配置保存成功，反馈清晰，刷新后保留 | `docs/planning/modern-ui-ux-redesign/evidence/REG-EXT-002.md` | todo | 待 extension roundtrip 执行 |  |  |  |
| REG-EXT-003 | UIR-DEV-125 | frontend | button | extension popup 保存书签 | `extension popup` | 已加载扩展；页面可访问 | 执行 save bookmark | 打开任意页面，点击保存书签 | 保存成功，反馈清晰，服务端出现新书签 | `docs/planning/modern-ui-ux-redesign/evidence/REG-EXT-003.md` | todo | 待 extension roundtrip 执行 |  |  |  |
| REG-EXT-004 | UIR-DEV-125 | frontend | button | extension popup 保存快照 / 同时保存 | `extension popup` | 已加载扩展；SingleFile 运行正常 | 执行 save snapshot / save both | 在 popup 依次触发保存快照与同时保存 | 动作完成，状态反馈与服务端结果一致 | `docs/planning/modern-ui-ux-redesign/evidence/REG-EXT-004.md` | todo | 待 extension roundtrip 执行 |  |  |  |
| REG-EXT-005 | UIR-DEV-125 | frontend | component | extension popup runtime / error state | `extension popup` | 已加载扩展 | 构造失败或缺配置状态 | 清空配置或模拟失败，观察 popup 提示 | 错误提示清晰，不出现卡死或无响应 | `docs/planning/modern-ui-ux-redesign/evidence/REG-EXT-005.md` | todo | 待 extension runtime validate 执行 |  |  |  |
| REG-AI-001 | UIR-DEV-120 | frontend | dialog | organize idle / guard 状态 | `/` | 已登录，存在 activeTemplate；必要 AI 配置 | 打开 organize modal | 打开 modal，观察 idle 与 preview guard | 起始态信息清晰，guard 提示不冲突 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-AI-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-AI-002 | UIR-DEV-120 | frontend | component | organize assigning 进度与取消 | `/` | 已登录，AI 配置可用 | 启动 organize | 启动 organize，观察 assigning，点击取消 | 进度与取消反馈正常 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-AI-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-AI-003 | UIR-DEV-120 | frontend | pagination | organize 预览表 / 移动列表 / 翻页 | `/` | 已登录，存在 preview plan | 打开 preview | 观察 desktop table、mobile list，并切页 | 预览结构清晰，分页与列表都可用 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-AI-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-AI-004 | UIR-DEV-120 | frontend | button | organize 应用 / 放弃流程 | `/` | 已登录，存在 preview plan | apply / discard | 依次测试全部应用、应用已选、放弃 | 行为与提示清晰，状态切换正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-AI-004.png` | todo | 待真实站点执行 |  |  |  |
| REG-AI-005 | UIR-DEV-120 | frontend | component | organize failed / error / retry | `/` | 已登录，可构造失败 organize | 打开失败态并重试 | 观察 failed/error 文案、点击重试 / 取消 | 失败态层级清晰，按钮状态正确 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-AI-005.png` | todo | 待真实站点执行 |  |  |  |
| REG-A11Y-001 | UIR-DEV-130 | uiux | dialog | 模态焦点 trap 与关闭后焦点恢复 | 全站 modal | 已登录 | 测试多个 modal 焦点 | 打开 add/edit/template/organize modal，循环 tab，再关闭 | 焦点被正确约束并恢复到触发元素 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-A11Y-001.png` | todo | 待真实站点执行 |  |  |  |
| REG-A11Y-002 | UIR-DEV-130 | uiux | component | 键盘交互一致性 | 全站关键交互 | 已登录 | 测试 Esc / Enter / Tab | 在编辑书签、登录、模板编辑器中测试键盘 | 键盘行为与原合同一致且更稳定 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-A11Y-002.png` | todo | 待真实站点执行 |  |  |  |
| REG-A11Y-003 | UIR-DEV-130 | uiux | visual | 移动端溢出与触控目标 | `/`、`/settings`、`/snapshots` | 已登录，移动端视口 | 检查触控和溢出 | 切换到移动端，检查 drawer、列表、按钮、表单 | 无横向溢出，触控目标足够大 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-A11Y-003.png` | todo | 待真实站点执行 |  |  |  |
| REG-A11Y-004 | UIR-DEV-130 | uiux | visual | 动效节奏、对比度与暗色可读性 | 全站 | 已登录 | 观察过渡与对比 | 在明 / 暗色切换、打开 modal、切换列表时观察 | 动效自然不过度；暗色对比可读 | `.playwright-mcp/modern-ui-ux-redesign/TBD/REG-A11Y-004.png` | todo | 待真实站点执行 |  |  |  |

## 5. 回归批次记录

## UIR-REG-150

- batch_goal：全局壳体与登录 / 设置回归
- covered_cases：`REG-GLOBAL-001`、`REG-GLOBAL-002`、`REG-GLOBAL-003`、`REG-GLOBAL-004`、`REG-GLOBAL-005`、`REG-LOGIN-001`、`REG-LOGIN-002`、`REG-LOGIN-003`、`REG-SET-001`、`REG-SET-002`、`REG-SET-003`、`REG-SET-004`、`REG-SET-005`、`REG-SET-006`
- status：`todo`
- status_note：待真实站点 URL / 账号 / Playwright 许可
- screenshot_index_ref：`docs/planning/modern-ui-ux-redesign/evidence/uir-reg-150.md`

## UIR-REG-160

- batch_goal：首页核心流回归
- covered_cases：`REG-HOME-001`、`REG-HOME-002`、`REG-HOME-003`、`REG-HOME-004`、`REG-HOME-010`、`REG-HOME-011`、`REG-HOME-012`、`REG-HOME-013`、`REG-HOME-014`、`REG-HOME-015`、`REG-HOME-020`、`REG-HOME-021`、`REG-HOME-022`、`REG-HOME-023`、`REG-CAT-001`、`REG-CAT-002`、`REG-CAT-003`、`REG-CAT-004`、`REG-TPL-001`、`REG-TPL-002`、`REG-TPL-003`
- status：`todo`
- status_note：依赖所有首页 dev 任务完成与真实站点前置齐备
- screenshot_index_ref：`docs/planning/modern-ui-ux-redesign/evidence/uir-reg-160.md`

## UIR-REG-170

- batch_goal：运维工具、任务页与快照页回归
- covered_cases：`REG-JOBS-001`、`REG-JOB-001`、`REG-JOB-002`、`REG-JOB-003`、`REG-JOB-004`、`REG-SNAP-001`、`REG-SNAP-002`、`REG-SNAP-003`、`REG-SNAP-004`、`REG-SNAP-005`、`REG-SNAP-006`、`REG-SNAP-007`、`REG-OPS-001`、`REG-OPS-002`、`REG-OPS-003`、`REG-OPS-004`、`REG-OPS-005`
- status：`todo`
- status_note：依赖真实站点数据与部分任务 / 备份 / 快照样例数据
- screenshot_index_ref：`docs/planning/modern-ui-ux-redesign/evidence/uir-reg-170.md`

## UIR-REG-175

- batch_goal：extension popup 与 roundtrip 回归
- covered_cases：`REG-EXT-001`、`REG-EXT-002`、`REG-EXT-003`、`REG-EXT-004`、`REG-EXT-005`
- status：`todo`
- status_note：待 extension popup UI 完成后执行脚本与真实站点 roundtrip
- screenshot_index_ref：`docs/planning/modern-ui-ux-redesign/evidence/uir-reg-175.md`

## UIR-REG-180

- batch_goal：AI organize 真实站点回归
- covered_cases：`REG-AI-001`、`REG-AI-002`、`REG-AI-003`、`REG-AI-004`、`REG-AI-005`、`REG-JOB-004`
- status：`todo`
- status_note：AI provider 配置已齐备，待真实站点执行
- screenshot_index_ref：`docs/planning/modern-ui-ux-redesign/evidence/uir-reg-180.md`

## UIR-REG-190

- batch_goal：跨设备、暗色模式与回滚验证
- covered_cases：`REG-A11Y-001`、`REG-A11Y-002`、`REG-A11Y-003`、`REG-A11Y-004`、`REG-GLOBAL-005`
- status：`todo`
- status_note：作为最终交付前收口批次执行
- screenshot_index_ref：`docs/planning/modern-ui-ux-redesign/evidence/uir-reg-190.md`
