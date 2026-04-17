# bookmarks-manager 现代化 UI/UX 重设计 执行任务板

更新时间：2026-04-17

关联文档：

- [功能上下文与范围](./01-feature-context.md)
- [交付计划](./02-delivery-plan.md)
- [变更与回归记录](./04-change-regression-log.md)

## 1. 使用说明

- 本文件同时承担任务拆分与当前执行状态。
- 任务必须按 `phase` 分成开发阶段和回归测试阶段。
- 每个任务条目都必须同时包含任务定义字段和状态字段。
- `phase=dev` 的任务必须细到足以明确指向页面 / API / 实体 / 组件 / 弹窗 / 列表 / 表单 / 文案 / 显示效果 / 权限边界之一。
- 任务标记为 `done` 前，必须先完成 `04-change-regression-log.md` 中对应条目的回写。
- `phase` 默认枚举：`dev` / `regression`
- `status` 默认枚举：`todo` / `in_progress` / `in_testing` / `blocked` / `done`
- `verification_status` 默认枚举：`todo` / `running` / `failed` / `passed` / `blocked`
- 任一必跑验证失败时，任务不得保持 `done`。
- 所有 `phase=dev` 任务必须先完成，`phase=regression` 才能开始。

## 2. 任务板

| order | phase | wave | issue_id | title | goal | scope | non_goal | exec_level | depends_on | change_log_ref | acceptance | status | verification_status | started_at | completed_at | blocked_reason |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | dev | W1 | UIR-G1-001 | 冻结 UI/UX 基线与执行前提 | 让 Gemini 审阅结论、真实站点前置、extension scope 与证据路径一次收口 | 确认本轮同时覆盖 Web 管理端与 extension popup；确认 selector 与 extension contract 稳定策略；确认 Playwright MCP 与真实站点前置 | 不开始任何编码 | G1 |  | `04-change-regression-log.md#uir-g1-001` | 用户已确认 Gemini 基线可执行；真实站点 URL/账号/Playwright 许可齐备；extension popup 已明确纳入本轮；AI 配置已由用户提供并脱敏记录 | done | passed | 2026-04-17 | 2026-04-17 |  |
| 10 | dev | W1 | UIR-DEV-010 | 共享设计系统与页面壳体契约 | 建立统一 Token、按钮、卡片、表单、状态、空态、动效与页头 / 容器骨架 | `public/app.css`、`public/dialog.js`、必要的 EJS partial / shared shell；保留深色模式与现有选择器 | 不改业务逻辑与 API | A0 | UIR-G1-001 | `04-change-regression-log.md#uir-dev-010` | 所有页面可复用同一套 shell 与组件样式；深色模式 / focus / disabled / empty state 规则统一；旧 selector 仍可用 | done | passed | 2026-04-17 | 2026-04-17 | Racknerd 真实站点桌面 / 移动端快速验证已通过；证据见 `evidence/2026-04-17-w1-live-quick-verify.md` |
| 20 | dev | W1 | UIR-DEV-020 | 登录页现代化改造 | 在不改登录契约前提下提升首屏视觉层级、输入反馈与错误态 | `views/login.ejs` 结构与样式、登录按钮 / 输入 / 错误提示、移动端与暗色兼容 | 不改 `/login` 请求语义 | A0 | UIR-DEV-010 | `04-change-regression-log.md#uir-dev-020` | `/login` 视觉与全站统一；错误态、记住我、焦点可见；集成测试继续通过 | done | passed | 2026-04-17 | 2026-04-17 | 真实站点 `/login` 新壳体与错误提示已验证；证据见 `evidence/2026-04-17-w1-live-quick-verify.md` |
| 30 | dev | W1 | UIR-DEV-030 | 设置页布局与表单体验重构 | 让设置页从“多块散装表单”升级为统一、清晰、响应式的管理页 | `views/settings.ejs`、相关前端脚本与样式；检查默认参数、备份参数、AI 配置、Token 管理区域 | 不改 `/settings` 与 `/api/settings*` 契约 | A0 | UIR-DEV-010 | `04-change-regression-log.md#uir-dev-030` | 桌面 / 移动端表单布局自然；保存 / 重置 / AI 诊断壳体稳定；`data-testid` 保留 | done | passed | 2026-04-17 | 2026-04-17 | 已同步 `dist/routes/settings.js` 运行时产物并完成设置页桌面 / 移动 / 深色快速验证 |
| 40 | dev | W1 | UIR-DEV-040 | 任务列表与详情页统一改造 | 统一任务中心视觉、状态标签、分页、失败表与详情信息层级 | `views/jobs.ejs`、`views/job.ejs`；列表、详情、进度条、失败分页、取消按钮、AI organize 详情块 | 不改 `/jobs*`、`/api/jobs*`、SSE 语义 | A0 | UIR-DEV-010 | `04-change-regression-log.md#uir-dev-040` | 任务列表 / 详情在桌面和移动端都可读；取消 / 失败分页 / organize 详情块继续稳定 | done | passed | 2026-04-17 | 2026-04-17 | 真实站点任务列表 / 详情快速验证已通过；临时 API token 与 synthetic job 已清理 |
| 50 | dev | W1 | UIR-DEV-050 | 快照页统一改造 | 优化统计卡、筛选条、列表分组、批量删除与空态体验 | `views/snapshots.ejs`；搜索、日期筛选、分组列表、查看 / 下载 / 删除、批量删除 | 不改 `/api/snapshots*` 与文件下载合同 | A0 | UIR-DEV-010 | `04-change-regression-log.md#uir-dev-050` | 搜索 / 日期筛选 / 下载 / 删除流程仍闭环；移动端列表可用；空态更明确 | done | passed | 2026-04-17 | 2026-04-17 | 真实站点快照页桌面 / 移动端快速验证已通过；证据见 `evidence/2026-04-17-w1-live-quick-verify.md` |
| 60 | dev | W2 | UIR-DEV-060 | 首页信息架构与导航壳体重构 | 重组首页主工作区，让分类导航、侧边工具区和内容区层级更清晰 | `views/index.ejs` 主布局；顶部 header、侧边工具区、分类 tabs、子分类面板、移动端 drawer | 不改首页数据来源与分类 API | A0 | UIR-DEV-010,UIR-DEV-050 | `04-change-regression-log.md#uir-dev-060` | 首页桌面 / 移动壳体无遮挡 / 溢出 / 滚动冲突；分类导航更易达；现有 tab selector 保留 | todo | todo |  |  |  |
| 70 | dev | W2 | UIR-DEV-070 | 首页搜索、工具栏与列表区改造 | 让搜索筛选、视图切换、批量条与列表区更丝滑、更符合高频操作习惯 | 搜索框、高级筛选、表格 / 卡片切换、批量操作条、空态、分页与加载反馈 | 不改 `/api/bookmarks` 查询参数语义 | A0 | UIR-DEV-060 | `04-change-regression-log.md#uir-dev-070` | 搜索 / 筛选 / 排序 / 视图切换 / 批量条在新布局下全部可用；无 selector 破坏 | todo | todo |  |  |  |
| 80 | dev | W2 | UIR-DEV-080 | 首页书签行、卡片与 CRUD 弹窗改造 | 优化书签行信息密度、动作菜单、表单反馈与键盘体验 | 书签 table/card、单条编辑 / 移动 / 删除、添加书签弹窗、批量选择反馈 | 不改书签 CRUD 接口、表单字段与删除语义 | A0 | UIR-DEV-070 | `04-change-regression-log.md#uir-dev-080` | 添加 / 编辑 / 删除 / 移动书签流程保持闭环；`Escape` / `Enter` 与焦点反馈清晰 | todo | todo |  |  |  |
| 90 | dev | W2 | UIR-DEV-090 | 分类管理与分类弹窗族改造 | 让分类管理、创建分类、样式编辑、移动与拖拽排序更自然一致 | 分类管理 modal、创建分类 modal、分类样式 modal、拖拽 / 排序反馈、批量删除入口 | 不改 `/api/categories*` 契约与排序语义 | A0 | UIR-DEV-060 | `04-change-regression-log.md#uir-dev-090` | 分类创建 / 搜索 / 样式 / 排序在桌面与移动端保持可操作；选择器稳定 | todo | todo |  |  |  |
| 100 | dev | W2 | UIR-DEV-100 | 模板选择与模板编辑体验改造 | 提升模板预览、应用、复制、编辑器信息层级与可操作性 | 模板选择 modal、预设 / 自定义 tab、预览、复制、创建并应用、模板编辑器 | 不改 `/api/templates*` 契约与模板应用业务规则 | A0 | UIR-DEV-090 | `04-change-regression-log.md#uir-dev-100` | 模板选择 / 预览 / 编辑 / 应用的流程清晰；现有 `data-testid` 与高度边界契约保留 | todo | todo |  |  |  |
| 110 | dev | W2 | UIR-DEV-110 | 导入 / 导出 / 检查 / 备份 / 当前任务面板改造 | 统一运维型 modal 与状态反馈，让高频工具操作更顺滑 | 导入表单、导出 modal、检查 modal、备份 modal、import/check progress、current-job banner | 不改 `/import`、`/export`、`/api/check*`、`/api/backups*`、`/api/jobs/current` 契约 | A0 | UIR-DEV-060,UIR-DEV-070 | `04-change-regression-log.md#uir-dev-110` | 工具型 modal 和进度状态不互相冲突；取消、下载、上传、还原路径仍可执行 | todo | todo |  |  |  |
| 120 | dev | W2 | UIR-DEV-120 | AI organize 模态与状态机 UI 改造 | 在不改组织计划业务语义下提升 assigning / preview / failed / applied 的可理解性 | `views/index.ejs` organize modal、分页预览、mobile/desktop preview、guard、apply/discard/retry/cancel | 不改 `/api/ai/organize*`、plan/apply/rollback 业务行为 | A0 | UIR-DEV-060,UIR-DEV-100 | `04-change-regression-log.md#uir-dev-120` | organize 各阶段 UI 连续、无状态错位；预览分页和 guard 选择器继续有效 | todo | todo |  |  |  |
| 125 | dev | W2 | UIR-DEV-125 | 浏览器扩展 popup UI/UX 与 roundtrip 体验改造 | 让 extension popup 与 Web 管理端保持一致的现代化视觉与反馈，同时不破坏保存动作契约 | `extension-new/popup.html`、`extension-new/popup.css`、`extension-new/popup.js`；服务端设置、Token 配置、保存书签、保存快照、同时保存、错误反馈、加载状态 | 不改 extension manifest 权限模型，不改 content script / SingleFile 底层机制 | A1 | UIR-DEV-010,UIR-DEV-030 | `04-change-regression-log.md#uir-dev-125` | popup 设置、保存书签、保存快照、同时保存与错误态在新 UI 下仍闭环；extension validate 脚本可继续使用 | todo | todo |  |  |  |
| 130 | dev | W2 | UIR-DEV-130 | 可访问性、动效与响应式硬化 | 补齐焦点、键盘、动画、触控、暗色模式和移动端边角一致性 | 全站 modal focus trap、键盘快捷、hover/active/disabled、移动端溢出、暗色视觉对比、popup 焦点与反馈 | 不新增业务能力 | A1 | UIR-DEV-020,UIR-DEV-030,UIR-DEV-040,UIR-DEV-050,UIR-DEV-120,UIR-DEV-125 | `04-change-regression-log.md#uir-dev-130` | 模态焦点、Esc/Enter、按钮状态、暗色与移动端 / popup 边角问题被系统性收口 | todo | todo |  |  |  |
| 140 | dev | W2 | UIR-DEV-140 | UI 契约测试与浏览器回放刷新 | 让现有测试 / 回放脚本与新 UI 同步，避免“视觉更新后验证资产失效” | `tests/integration/page-assets.test.ts`、`e2e/*.spec.ts`、`scripts/*browser-validate.ts`、`scripts/extension-*.ts`、MCP smoke checklist | 不扩大测试范围到新的业务能力 | A1 | UIR-DEV-020,UIR-DEV-030,UIR-DEV-040,UIR-DEV-050,UIR-DEV-120,UIR-DEV-125,UIR-DEV-130 | `04-change-regression-log.md#uir-dev-140` | page-assets、repo Playwright、browser validate、extension validate、MCP smoke 清单全部对齐新 UI 合同 | todo | todo |  |  |  |
| 150 | regression | W3 | UIR-REG-150 | 全局壳体与登录 / 设置回归 | 先验证基础壳体、主题、登录与设置页 | 登录、主题切换、共享壳体、设置各区块、Token 管理、AI 诊断壳体 | 不覆盖首页复杂流 | H1 | UIR-DEV-140 | `04-change-regression-log.md#uir-reg-150` | `REG-GLOBAL-*`、`REG-LOGIN-*`、`REG-SET-*` 全部通过并留证 | todo | todo |  |  |  |
| 160 | regression | W3 | UIR-REG-160 | 首页核心流回归 | 覆盖首页导航、搜索、列表、书签 CRUD、分类管理、模板编辑 | 首页壳体、分类导航、搜索筛选、列表 / 卡片、书签 CRUD、分类、模板 | 不覆盖 AI organize 与运维型 modal | H1 | UIR-REG-150 | `04-change-regression-log.md#uir-reg-160` | `REG-HOME-*`、`REG-CAT-*`、`REG-TPL-*` 全部通过并留证 | todo | todo |  |  |  |
| 170 | regression | W3 | UIR-REG-170 | 运维工具与任务 / 快照回归 | 覆盖导入导出、检查、备份、任务页、快照页与当前任务反馈 | 导入 / 导出 / 检查 / 备份 / current-job banner、任务列表 / 详情、快照页面 | 不覆盖 AI organize 与 extension popup | H1 | UIR-REG-160 | `04-change-regression-log.md#uir-reg-170` | `REG-OPS-*`、`REG-JOBS-*`、`REG-JOB-*`、`REG-SNAP-*` 全部通过并留证 | todo | todo |  |  |  |
| 175 | regression | W3 | UIR-REG-175 | extension popup 与 roundtrip 回归 | 覆盖 popup 设置、动作入口与真实站点 roundtrip | extension popup 设置、保存书签、保存快照、同时保存、错误反馈、runtime 行为 | 不覆盖 AI organize | H1 | UIR-REG-170 | `04-change-regression-log.md#uir-reg-175` | `REG-EXT-*` 全部通过并留证；extension validate 脚本 clean rerun 通过 | todo | todo |  |  |  |
| 180 | regression | W3 | UIR-REG-180 | AI organize 真实站点回归 | 覆盖 organize idle / assigning / preview / apply / failed 的真实站点 UI | AI organize modal 全流程、与任务详情联动、分页预览、guard、取消 / 重试 / 应用 | 不评估模型语义质量本身 | H1 | UIR-REG-175 | `04-change-regression-log.md#uir-reg-180` | `REG-AI-*` 全部通过；AI provider 有效；关键状态抓拍齐全 | todo | todo |  |  |  |
| 190 | regression | W3 | UIR-REG-190 | 跨设备 / 暗色 / 回滚验证 | 覆盖移动端、暗色模式、回滚 smoke 与最终交付结论 | 移动端导航、暗色首页 / 设置 / 任务详情、回滚后 smoke、证据索引整理 | 不新增代码功能 | H1 | UIR-REG-180 | `04-change-regression-log.md#uir-reg-190` | `REG-A11Y-*`、`REG-GLOBAL-005` 与回滚 smoke 全部通过；交付结论可出具 | todo | todo |  |  |  |

## 3. 任务维护规则

- `phase=dev` 任务开发完成后，必须先部署真实站点 / 预发站点，再做快速验证。
- `phase=regression` 任务必须引用 `04-change-regression-log.md` 中的回归用例范围。
- 开始开发或执行时将任务状态改为 `in_progress`。
- 进入验证时将任务状态改为 `in_testing`，并将 `verification_status` 改为 `running`。
- 任一必跑验证失败时，将 `verification_status` 改为 `failed`，并将任务状态退回 `in_progress` 或 `blocked`。
- 修复问题后必须重新部署并重新验证。
- 仅当 `verification_status=passed` 时，任务才可改为 `done`。
- 若开始第一个任务前工作区已脏，必须先提交 1 次独立 preflight commit 隔离旧变更，再清理工作区。
- preflight commit 不得与第一个任务 commit 混在一起。
- 每次任务或测试若涉及代码修改，必须在该轮完成后提交 1 次独立 Git commit，提交说明写清任务编号、目的和结果。
- 每次任务启动前必须先完成对应 Gemini MCP 审阅，并把审阅结论同步到 `04-change-regression-log.md` 对应 issue 条目。
- 若测试过程中为修复失败项修改代码，同样必须补 1 次独立 Git commit。
- 每次任务或测试完成后，必须清理临时文件、临时进程、临时端口和无关产物。
- 若证据文件需要保留，必须放入约定路径并记录引用；收尾后确保工作区 clean。
- 涉及迁移、权限变化、接口契约变化的任务，必须写清影响面、确认点、回滚方式和验收标准。
- 若任务包含测试、排查或临时验证，必须写清临时进程、端口、二进制和测试数据的清理要求。

补充顺序说明：

- `UIR-G1-001` 已完成。
- 当前第一个可执行 `phase=dev` 任务是 `UIR-DEV-010`。
- 一旦所有 `phase=dev` 任务完成且真实站点可访问，第一个可执行 `phase=regression` 任务是 `UIR-REG-150`。

## 4. 任务 / 测试完成前检查清单模板

> 每次任务关闭或每轮测试收尾前，至少核对一次；不适用项应显式标记 `N/A`。

- [ ] 若开始首个任务前工作区已脏，已先完成独立 preflight commit，并与首个任务 commit 隔离
- [ ] 若本轮涉及代码修改，已提交 1 次独立 Git commit
- [ ] commit message 符合规范：`[PRE-FLIGHT][workspace-baseline] snapshot before ISSUE-XXX` / `[ISSUE-XXX][dev] <summary>` / `[ISSUE-XXX][dev-fix] <summary>` / `[ISSUE-XXX][regression-fix] <summary>`
- [ ] 对应 Gemini MCP 审阅已完成，结论已确认可执行，且未引入后端 / extension 契约破坏
- [ ] `03-execution-board.md` 当前任务状态、时间、阻塞信息已更新
- [ ] `04-change-regression-log.md` 的变更条目 / 回归条目已更新
- [ ] 已完成真实站点部署或明确记录 `N/A`
- [ ] 已完成本轮快速验证 / 回归验证并记录结果
- [ ] 抓拍 / 截图证据已放入约定路径并写入引用
- [ ] 临时文件、临时进程、临时端口、无关截图、测试数据已清理
- [ ] `git status` 已确认为 clean
