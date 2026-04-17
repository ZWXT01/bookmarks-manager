# bookmarks-manager 现代化 UI/UX 重设计 交付计划

更新时间：2026-04-17

配套文档：

- [功能上下文与范围](./01-feature-context.md)
- [执行任务板](./03-execution-board.md)
- [变更与回归记录](./04-change-regression-log.md)

## 1. 文档目标

- 本文件同时承担功能计划与执行规则。
- 若其他文档与本文件冲突，以本文件为准。
- 已完成的需求消歧不在本文档单独留档；本文档只保留执行前提、门禁与当前阻塞。
- 本轮所有 UI/UX 任务均必须先经过 Gemini MCP 建议审阅，再进入编码与回归。

## 2. 已确认前提

- 当前项目是一个 Fastify + TypeScript + EJS + Alpine.js + SQLite 的单仓自托管应用，Web 管理端页面入口固定为 `/login`、`/`、`/settings`、`/jobs`、`/jobs/:id`、`/snapshots`。
- 用户本轮目标是：
  - 重做一版更现代、更美观、更自然顺滑的 UI/UX；
  - 不破坏原有后端接口调用；
  - 充分测试，覆盖边边角角；
  - 所有 UI/UX 改动先经 Gemini MCP 提建议并确认可行后再执行。
- 本轮 scope 已明确包含：
  - Web 管理端页面；
  - `extension-new/popup.html`、`extension-new/popup.css`、`extension-new/popup.js` 的 extension popup UI/UX。
- 现有前端已经存在大量稳定 `data-testid`；这些选择器构成现有 UI 回归资产的重要契约。
- 当前仓库已经具备以下可复用验证资产：
  - `tests/integration/page-assets.test.ts`
  - `e2e/*.spec.ts`
  - `scripts/*browser-validate.ts`
  - `scripts/playwright-issue-regression-validate.ts`
  - `scripts/playwright-release-journeys-validate.ts`
  - `scripts/extension-roundtrip-validate.ts`
  - `scripts/extension-runtime-validate.ts`
  - `scripts/extension-action-popup-validate.ts`
  - `.playwright-mcp/` 本地 MCP 运行目录
- 默认基础设施约束：
  - `Racknerd` 是业务机 / 部署机。
  - `txcloud` 是编译机，高占用构建、打包、镜像构建等任务默认在其上执行。
  - 任何需要远端高占用执行的步骤都必须基于最新 Git 提交，不允许把脏工作区直接同步上去。
- 真实站点与 AI 配置已由用户提供；文档只允许记录脱敏值，不允许写入真实密码或 key。

## 3. 当前执行前提与阻塞

- 当前无外部 blocker，执行前提已齐备：
  - Gemini 基线已确认可作为本轮规划依据；
  - extension popup UI 已明确纳入 scope；
  - 真实站点 URL、管理员账号、Playwright 许可已提供；
  - AI organize 所需 provider 配置已提供（仅运行时使用，不入库）。
- 当前仍需遵守的执行约束：
  - 任何 commit、文档、脚本或截图不得泄露真实密码或 API key；
  - 若凭证、URL 或 provider 配置后续变更，必须立即回写本规划文档并重新执行前置 smoke。

## 4. 受影响模块与兼容性边界

- 页面模板：
  - `views/index.ejs`
  - `views/login.ejs`
  - `views/settings.ejs`
  - `views/jobs.ejs`
  - `views/job.ejs`
  - `views/snapshots.ejs`
- 扩展 popup：
  - `extension-new/popup.html`
  - `extension-new/popup.css`
  - `extension-new/popup.js`
- 共享样式与交互：
  - `public/app.css`
  - `public/app.js`
  - `public/dialog.js`
- 路由与接口边界：
  - `src/app.ts`
  - `src/routes/*.ts`
- 测试与回归：
  - `tests/integration/page-assets.test.ts`
  - `e2e/*.spec.ts`
  - `scripts/*browser-validate.ts`
  - `scripts/playwright-mcp-smoke-env.ts`
  - `scripts/playwright-issue-regression-validate.ts`
  - `scripts/playwright-release-journeys-validate.ts`
  - `scripts/extension-roundtrip-validate.ts`
  - `scripts/extension-runtime-validate.ts`
  - `scripts/extension-action-popup-validate.ts`

兼容性硬边界：

- 不改现有 `/api/*` 路由路径、HTTP 方法、表单字段名、JSON 返回结构。
- 不改登录 / Session / CSRF 行为。
- 不为纯视觉改造引入 DB schema 变更。
- 不删除既有 `data-testid`；仅允许补充新选择器。
- 不破坏 `theme`、`viewMode` 的本地持久化兼容性。
- 不破坏 extension popup 对既有 API 和本地配置存储逻辑的使用方式。
- 不让 Web UI / popup UI 改造影响 `extension-new/` 的既有保存书签 / 快照契约。

## 5. Wave 计划

### W1 范围确认与共享基础

- 目标：冻结设计方向、确认门禁、先打共享设计系统底座。
- 内容：
  - 基于当前仓库页面结构和 Gemini 报告冻结 IA / 视觉 / 响应式方向。
  - 补齐共享页面壳、按钮、卡片、表单、状态、空态、暗色模式、焦点与动效规则。
  - 优先落低风险页面：登录、设置、任务列表 / 详情、快照页。
- 通过条件：
  - Gemini 设计建议已审阅并可执行。
  - 次级页面统一到同一设计系统。
  - 选择器契约未破坏。

### W2 实现与联调

- 目标：完成首页复杂工作台与 extension popup 的重设计。
- 内容：
  - 首页信息架构重组：顶部分类导航、侧边工具区、工作台布局、搜索筛选、书签列表 / 卡片、批量操作。
  - 分类管理、模板选择 / 编辑、导入 / 导出、批量检查、备份、当前任务 banner、AI organize 等模态与状态流统一。
  - extension popup 的服务端设置、Token 设置、动作按钮、反馈状态与视觉统一。
  - 补齐 a11y、键盘、焦点、深色模式和移动端适配。
  - 更新页面壳体测试、Playwright 补充 smoke、浏览器回放脚本与 extension roundtrip 脚本。
- 通过条件：
  - 首页复杂流转与 popup 保存流在本地与预发环境可快速验证。
  - 变更后脚本 / 测试资产与新 UI 结构对齐。

### W3 全量回归与上线准备

- 目标：以真实站点 / 预发站点完成完整回归、截图留证、回滚预案验证。
- 内容：
  - 通过 Playwright MCP 执行 `04-change-regression-log.md` 的 Web 端全量回归用例。
  - 完成 extension popup roundtrip 回归与关键界面留证。
  - 完成桌面 / 移动端、明 / 暗色、首页 / 次级页 / AI organize / 任务详情等关键证据留档。
  - 完成上线前 smoke、回滚演练、交付结论与问题收口。
- 通过条件：
  - 所有必跑回归项 `passed`。
  - 真实站点证据齐全。
  - 回滚路径可执行且未破坏数据。

## 6. 迁移与回滚策略

- 本轮默认无数据库迁移。
- 本轮默认无 API 迁移；所有 UI 改造必须在现有 API 契约上完成。
- 若引入 EJS partial、共享组件类、额外前端辅助函数，应保证：
  - 模板渲染参数不变；
  - 旧的 `data-testid` 仍然存在；
  - 旧 localStorage 键有兼容 fallback。
- 若 extension popup 引入新视觉结构，应保证：
  - 原有保存服务端地址 / token / 动作按钮流程仍可达；
  - 原有 roundtrip 校验脚本只做必要更新，不改变其业务断言。
- 回滚策略：
  - 代码层回滚：回退本轮前端模板 / 资源 / 扩展 popup / 测试提交并重新部署。
  - 资产层回滚：恢复上一版已构建静态资源、模板文件与扩展 popup 文件；因无 DB 迁移，不需要数据库回滚。
  - 若某个页面或 popup 只在视觉层面失败，优先回滚对应页面 / 共享样式 / popup 任务，而不是动后端。
- 发布顺序：
  - 本地低成本测试 -> `txcloud` 构建 / 打包 -> `Racknerd` 部署到预发 / 真实站点 -> Playwright MCP 回归 -> 扩展 roundtrip 回归 -> 正式切换。

## 7. 两阶段执行策略

### 阶段一：开发阶段（`phase=dev`）

- 按 `03-execution-board.md` 中 `phase=dev` 的顺序执行。
- 每个 `phase=dev` 任务启动前必须先完成 1 次 Gemini MCP 审阅，审阅输入至少包含：
  - 当前页面 / 组件 / popup 问题摘要；
  - 本任务目标与非目标；
  - 不可破坏的 API / selector / localStorage / extension 契约；
  - 目标桌面 / 移动端 / popup 行为；
  - 预期测试影响面。
- Gemini 建议审阅完成后，才允许编码。
- 每个任务完成编码后：
  - 运行与本任务直接相关的低成本验证（页面壳体测试、相关 Playwright / browser harness、extension validate 脚本）。
  - 进入真实站点 / 预发站点快速验证。
- 每次快速验证发现问题时：立即修复 -> 重新提交 -> 重新部署 -> 重新验证。
- 快速验证通过后，任务才允许 `done`。
- 每个开发任务完成后，必须把新增 UI / 前端 / 后端兼容性说明和新增回归用例回写到 `04-change-regression-log.md`。

### 阶段二：回归测试阶段（`phase=regression`）

- 仅当所有 `phase=dev` 任务完成后才可开始。
- 回归测试必须以 `04-change-regression-log.md` 的全量回归用例为唯一依据。
- Web 端回归默认在真实站点 / 预发站点执行。
- 使用 Playwright MCP + 抓拍留档进行验证。
- extension popup 回归使用本地浏览器加载扩展 + 真实站点接口进行 roundtrip 验证，并保留脚本证据。
- 任一失败项都必须立即修复、重新部署，并重跑失败项和受影响关联项。
- 所有必跑回归项通过前，不得视为可交付。

## 8. 真实站点部署与验证前提

- 站点 URL：`https://bookmarks.1018666.xyz`
- 登录入口：`https://bookmarks.1018666.xyz/login`
- 测试账号 / 角色：管理员账号已由用户提供；文档内仅记为 `admin / 密码脱敏`
- API key / secrets：
  - Web UI 普通回归优先走 Session 登录。
  - AI organize 真实站点回归使用用户提供的 provider 配置；仅运行时使用，不入库。
- 第三方依赖访问条件：
  - AI provider：`https://grok2api.1018666.xyz/v1`
  - model：`grok-4.20-0309-reasoning`
  - API key：已提供但不得写入仓库
- 证据留档路径：
  - 索引文档：`docs/planning/modern-ui-ux-redesign/evidence/`
  - MCP 抓拍：`.playwright-mcp/modern-ui-ux-redesign/<date>/`
- 当前阻塞项：无

## 9. Playwright MCP 与抓拍规则

- 测试时优先模拟真实用户操作路径，不使用仅能绕过 UI 的后门方式完成“假验证”。
- 对以下场景至少保留 1 份桌面端抓拍；涉及响应式变化的页面再补 1 份移动端抓拍：
  - 登录页
  - 首页桌面壳体
  - 首页移动端导航 / 抽屉
  - 设置页
  - 任务列表
  - 任务详情
  - 快照页
  - AI organize 关键状态页
- 需要额外保留明 / 暗色对照的场景：
  - 首页
  - 设置页
  - 任务详情
- extension popup 使用浏览器脚本回放和 roundtrip validate 保留证据；必要时再补单独截图。
- 本地 `scripts/*browser-validate.ts`、`scripts/extension-*.ts` 与仓库内 `e2e/*.spec.ts` 只作为开发阶段辅助验证；真实站点 gate 仍以 Playwright MCP + extension roundtrip 为准。
- 若站点信息、登录凭证、AI 配置或第三方访问条件发生变化，必须立即停止并更新文档。
- 本地快速自测可用于辅助排查，但不替代真实站点验证。

## 10. 提交与工作区清理规则

- 若开始第一个任务前工作区已脏，必须先提交 1 次独立 preflight commit 隔离旧变更，再清理工作区。
- preflight 默认 commit message 格式：`[PRE-FLIGHT][workspace-baseline] snapshot before ISSUE-XXX`
- 每次任务或测试若涉及代码修改，必须提交 1 次独立 Git commit。
- 开发任务默认 commit message 格式：`[ISSUE-XXX][dev] <summary>`
- 开发阶段修复默认 commit message 格式：`[ISSUE-XXX][dev-fix] <summary>`
- 回归修复默认 commit message 格式：`[ISSUE-XXX][regression-fix] <summary>`
- commit message 需写清任务编号、修改目的和结果，禁止只写 `fix` / `update` / `test`。
- 若测试过程中为修复失败项修改代码，同样必须补 1 次独立 Git commit。
- 每次任务或测试完成后，必须清理临时文件、临时进程、临时端口和无关产物。
- 若抓拍 / 证据文件需要保留，必须放入约定路径并在文档中记录引用。
- 收尾后应确保工作区 clean，避免留下脏变更。
- 高占用构建 / 打包 / 镜像任务只在 `txcloud` 执行，不在当前机器本地执行。
- 真实密码、cookie、API key、扩展本地配置文件不得入库。

## 11. commit message 规范

- Preflight：`[PRE-FLIGHT][workspace-baseline] snapshot before UIR-DEV-010`
- 开发：`[UIR-DEV-060][dev] redesign home workspace shell`
- 开发修复：`[UIR-DEV-125][dev-fix] restore popup roundtrip button state`
- 回归修复：`[UIR-REG-175][regression-fix] fix extension popup save snapshot feedback`

## 12. 执行级别

- `A0`：仓库内即可实现与验证；不依赖 secrets；示例：共享样式、页面壳体、选择器测试。
- `A1`：仓库内可实现，但需要本地浏览器 / 脚本 / 样例数据验证；示例：Playwright 脚本、浏览器回放、响应式手工检查、extension popup validate。
- `H1`：需要人工提供账号、密钥、真实站点访问；当前已提供，但仍属敏感运行时依赖。
- `H2`：需要设备或外部系统；本轮仅在用户要求纳入真实手机 / 平板实机验证时出现。
- `G1`：必须停下来等结论的 gate；本轮 G1 已关闭。

## 13. 顺序与推进规则

- 优先读取 `03-execution-board.md`。
- 自动选择第一个满足依赖且状态为 `todo` 的任务；不得越过 `G1` 和 `blocked`。
- 所有 `phase=dev` 任务必须先于 `phase=regression` 任务执行。
- 每次只处理 1 个主任务。
- 每个任务开始前必须：
  - 确认前置 Gate 是否完成；
  - 确认是否已完成 Gemini 审阅；
  - 确认工作区 clean；
  - 确认对应 `04` 条目存在。
- 任务标记完成前，必须完成 `04-change-regression-log.md` 中对应条目的回写。

默认任务状态机：

- `todo -> in_progress -> in_testing -> done`
- 开始开发或执行时改为 `in_progress`
- 进入验证时改为 `in_testing`
- 任一验证失败时，任务必须回到 `in_progress`；若无法继续则改为 `blocked`
- 仅当对应验证通过时，任务才可改为 `done`

默认验证状态机：

- `todo -> running -> passed`
- 任一失败改为 `failed`
- 若被外部条件阻塞则改为 `blocked`
- 修复并重新部署后必须重新进入 `running`

## 14. 问题处理规则

- 若在开发阶段快速验证或回归测试阶段发现问题，默认在当前任务内直接修复。
- 修复后必须重新部署真实站点 / 预发站点。
- 修复后必须重跑失败项以及受影响的关联项。
- 若本轮修复涉及代码修改，必须补 1 次独立 Git commit。
- 若 UI 变更导致既有 `data-testid`、browser validate、extension roundtrip 脚本失效，视为高优先级阻塞，不得后移。
- 若无法在当前任务内完成修复，必须保持当前任务 `blocked`。
- 若确需单独拆任务，必须立即在 `03-execution-board.md` 中新增 blocking task，并插入正确位置。
- 下游任务不得越过 blocking task。

## 15. 文档回写规则

- 开始任务前定位 `03-execution-board.md` 中对应任务条目。
- 开始任务前定位 `04-change-regression-log.md` 中对应变更记录或回归批次条目。
- 开始任务时写入 `started_at`。
- 进入验证时将任务状态改为 `in_testing`。
- 完成任务时写入 `completed_at`。
- 遇到外部阻塞时写入 `blocked_reason`。
- 回归失败时写入失败原因、修复引用、复测结果和抓拍证据引用。
- 每个开发任务都要记录“对应 Gemini 审阅结论是否已采用 / 裁剪”。
- 涉及真实账号 / key 的验证结果，只记录脱敏摘要与证据索引，不记录原值。

## 16. 停止规则

- 遇到新的 `G1` 任务时停止自动推进。
- 遇到凭证失效、账号不可用、真实站点入口变化、AI provider 无法访问时停止自动推进。
- 遇到高风险操作条件不明时停止自动推进。
- 若发现共享设计系统改动会连带破坏现有 API / selector / extension 契约，必须先停下并回滚到最近稳定提交，再重新拆任务。

## 17. 可交付判定

只有同时满足以下条件，当前交付物才可视为可交付：

- 所有 `phase=dev` 必做任务状态为 `done`
- 所有 `phase=regression` 必做任务状态为 `done`
- 不存在 `blocked` 的 blocker 任务
- `04-change-regression-log.md` 已完成全量变更与回归结果回写
- 所有关联必跑回归项状态为 `passed`
- 真实站点验证所需前提已齐备并完成取证
- extension popup roundtrip 回归已通过
- 工作区已经清理完成，没有残留脏变更
- 需要的兼容性验证、回滚验证或人工确认已完成

## 18. 上线与回滚策略

- 推荐上线顺序：
  1. 本地完成低成本测试与浏览器脚本验证。
  2. 以 clean commit 同步到 `txcloud` 执行构建 / 打包。
  3. 部署到 `Racknerd` 对应预发或真实站点。
  4. 使用 Playwright MCP 完成最小 smoke。
  5. 执行 extension popup roundtrip validate。
  6. 按 `04` 执行全量回归。
  7. 全量通过后再视为正式交付。
- 推荐回滚顺序：
  1. 回退到最近稳定 UI 提交。
  2. 在 `Racknerd` 恢复上一版模板、静态资源与扩展 popup 文件。
  3. 重新做首页 / 登录 / 设置 / 任务 / 快照 / extension popup 最小 smoke。
  4. 因无 schema 变更，原则上不做 DB 回滚；仅在误触业务逻辑时按独立事故流程处理。
