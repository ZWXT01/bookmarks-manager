# bookmarks-manager 功能覆盖矩阵

更新时间：2026-03-28

关联文档：

- [执行路线图](./02-roadmap.md)
- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 基线验证结论

| 项目 | 当前结论 | 证据 |
|---|---|---|
| 构建基线 | `npm run build` 于 2026-03-28 通过。 | 当前工作区执行通过。 |
| 自动化测试基线 | `npm test` 于 2026-03-28 通过，`13` 个测试文件、`119` 条测试全部通过。 | 当前工作区执行通过。 |
| 仓库内 Playwright 资产 | `e2e/` 中存在 `3` 个 spec 文件、`11` 条用例。 | `bookmarks.spec.ts`、`categories.spec.ts`、`search-and-shortcuts.spec.ts`。 |
| UI 验证主路径 | 当前主路径不是仓库内 Playwright，而是后续要在 `R1-QA-01` 固化的内置 Playwright MCP smoke。 | [执行路线图](./02-roadmap.md) 与 [Agent 执行手册](./04-agent-runbook.md) 已冻结该约束。 |

## 2. Gate 冻结结论

| 主题 | 冻结结论 | 依据 | 后续 issue |
|---|---|---|---|
| `ai_simplify` | 视为历史遗留 / backlog，不纳入本轮 release gate。 | 当前活跃路由面没有 `/api/ai/simplify` 或 `/api/ai/apply-simplify`；仅剩 README、任务页与类型定义遗留。 | `R1-DOC-04` |
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
| AI classify / test / classify-batch | `src/routes/ai.ts` | 无专门测试 | 无正式 H1 验收记录 | 缺 mock / fixture、HTTP 合同测试与真实 provider 验收 | `R15-AI-01`、`R15-AI-02`、`R15-H1-04` |
| AI organize 生命周期 | `src/routes/ai.ts`、`src/ai-organize.ts`、`src/ai-organize-plan.ts`、`src/routes/pages.ts` | `tests/ai-organize-plan.test.ts` 仅覆盖状态机与日志 | 任务详情页可展示 organize 计划 | 缺 organize HTTP 合同、apply / rollback / stale recovery 回归 | `R15-AI-03` |
| 浏览器扩展 round-trip | `extension-new/` | 无正式自动化 | 仅人工点测说明 | 保存书签 / 快照 / 同时保存缺正式验收 | `R2-EXT-02` |
| `ai_simplify` 遗留面 | `views/job.ejs`、`src/routes/pages.ts`、`src/jobs.ts`、README | 无，因为它已不是活跃功能 | 仅遗留文案和类型存在 | 需要明确下线 / backlog 身份并清理漂移 | `R1-DOC-04` |

## 4. 当前 release gate 口径

- `G1` 只负责冻结范围、合同和验证矩阵，不修业务实现。
- `R1` 的 release gate 以 `npm run build`、`npm test` 和内置 Playwright MCP 最小 smoke 为准。
- `R1.5` 的 AI gate 必须同时具备离线 mock / fixture 自动化和 `H1` 真实 provider 人工验收。
- `R2` 结束时，扩展 round-trip、MCP UI smoke、最终回归与交接文档必须全部闭环。
