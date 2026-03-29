# bookmarks-manager 功能覆盖矩阵

更新时间：2026-03-29

关联文档：

- [执行路线图](./02-roadmap.md)
- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 基线验证结论

| 项目 | 当前结论 | 证据 |
|---|---|---|
| 构建基线 | `npm run build` 于 2026-03-29 通过。 | 当前工作区在 `R2-REL-03` 收口回归中执行通过。 |
| 自动化测试基线 | `npm test` 于 2026-03-29 通过，`16` 个测试文件、`136` 条测试全部通过。 | 当前工作区在 `R2-REL-03` 收口回归中执行通过。 |
| 仓库内 Playwright 资产 | `e2e/` 与 `playwright.config.ts` 仍在仓库中，但已经明确是历史资产，不作为 release gate。 | [Playwright MCP Smoke 基线](./08-playwright-mcp-smoke-baseline.md)、[Playwright MCP 关键业务旅程验收](./11-playwright-mcp-release-journeys.md)。 |
| UI 验证主路径 | 当前主路径是内置 Playwright MCP，已覆盖最小 smoke、关键业务旅程，以及 `R1-DOC-04` 的本地 `/login + /jobs` 补验收。 | [Playwright MCP Smoke 基线](./08-playwright-mcp-smoke-baseline.md)、[Playwright MCP 关键业务旅程验收](./11-playwright-mcp-release-journeys.md)、[最终回归与交接说明](./13-release-handoff.md)。 |
| 扩展 round-trip gate | `npx tsx scripts/extension-roundtrip-validate.ts` 于 2026-03-29 clean run 通过。 | [浏览器扩展 round-trip 验收](./12-extension-roundtrip-validation.md)。 |
| 真实 AI gate | `R15-H1-04` 已完成真实 provider 验收，并完成 organize apply / rollback 演练。 | [真实 AI 提供方联调与人工验收](./10-ai-provider-h1-validation.md)。 |

## 2. Gate 冻结结论

| 主题 | 冻结结论 | 依据 | 后续 issue |
|---|---|---|---|
| `ai_simplify` | 视为历史遗留 / backlog，不纳入本轮 release gate。 | 当前活跃路由面没有 `/api/ai/simplify` 或 `/api/ai/apply-simplify`；`R4-CLEAN-01` 后仅保留历史任务兼容类型和旧表迁移清理。 | `R1-DOC-04`、`R4-CLEAN-01` |
| 备份 / 还原合同 | 本轮冻结为“显式部分恢复”路线。 | 当前恢复实现只处理 `categories` 与 `bookmarks`，不恢复其他表和文件资产。 | `R1-BE-03` |
| 浏览器扩展 | `extension-new/` 纳入最终 `R2` release gate。 | 扩展仍承担 token 配置、保存书签、保存快照和同时保存功能。 | `R2-EXT-02`、`R2-REL-03` |
| UI 验证主路径 | 内置 Playwright MCP 为主；仓库内 Playwright 为历史资产。 | 规划包和执行手册已明确切换。 | `R1-QA-01` |

## 3. 功能覆盖矩阵

| 功能域 | 当前实现面 | 当前自动化覆盖 | 当前人工 / UI 覆盖 | 主要缺口 | 承接 issue |
|---|---|---|---|---|---|
| 认证 / 会话 / API Token | `src/routes/auth.ts`、`views/login.ejs`、`src/auth.ts` | `tests/integration/app-auth.test.ts` | 登录页存在；UI smoke 尚未转入 MCP | Token CRUD、设置页联动未形成完整回归 | `R1-API-02`、`R1-QA-01` |
| 首页书签列表 / 搜索 / 表单 | `src/app.ts`、`src/routes/bookmarks.ts`、`src/routes/forms.ts`、`views/index.ejs`、`public/app.js` | `tests/bookmarks-routes.test.ts`、`tests/integration/bookmarks-api.test.ts` | 仓库内 Playwright 已覆盖登录、CRUD、分页、搜索等历史路径 | 需要把 UI gate 切到内置 Playwright MCP | `R1-QA-01` |
| 分类树 / 批量删除 / 排序 | `src/routes/categories.ts`、`src/category-service.ts` | `tests/category-service.test.ts`、`tests/integration/categories-api.test.ts` | 仓库内 Playwright 已覆盖分类切换、子分类和基础拖拽 | 需要 MCP 版 smoke，且维持两级分类合同 | `R1-QA-01` |
| 导入 / 导出 | `src/routes/import.ts`、`src/importer.ts`、`src/exporter.ts` | `tests/importer.test.ts`、`tests/exporter.test.ts`、`tests/integration/import-routes.test.ts` | 无正式 UI smoke | 缺导出端到端和页面级回归 | 后续纳入 `R2-E2E-01` |
| 链接检查 / 任务队列 / SSE | `src/routes/check.ts`、`src/routes/jobs.ts`、`src/jobs.ts`、`views/jobs.ejs`、`views/job.ejs` | `tests/jobs.test.ts`、`tests/integration/check-routes.test.ts`、`tests/integration/jobs-routes.test.ts` | 有页面和 SSE 入口，但无 MCP smoke | 任务页、详情页、SSE 仍缺正式 UI 验证 | `R1-QA-01`、`R2-E2E-01` |
| 设置页 | `src/routes/settings.ts`、`views/settings.ejs` | 无专门测试 | 页面存在 | 保存 / 重置 / 读取合同缺自动化 | `R1-API-02`、`R1-QA-01` |
| 模板 | `src/routes/templates.ts`、`src/template-service.ts` | 无专门测试 | 主要经 API / 任务页间接使用 | CRUD、apply、reset 无自动化 | `R1-API-02` |
| 快照 | `src/routes/snapshots.ts`、`views/snapshots.ejs`、文件系统 `snapshots/*.html` | 无专门测试 | 页面存在；扩展可触发保存 | 快照 schema、文件资产和 API 都缺回归 | `R1-API-02`、`R1-BE-03`、`R2-EXT-02` |
| 备份 / 还原 | `src/routes/backups.ts`、文件系统 `backups/*.db` | 无专门测试 | 仅人工高风险操作 | 当前合同与实现不清，且真实数据路径高风险 | `R1-API-02`、`R1-BE-03` |
| AI classify / test / classify-batch | `src/routes/ai.ts`、`src/ai-classify-guardrail.ts` | `tests/integration/ai-routes.test.ts`、`tests/integration/ai-harness.test.ts` | `R15-H1-04` 已做真实 provider 验收 | 单条 classify 的语义质量仍可能漂移，但输出合同已收口到当前模板 / 分类树 | `R15-AI-01`、`R15-AI-02`、`R15-H1-04`、`R5-AI-01` |
| AI organize 生命周期 | `src/routes/ai.ts`、`src/ai-organize.ts`、`src/ai-organize-plan.ts`、`src/routes/pages.ts` | `tests/ai-organize-plan.test.ts` 仅覆盖状态机与日志 | 任务详情页可展示 organize 计划 | 缺 organize HTTP 合同、apply / rollback / stale recovery 回归 | `R15-AI-03` |
| 浏览器扩展 round-trip | `extension-new/` | 无正式自动化 | 仅人工点测说明 | 保存书签 / 快照 / 同时保存缺正式验收 | `R2-EXT-02` |
| `ai_simplify` 遗留面 | `src/db.ts`、`src/jobs.ts` | 无，因为它已不是活跃功能 | 仅保留历史任务兼容读取与旧表迁移清理 | 不再保留专属 UI 分支；若要恢复需新立项 | `R1-DOC-04`、`R4-CLEAN-01` |

## 4. 当前 release gate 口径

- `G1` 只负责冻结范围、合同和验证矩阵，不修业务实现。
- `R1` 的 release gate 以 `npm run build`、`npm test` 和内置 Playwright MCP 最小 smoke 为准。
- 最小 smoke 已验证 `登录 -> 首页 -> 设置 -> 任务 -> 快照 -> 退出`，并在 2026-03-29 用本地临时环境补验了 `R1-DOC-04` 所需的 `/login` 与 `/jobs` 浏览器渲染闭环。
- `R1.5` 的 AI gate 必须同时具备离线 mock / fixture 自动化和 `H1` 真实 provider 人工验收。
- `R2` 的最终 gate 以 `npm test`、`npm run build`、[11-playwright-mcp-release-journeys.md](./11-playwright-mcp-release-journeys.md)、[12-extension-roundtrip-validation.md](./12-extension-roundtrip-validation.md)、[10-ai-provider-h1-validation.md](./10-ai-provider-h1-validation.md) 和 [13-release-handoff.md](./13-release-handoff.md) 为准。

## 5. 2026-03-29 收口状态

| 主题 | 最终覆盖 | 结论 | 残余说明 |
|---|---|---|---|
| 设置 / 模板 / 快照 / 备份 | `tests/integration/ops-routes.test.ts` + Playwright MCP 关键旅程 | 已纳入回归 | 还原继续遵循 partial-restore 合同，不在本轮隐式扩大恢复范围。 |
| AI classify / test / classify-batch | `tests/integration/ai-routes.test.ts`、`tests/integration/ai-harness.test.ts` + H1 实测 | 已纳入回归与人工验收 | 单条 `/api/ai/classify` 的输出合同已被 guardrail 收口；剩余残余只在“模板内语义是否选得足够准”。 |
| AI classify 输出合同 | `src/ai-classify-guardrail.ts` + `tests/integration/ai-routes.test.ts` / `tests/integration/ai-harness.test.ts` | 已纳入回归 | 单条 `/api/ai/classify` 现在会被强制收口到当前模板 / 分类树；完全不可映射则返回错误。 |
| AI organize 生命周期 | `tests/integration/ai-organize-routes.test.ts` + MCP UI + H1 apply / rollback | 已纳入回归 | 真实 provider 质量以“可解释、可回退”为准，不承诺零误判。 |
| 浏览器扩展 | `scripts/extension-roundtrip-validate.ts` + [12-extension-roundtrip-validation.md](./12-extension-roundtrip-validation.md) | 已纳入 `R2` gate | 当前 smoke 覆盖 popup-harness，不是浏览器工具栏中的真实 unpacked extension target。 |
| 文档 / 页面漂移 | README、设置说明、任务详情页 simplify 遗留已清理；`R4-CLEAN-01` 又移除了 `ai_simplify` 专属任务页分支 | `R1-DOC-04`、`R4-CLEAN-01` 可关闭 | `ai_simplify` 只保留 backlog / 历史任务兼容类型与旧表迁移清理，不再视为活跃功能。 |
| 跨页面交互 UI gate | `scripts/category-interaction-validate.ts` + [16-category-interaction-validation.md](./16-category-interaction-validation.md) + [17-cross-view-interaction-validation.md](./17-cross-view-interaction-validation.md) | 已扩展到排序、删除分类、移动子分类、单条 / 批量书签移动、模板切换与刷新保持 | 后续若继续改分类导航、模板切换或书签移动链路，应只在同一 harness 上继续加场景。 |
| UI gate 归属 | 内置 Playwright MCP 是唯一 UI gate；仓库内 `e2e/` 只做历史资产保留 | 基线稳定 | 后续若继续扩展 UI 验收，只追加 MCP 旅程，不恢复仓库内 Playwright 为主 gate。 |
