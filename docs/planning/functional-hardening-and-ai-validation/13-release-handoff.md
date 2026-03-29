# bookmarks-manager 最终回归与交接说明

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)
- [真实 AI 提供方联调与人工验收](./10-ai-provider-h1-validation.md)
- [Playwright MCP 关键业务旅程验收](./11-playwright-mcp-release-journeys.md)
- [浏览器扩展 round-trip 验收](./12-extension-roundtrip-validation.md)

## 1. 执行信息

- 执行 issue：`R2-REL-03`
- 执行时间：`2026-03-29 16:30:00 +0800` 到 `2026-03-29 16:35:22 +0800`
- 当前发布口径：
  - `npm test`
  - `npm run build`
  - 内置 Playwright MCP UI gate
  - 扩展 popup round-trip harness
  - `H1` 真实 provider AI 验收

## 2. 最终回归结果

| 项目 | 证据 | 结果 |
|---|---|---|
| 自动化测试 | `npm test` 于 2026-03-30 通过，`19` 个测试文件、`152` 条测试全部通过。 | 通过 |
| 构建 | `npm run build` 于 2026-03-30 通过。 | 通过 |
| `R1-DOC-04` 浏览器补验收 | 本地临时环境 `http://127.0.0.1:45577` 通过内置 Playwright MCP 访问 `/login` 与 `/jobs`；标题分别为“登录 - 书签管理器”和“任务列表 - 书签管理器”，`warning/error` 计数为 `0`。 | 通过 |
| MCP 关键业务旅程 | [11-playwright-mcp-release-journeys.md](./11-playwright-mcp-release-journeys.md) 已覆盖登录、首页、设置、模板、快照、备份、任务 / SSE 与 mock AI UI 联动。 | 通过 |
| 浏览器扩展 round-trip | [12-extension-roundtrip-validation.md](./12-extension-roundtrip-validation.md) 已 clean run，覆盖 token、保存书签、保存快照、同时保存与失败提示。 | 通过 |
| `H1` 真实 provider AI 验收 | [10-ai-provider-h1-validation.md](./10-ai-provider-h1-validation.md) 已完成 `test`、`classify-batch`、`organize`、`apply/rollback`。 | 通过 |
| 单条 classify 语义择优 | [22-single-classify-semantic-validation.md](./22-single-classify-semantic-validation.md) 已补齐本地语义 rerank、样本回归和 `description` 上下文。 | 通过 |
| 单条 classify 样本集 gate | [23-single-classify-sample-gate-validation.md](./23-single-classify-sample-gate-validation.md) 已固化固定样本集、复验脚本和 `npm test` 自动化入口。 | 通过 |

## 3. 发布级结论

- 当前 `R2` release gate 已闭环，可交接给后续维护者继续在现有合同上维护。
- `R1-DOC-04` 的历史阻塞已解除，文档 / 页面漂移不再是发布阻塞项。
- 当前风险台账中已无 `open + blocked` 的遗留项。
- 单条 `/api/ai/classify` 已从“只保证模板内输出”继续收口到“对常见文档 / 教程 / 示例 / 社区 host 场景也有本地 deterministic 语义择优”。
- 单条 `/api/ai/classify` 现在还具备固定语义样本集与复验脚本；模板调整或 provider / model 切换后不再需要靠零散手工样本复测。

## 4. 保留风险

| risk_id | 状态 | 说明 |
|---|---|---|
| `RISK-001` | mitigated | 单条 `/api/ai/classify` 现在已具备 taxonomy guardrail + 本地语义择优；剩余保留项只在模板大改或 provider / model 更换后的抽样人工验收。 |

## 5. 交接说明

- UI gate 继续只认内置 Playwright MCP；仓库内 `e2e/` 和 `playwright.config.ts` 保留为历史资产，不恢复为当前主 gate。
- AI 凭证继续只通过设置页写入本地环境；真实 `base_url`、`api_key`、`model` 不进入仓库、日志或文档样例。
- 备份还原继续维持 partial-restore 合同，只恢复 `categories` 与 `bookmarks`，并保留 `pre_restore_*.db` 回滚点。
- 扩展当前使用 `category_id` 提交分类，并以下拉完整路径展示分类；后续不要回退到按分类名提交。

## 6. 复跑入口

| 范围 | 入口 |
|---|---|
| 自动化回归 | `npm test` |
| 构建验证 | `npm run build` |
| 单条 classify 语义回归 | `npm test -- tests/ai-classify-guardrail.test.ts tests/integration/ai-routes.test.ts tests/integration/ai-harness.test.ts` |
| 单条 classify 样本集 gate | `npx tsx scripts/ai-classify-semantic-validate.ts` |
| MCP UI gate | `npx tsx scripts/playwright-mcp-smoke-env.ts` 启动临时服务，再按 [08](./08-playwright-mcp-smoke-baseline.md) 与 [11](./11-playwright-mcp-release-journeys.md) 用内置 Playwright MCP 复跑 |
| 扩展 round-trip | `npx tsx scripts/extension-roundtrip-validate.ts` |
| 真实 AI `H1` | 按 [10](./10-ai-provider-h1-validation.md) 的步骤，用人工提供的临时凭证复跑，结束后清理临时环境 |

## 7. 清理结论

- 本次 `R1-DOC-04` 本地 MCP 补验收使用的临时目录 `/tmp/bookmarks-mcp-smoke-Ni4Vb8` 已确认删除。
- `R2-REL-03` 本轮未遗留额外测试服务、端口、临时二进制或测试数据。
