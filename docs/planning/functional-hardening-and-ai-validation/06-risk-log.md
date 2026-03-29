# bookmarks-manager 风险点台账

更新时间：2026-03-29

关联文档：

- [执行路线图](./02-roadmap.md)
- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 执行手册](./04-agent-runbook.md)
- [Agent 进度台账](./05-agent-status.md)

## 1. 说明

- 本文件是风险点的唯一台账，也是“风险排查执行模式”的唯一状态源。
- 风险点不能只停留在一次性汇报里，后续执行必须持续回写本文件。
- 每条风险记录至少应包含：`issue_id`、日期、影响范围、触发条件或现象、当前缓解方式、后续排查建议。
- 除风险本身的生命周期状态外，还应记录修复执行状态、承接 issue 与 Git commit。
- 若风险已消除，应更新 `risk_status`，而不是直接删除历史记录。
- secrets 泄露、端口暴露、误删数据、权限扩大、异常进程和高风险误操作都应进入本台账。

`risk_status` 枚举：

- `open`
- `mitigated`
- `resolved`

`fix_status` 枚举：

- `todo`
- `in_progress`
- `blocked`
- `done`

## 2. 风险排查执行规则

- 优先读取本文件。
- 自动选择第一个 `fix_status = todo` 的风险项。
- 开始前写入 `started_at`，并将 `fix_status` 改为 `in_progress`。
- 完成后写入 `completed_at`，并更新 `risk_status` 与 `fix_status`。
- 若阻塞则写入 `blocked_reason`，并将 `fix_status` 改为 `blocked`。
- 完成提交后回写 `git_commit`。

## 3. 风险列表

| risk_id | date | issue_id | area | risk_status | fix_status | fix_issue_id | git_commit | started_at | completed_at | blocked_reason | risk | current_mitigation | follow_up |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `RISK-001` | 2026-03-28 | `R15-AI-01` | AI provider contract | mitigated | done | `R15-AI-01,R5-AI-01` | `061bb0f,c3ad87c` | 2026-03-28 20:50:01 +0800 | 2026-03-28 21:01:24 +0800 |  | 真实 OpenAI 兼容模型可能不支持“联网浏览”或稳定 JSON 输出，导致 `classify` / `organize` 质量和回归结果不可重复。 | `R15-AI-01` 已引入可注入 AI client factory、队列式 fixture harness；`R15-H1-04` 又用固定 3 条书签样本完成真实 provider 验收，确认 `/api/ai/test`、`classify-batch`、`organize`、`apply/rollback` 均可用。`R5-AI-01` 则把单条 `/api/ai/classify` 的输出强制收口到当前模板 / 分类树内：可映射则归一化，不可映射则拒绝。 | 剩余风险已从“输出合同漂移”收敛为“模型在模板内仍可能选错合法分类”。如果后续要继续提升单条 classify 质量，应另做语义评测样本和人工验收，而不是再放松输出 guardrail。 |
| `RISK-002` | 2026-03-28 | `R1-QA-01` | UI verification drift | resolved | done | `R1-QA-01` | `e719860` | 2026-03-28 15:28:57 +0800 | 2026-03-28 15:37:03 +0800 |  | 仓库内 `e2e/` 仍然存在，但当前执行策略已切换为内置 Playwright MCP；若不明确主次，后续会出现两套 UI 验证标准并行漂移。 | `R1-QA-01` 已完成：最小 smoke checklist 已固化到 `08-playwright-mcp-smoke-baseline.md`，仓库内 Playwright 也已明确为非 release gate 历史资产。 | 后续扩展 UI 验证时，只在内置 Playwright MCP 基线上追加旅程，不再把仓库内 Playwright 恢复为当前主 gate。 |
| `RISK-003` | 2026-03-28 | `R1-BE-03` | Backup / restore contract | resolved | done | `R1-BE-03` | `741d81e` | 2026-03-28 16:21:20 +0800 | 2026-03-28 16:49:56 +0800 |  | 当前备份生成的是整库文件，但还原实现只复制 `categories` 和 `bookmarks`，其余表和资产不在显式恢复范围内。 | `R1-BE-03` 已将 restore 固化为“临时副本校验 + `pre_restore_*.db` 回滚点 + 事务性替换 `categories` / `bookmarks`”的显式部分恢复合同，并用临时目录集成测试覆盖命名备份、restore 与 rollback。 | 若未来要把 restore 扩展到完整恢复或更多业务表，必须另立新 issue，不得在当前 partial-restore 合同内隐式扩大范围。 |
| `RISK-004` | 2026-03-28 | `R1-BE-03` | Snapshot storage | resolved | done | `R1-BE-03` | `741d81e` | 2026-03-28 16:21:20 +0800 | 2026-03-28 16:49:56 +0800 |  | `snapshots` 表在路由层懒初始化，HTML 快照文件在文件系统中，和数据库 schema / 备份逻辑分离。 | `R1-BE-03` 已把 `snapshots` schema 收口到 `src/db.ts`，并在合同文档中明确：快照元数据与 HTML 文件资产当前保留但不纳入 restore 覆盖范围，restore 后原书签绑定也不再被自动保证。 | 若未来需要快照文件随备份一起灾备，或需要 restore 后自动重建快照与书签绑定关系，应另立后续 issue。 |
| `RISK-005` | 2026-03-28 | `R1-DOC-04` | Docs and UI drift | resolved | done | `R1-DOC-04` | `6187281` | 2026-03-28 16:53:17 +0800 | 2026-03-29 16:28:46 +0800 |  | README 曾声明 `ai_simplify`、旧模块文件名和旧扩展目录；任务页也保留过 simplify 遗留变量，容易误导测试与验收。 | `6187281` 已清理 README、旧扩展路径、过时 API 描述和任务页遗留建议面板；2026-03-29 又用本地临时服务 + 内置 Playwright MCP 补跑 `/login` 与 `/jobs`，标题与页面渲染正常，`warning/error` 计数为 `0`。 | 后续若要恢复 simplify 或扩展新的历史任务类型，必须另立 issue，不能重新把 `ai_simplify` 当成当前活跃功能。 |
| `RISK-006` | 2026-03-28 | `R15-AI-03` | AI settings drift | resolved | done | `R15-AI-03` | `a5ff4c9` | 2026-03-29 00:19:38 +0800 | 2026-03-29 00:45:20 +0800 |  | 设置页存有 `ai_batch_size`，但 AI 路由默认使用请求体 `batch_size`，导致配置含义不一致。 | `R15-AI-03` 已将 `ai_batch_size` 标准化为运行时权威默认值，并用 classify-batch、organize、retry、settings reset 的自动化用例证明配置实际生效。 | 在 `R15-H1-04` 只继续验证真实 provider 质量，不再把 batch-size 配置合同视为主要风险。 |
| `RISK-007` | 2026-03-28 | `R1-API-02` | Coverage blind spots | mitigated | done | `R1-API-02` | `8224ae7` | 2026-03-28 15:42:55 +0800 | 2026-03-28 15:55:03 +0800 |  | 模板、快照、备份、设置和 AI 路由仍存在明显自动化盲区，容易在重构中无声回归。 | `R1-API-02` 已补齐设置 / 模板 / 快照 / 备份的独立自动化覆盖；当前剩余盲区主要收敛到 AI 路由合同，由 `R15-AI-02`、`R15-AI-03` 继续处理。 | 后续只保留 AI 相关盲区跟踪，不再把非 AI 运维面视为主要自动化空白。 |
| `RISK-008` | 2026-03-28 | `R2-EXT-02` | Browser extension round-trip | resolved | done | `R2-EXT-02,R5-EXT-02` | `5b70fea,9b4db2d` | 2026-03-29 15:23:49 +0800 | 2026-03-29 22:16:27 +0800 |  | `extension-new/` 负责书签 / 快照保存，但如果只有 popup-harness、没有真实浏览器宿主验证，扩展与服务端仍可能在 `chrome.storage`、tab 查询、content script 注入或新标签打开等链路上出现隐性契约漂移。 | `R2-EXT-02` 已修正扩展把分类名误发为 `category` 的合同错位，改为发送 `category_id` 并以下拉完整路径展示分类；`R5-EXT-02` 又新增 `scripts/extension-runtime-validate.ts` 与 `19-extension-runtime-validation.md`，在 Playwright Chromium 真实 unpacked extension runtime 下覆盖 token 配置、目标页绑定、保存书签、保存快照、收藏+存档、失败提示，以及管理页 / 获取 Token 新标签打开。 | 当前 residual 不再是“有没有真实 runtime 验收”，而是“浏览器工具栏 action popup 点击手势本身未自动化”；现有 harness 已通过最小 target-page hint 保留真实 `chrome.*` 与 content script 链路。若后续要把工具栏 UI 手势也纳入验收，应另立新 issue。 |
| `RISK-009` | 2026-03-28 | `R2-E2E-01` | Frontend asset integrity | mitigated | done | `R2-E2E-01` | `81db8a6` | 2026-03-29 14:33:28 +0800 | 2026-03-29 15:19:40 +0800 |  | 测试环境首页对 `OverlayScrollbars` CSS / JS 配置的 `integrity` 值与实际资源不匹配，浏览器直接阻断加载；同时缺少 `favicon.ico` 且 `tailwind.js` 仍以运行时 CDN 方式使用，控制台持续报错 / 警告。 | `R2-E2E-01` 已移除首页错误的第三方脚本 `integrity`，补上 `/favicon.ico -> /public/favicon.svg`，并在首页 / 登录 / 设置 / 任务 / 快照页收敛 Tailwind 运行时告警；配合 `scripts/playwright-mcp-smoke-env.ts` 与 `11-playwright-mcp-release-journeys.md`，关键旅程页面实测 `warning` / `error` 级控制台消息为 `0`。 | `tailwind.js` 仍是运行时脚本；若后续要彻底迁移到构建产物，应另立 issue 处理，但当前不再作为 `R2` release gate 阻塞项。 |
| `RISK-010` | 2026-03-28 | `R1-QA-05` | Test scaffolding drift | resolved | done | `R1-QA-05` | `50a05d9` | 2026-03-28 16:04:06 +0800 | 2026-03-28 16:17:28 +0800 |  | 当前工作区同时存在已跟踪测试、未纳管测试骨架和重复 helper 入口；如果继续在这些脚手架上叠加用例，后续提交容易出现“本地能跑但 commit 不自洽”的情况。 | `R1-QA-05` 已正式纳管 `tests/helpers/*` 与 `tests/integration/*`，删除重复的 `tests/bookmarks-routes.test.ts`，并把运维面覆盖迁入 `tests/integration/ops-routes.test.ts` 复用统一 `createTestApp()` 主路径。 | 后续新增 app 级测试统一走 `tests/helpers/app.ts`、`tests/helpers/auth.ts`、`tests/helpers/factories.ts`；UI 验证仍维持内置 Playwright MCP 主路径，不再回退到仓库内 Playwright。 |
| `RISK-011` | 2026-03-29 | `R3-UI-01` | Frontend UI stability | resolved | done | `R3-UI-01` | `4abf7ee` | 2026-03-29 17:09:40 +0800 | 2026-03-29 17:22:52 +0800 |  | 首页分类导航曾出现“初始水平、刷新后转为垂直”的布局漂移，且滚动 / 拖拽失效时会导致部分分类不可达。 | `R3-UI-01` 已移除分类导航对 `OverlayScrollbars` 的宿主级包裹，改回原生横向滚动，并补上按钮、滚轮、桌面端拖拽和触屏横滑的等价访问方式；`scripts/category-nav-validate.ts` 与 `14-category-nav-validation.md` 已证明初次加载和刷新后都保持单行横排。 | 后续若再改首页分类导航结构，必须先复跑 `npx tsx scripts/category-nav-validate.ts`，避免重新引入 hydration / layout 漂移。 |
| `RISK-012` | 2026-03-29 | `R3-AI-02` | AI organize data safety | resolved | done | `R3-AI-02` | `550481d` | 2026-03-29 17:35:28 +0800 | 2026-03-29 19:21:29 +0800 |  | AI organize 会改动书签与分类；若在 plan 生成后用户又移动、编辑、删除书签或分类，或多个 organize 任务交错 apply，当前仍可能出现误应用、脏写或数据丢失风险。 | `R3-AI-02` 已为 preview 固化 `source_snapshot`，把书签删除 / 分类漂移 / 模板变更 / 重叠 plan stale 都改为显式 `409` guardrail，并停止在 apply 阶段静默重建缺失分类；`15-ai-organize-safety-validation.md` 与 `tests/integration/ai-organize-routes.test.ts` 已覆盖高风险组合。 | 升级前遗留且没有 `source_snapshot` 的旧 preview plan 现在会被拒绝应用；如现场仍有这类计划，需要重新执行 organize 生成新 preview。 |
| `RISK-013` | 2026-03-29 | `R3-QA-03` | Cross-view interaction consistency | resolved | done | `R3-QA-03` | `aa7a414` | 2026-03-29 19:03:40 +0800 | 2026-03-29 19:21:29 +0800 |  | 分类管理页排序、首页分类导航顺序、分类下拉 / 筛选等跨页面状态可能不一致；拖拽、移动或删除后如果不同步，用户会看到错误导航或产生误操作。 | `R3-QA-03` 已新增 `scripts/category-interaction-validate.ts`，真实驱动分类管理弹窗中的拖拽排序，并验证首页导航与“添加书签”分类下拉同步更新且刷新后保持一致；验收记录已写入 `16-category-interaction-validation.md`。 | 后续若再改分类导航、管理弹窗或依赖 `categories` 顺序的表单，必须先复跑 `scripts/category-interaction-validate.ts`；若要继续扩展 delete / move / template-switch 联动，可另在同一 harness 上追加场景。 |
| `RISK-014` | 2026-03-29 | `R4-CLEAN-01` | Legacy AI runtime drift | resolved | done | `R4-CLEAN-01` | `307f95b` | 2026-03-29 19:40:27 +0800 | 2026-03-29 21:03:07 +0800 |  | `ai_simplify` 已被产品口径下线，但运行时代码仍保留可误导维护者的专属任务类型与任务页分支，后续很容易被误当成当前功能继续串接。 | `R4-CLEAN-01` 已把 `createJob()` 收口成只接受当前活跃类型，并把任务详情页的 `ai_simplify` 专属 UI 分支统一收口为“历史 AI 任务（已下线）”；功能矩阵也同步改成“仅保留历史兼容读取和旧表迁移清理”。 | 若未来真的要恢复 simplify，不得直接复用历史类型残留，必须另立新 issue 明确路由、provider、验收和回滚合同。 |
| `RISK-015` | 2026-03-29 | `R4-QA-02` | Cross-view state invalidation | resolved | done | `R4-QA-02` | `e09a1a0` | 2026-03-29 19:40:27 +0800 | 2026-03-29 21:03:07 +0800 |  | 删除分类、模板切换等会重建分类树的操作，可能让前端仍保留失效的 `currentCategory` / 展开状态 / 已选分类，出现“导航已变、列表仍是旧筛选结果”的误导性 UI。 | `R4-QA-02` 已在 `loadCategories()` 中新增统一的分类 UI 状态标准化，自动收口失效筛选、失效展开父分类和失效已选分类；同时把 `scripts/category-interaction-validate.ts` 扩展到删除分类、子分类移动、单条 / 批量书签移动、模板切换和刷新保持，并新增 `17-cross-view-interaction-validation.md` 留痕。 | 后续若再改分类刷新、模板切换或书签移动链路，必须先复跑 `npx tsx scripts/category-interaction-validate.ts`，避免重新引入 stale state 漂移。 |
| `RISK-016` | 2026-03-29 | `R5-AI-01` | Single classify taxonomy drift | resolved | done | `R5-AI-01` | `c3ad87c` | 2026-03-29 21:32:12 +0800 | 2026-03-29 21:42:02 +0800 |  | 单条 `/api/ai/classify` 原本只做“最多两级”截断，不校验是否落在当前模板 / 分类树内，因此真实 provider 会把 `React 官方文档` 返回成模板外层级 `学习资源/React`。 | `R5-AI-01` 已新增候选分类枚举、路径标准化与 taxonomy guardrail：优先读取活动模板，否则回退 live categories；`学习资源/React` 这类结果会被归一化到 `学习资源/文档`，完全不可映射的结果则直接返回错误，避免透传错误分类。 | 这条风险已经在路由合同层关闭；后续若要继续提升的是“模板内分类是否足够准确”，不再是“会不会输出模板外路径”。 |
