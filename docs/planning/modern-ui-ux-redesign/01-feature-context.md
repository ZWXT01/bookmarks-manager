# bookmarks-manager 现代化 UI/UX 重设计 功能上下文与范围

更新时间：2026-04-17

配套文档：

- [交付计划](./02-delivery-plan.md)
- [执行任务板](./03-execution-board.md)
- [变更与回归记录](./04-change-regression-log.md)

## 1. 当前系统摘要

- 当前产品 / 系统：
  - 一个单管理员 / 轻协作自托管书签管理器，技术栈为 `Fastify + TypeScript + EJS + Alpine.js + SQLite`。
  - Web 管理端覆盖首页书签管理、设置、任务列表 / 详情、快照管理、登录；扩展端本轮明确纳入 `extension-new/popup.html`、`extension-new/popup.css`、`extension-new/popup.js` 的 popup UI/UX 改造与 roundtrip 验证。
- 当前用户流：
  - 用户通过 `/login` 登录 Web 管理端。
  - 登录后进入 `/` 首页，完成分类导航、搜索筛选、表格 / 卡片浏览、书签 CRUD、批量移动、导入导出、批量检查、备份、模板管理、AI organize 等主要操作。
  - 次级页面为 `/settings`、`/jobs`、`/jobs/:id`、`/snapshots`。
  - 扩展用户通过 popup 保存服务端地址 / API Token，并执行保存当前页书签、保存快照、同时保存书签+快照。
- 当前关键模块：
  - 页面模板：`views/index.ejs`、`views/settings.ejs`、`views/jobs.ejs`、`views/job.ejs`、`views/login.ejs`、`views/snapshots.ejs`
  - 前端交互与样式：`public/app.css`、`public/app.js`、`public/dialog.js`
  - 页面与 API 契约：`src/app.ts`、`src/routes/*.ts`
  - 扩展 popup：`extension-new/popup.html`、`extension-new/popup.css`、`extension-new/popup.js`
  - 验证资产：`tests/integration/page-assets.test.ts`、`e2e/*.spec.ts`、`scripts/*browser-validate.ts`、`scripts/playwright-mcp-smoke-env.ts`、`scripts/extension-roundtrip-validate.ts`、`scripts/extension-runtime-validate.ts`、`scripts/extension-action-popup-validate.ts`
- 当前接口或数据契约：
  - `/api/bookmarks*`、`/api/categories*`、`/api/check*`、`/api/jobs*`、`/api/templates*`、`/api/backups*`、`/api/snapshots*`、`/api/ai*` 以及登录 / 会话相关路由已经稳定存在。
  - 首页与次级页面模板已暴露大量稳定 `data-testid`，现有集成测试、仓库内 Playwright 和浏览器回放脚本都依赖这些选择器。
  - 当前 UI 状态依赖 `localStorage.theme` 与 `localStorage.viewMode`；扩展 popup 依赖其既有本地设置存储逻辑；本轮不能破坏这些兼容性。

## 2. 本次功能目标

- 目标：
  - 为当前 Web 管理端与 extension popup UI 重做一版更现代、更美观、更丝滑的 UI/UX，同时不改变后端 API 与页面路由语义。
  - 将首页、设置页、任务页、快照页、登录页与扩展 popup 统一到一套更一致的设计系统和交互语言中。
  - 在执行每一类 UI/UX 改动前，先通过 Gemini MCP 输出建议并做可行性审阅，再进入编码。
- 预期效果：
  - 组件布局更合理、信息层级更清晰、桌面端和移动端更协调。
  - 操作反馈更自然，弹窗、列表、筛选、状态切换、任务进度、暗色模式、键盘交互、popup 保存反馈都更顺滑。
  - 现有 API、任务队列、权限 / 会话、SQLite 数据模型、扩展调用路径不受破坏。
  - 自动化测试、浏览器回放、Playwright MCP 真实站点回归都能覆盖到 UI 变更面与边角流程。
- 目标用户 / 角色：
  - 单管理员、自托管部署维护者、日常频繁整理书签的重度用户。
  - 主要桌面端使用，同时要保证移动端查看、搜索、快捷操作与任务状态查看体验。
  - 使用浏览器扩展快速收藏网页和快照的高频用户。

## 3. 受影响模块

- 首页复杂工作台：`views/index.ejs` + `public/app.js`
  - 分类导航、侧边工具区、书签列表 / 卡片、搜索筛选、批量操作、导入 / 导出 / 检查 / 备份 / 模板 / AI organize 等全部在此页汇聚，是本轮影响面最大区域。
- 次级页面：
  - `views/login.ejs`
  - `views/settings.ejs`
  - `views/jobs.ejs`
  - `views/job.ejs`
  - `views/snapshots.ejs`
- 扩展 popup：
  - `extension-new/popup.html`
  - `extension-new/popup.css`
  - `extension-new/popup.js`
- 共享前端层：
  - `public/app.css`：设计 Token、按钮、卡片、表单、主题、动画与全局覆盖。
  - `public/dialog.js`：对话框样式、焦点与可访问性。
  - `public/app.js`：首页状态机、模态框、筛选、视图切换、任务轮询、模板和 AI organize 流程。
- 测试与回归资产：
  - `tests/integration/page-assets.test.ts`
  - `e2e/*.spec.ts`
  - `scripts/settings-ai-diagnostic-validate.ts`
  - `scripts/jobs-snapshots-browser-validate.ts`
  - `scripts/snapshot-browse-download-browser-validate.ts`
  - `scripts/import-export-browser-validate.ts`
  - `scripts/category-nav-validate.ts`
  - `scripts/category-interaction-validate.ts`
  - `scripts/template-editor-validate.ts`
  - `scripts/preset-template-validate.ts`
  - `scripts/ai-organize-ui-validate.ts`
  - `scripts/playwright-issue-regression-validate.ts`
  - `scripts/playwright-release-journeys-validate.ts`
  - `scripts/extension-roundtrip-validate.ts`
  - `scripts/extension-runtime-validate.ts`
  - `scripts/extension-action-popup-validate.ts`

## 4. 兼容性与迁移约束

- 不允许因纯 UI/UX 改造变更现有后端 API URL、HTTP 方法、表单字段名、返回 JSON 结构或登录 / 会话 / CSRF 流程。
- 不允许因为纯视觉改造引入 SQLite schema 迁移。
- 页面入口路由保持不变：`/`、`/login`、`/settings`、`/jobs`、`/jobs/:id`、`/snapshots`。
- 扩展 popup 保存书签 / 快照的 API 使用方式保持不变。
- 现有 `data-testid` 作为稳定契约保留；若确需新增选择器，只允许“增补”，不允许无替代地删除或改名。
- `localStorage.theme` 与 `localStorage.viewMode` 继续兼容；若新增 UI 偏好键，必须提供旧值回退逻辑。
- 若引入 EJS partial / 更细的前端模块拆分，只能重构模板组织方式，不能改变页面对后端传参的需求。
- 深色模式、移动端侧栏、任务轮询、AI organize 预览 / 应用 / 取消等现有行为语义必须保留。
- 编译、构建、打包、镜像构建等高占用任务默认在 `txcloud` 执行；部署与真实站点验证默认以 `Racknerd` 为业务机 / 部署机。
- 任何进入 `txcloud` 的高占用任务都必须基于最新 Git 提交，不能直接同步脏工作区。
- 用户已提供真实站点账号与 AI key，但这些 secrets 只允许在运行时使用，不允许写入仓库文档或 Git 记录；文档中只能保存脱敏信息。

## 5. 可选参考资料（可空）

| 名称 | 类型 | 链接/路径 | 可借鉴内容 | 是否采用 |
|---|---|---|---|---|
| 当前仓库页面与前端代码 | 本地代码 | `views/*.ejs`、`public/app.css`、`public/app.js` | 借现有 Alpine 状态机、深色模式、任务反馈、`data-testid` 契约；识别首页信息过载与次级页面风格不统一问题 | 采用 |
| 当前产品说明 | 本地文档 | `README.zh-CN.md` | 借产品边界与页面 / API 清单，避免 UI 改造时误扩展到非目标功能 | 采用 |
| Gemini MCP 仓库审阅报告 | 本地 MCP 会话 | `Gemini session ca2862ca-c89d-46c9-bd3c-888873667194` | 借首页 IA 重组、设计系统统一、次级页面 Alpine 化、W1/W2/W3 实施顺序、风险清单 | 采用 |
| 现有浏览器验证脚本矩阵 | 本地脚本 | `scripts/*browser-validate.ts`、`scripts/playwright-issue-regression-validate.ts`、`scripts/extension-*.ts` | 借已存在的高风险页面与扩展回放覆盖面，扩展成 UI 重设计后的回归主线 | 采用 |
| 根目录未跟踪 PNG 预览图 | 本地临时资产 | `real-organize-*.png` | 可作为历史草稿参考，但当前未纳入 Git、来源和权威性未确认，不能直接作为设计真相源 | 不直接采用 |

## 6. 范围结论

- 当前必须做：
  - 统一 Web 管理端与 extension popup 的设计系统：卡片、按钮、输入、状态、空态、弹窗、动效、深色模式、响应式规则。
  - 重设计首页信息架构与高频交互：分类导航、工具区、搜索筛选、列表 / 卡片、批量操作、弹窗群、任务反馈。
  - 重设计次级页面：登录、设置、任务列表、任务详情、快照管理。
  - 重设计 extension popup：服务端配置、Token 配置、保存动作、反馈状态、错误提示、动作分组与视觉一致性。
  - 补齐 UI 契约测试、浏览器脚本回放、扩展 roundtrip、Playwright MCP 真实站点全量回归与留证路径。
  - 在每个 UI/UX 任务执行前先走 Gemini MCP 建议审阅。
- 可以延后：
  - 品牌插画、营销落地页、PWA 化、多语言、多用户视觉分层。
  - 更激进的前端框架替换（如 SPA 重写）。
  - extension content script / SingleFile 保存链路的底层架构重写。
- 明确不做：
  - 后端 API 重构或业务语义改写。
  - 因视觉改造新增数据库 schema。
  - AI provider 行为、模板业务规则、任务队列模型的功能性扩展。
  - 浏览器扩展 content script、manifest 权限模型、SingleFile 运行机制的产品性扩容。

## 7. Rollout / Wave 方案

- `W1`：冻结设计方向与执行门禁
  - 形成 Gemini 审阅基线。
  - 确认本轮同时覆盖 Web 管理端与 extension popup。
  - 定义共享设计系统和次级页面统一框架。
- `W2`：实施核心页面与扩展 popup 改造
  - 优先低风险页面：登录、设置、任务、快照页。
  - 再进入首页复杂工作台：导航、列表、分类管理、模板、导入 / 导出 / 检查 / 备份、AI organize。
  - 同步实施 extension popup UI/UX 与 roundtrip 体验改造。
- `W3`：真实站点回归与发布准备
  - 在 `Racknerd` 对应站点完成 Playwright MCP 全量回归。
  - 完成 extension popup roundtrip 回归与桌面 / 移动端、明 / 暗色、关键交互抓拍证据。
  - 执行回滚预案验证并出具交付结论。

## 8. 真实站点验证前置条件

- 真实站点 / 预发站点 URL：
  - `https://bookmarks.1018666.xyz`
- 登录入口：
  - `https://bookmarks.1018666.xyz/login`
- 测试账号与角色：
  - 已提供管理员账号；文档仅记录为 `admin / 密码脱敏`。
- API key / secrets 获取情况：
  - Web UI 回归可通过 Session 登录执行。
  - AI organize 真实站点回归所需 AI 配置已提供，文档仅保留脱敏信息：`base_url=https://grok2api.1018666.xyz/v1`、`model=grok-4.20-0309-reasoning`、`api_key=已提供但不入库`。
- 是否允许使用 Playwright MCP：
  - 是，已获用户许可。
- 证据留档路径：
  - 计划采用 `docs/planning/modern-ui-ux-redesign/evidence/` 记录索引，截图 / 抓拍文件建议落在 `.playwright-mcp/modern-ui-ux-redesign/` 并在索引中引用。

## 9. 回归关注点

- 首页桌面 / 移动端信息架构是否更清晰，且无覆盖、错位、滚动冲突、溢出或高度塌陷。
- 分类导航、子分类、搜索、高级筛选、表格 / 卡片切换、批量选择与批量移动是否仍保持当前行为。
- 添加 / 编辑 / 移动 / 删除书签与分类的弹窗焦点、键盘、确认 / 取消路径是否自然。
- 模板选择 / 编辑、导入 / 导出、批量检查、备份、当前任务 banner、AI organize 的状态机是否仍闭环。
- 设置页、任务列表 / 详情、快照页与登录页是否统一到同一设计语言，且移动端布局仍可用。
- extension popup 的服务端配置、Token 输入、保存书签、保存快照、同时保存、错误态与成功反馈是否仍闭环。
- 明色 / 暗色主题切换、持久化、系统回退是否正常。
- `data-testid`、已有集成测试、仓库内 Playwright 补充 smoke、浏览器回放脚本与 extension validate 脚本是否继续可用。
- 真实站点下的 AI organize / 任务轮询 / SSE 相关 UI 是否未因样式重构引入假死、闪烁或按钮状态异常。

## 10. 执行阻塞项 / 待提供信息

> 仅记录仍影响执行的 blocker / 待提供信息；不回写已完成的消歧对话过程。

- 当前无外部 blocker；真实站点 URL、账号、Playwright 许可、extension popup scope 与 AI 配置均已由用户提供。
- 执行期仍需遵守：真实密码 / API key 只在运行时使用，不写入仓库、不写入文档、不写入 Git commit。
