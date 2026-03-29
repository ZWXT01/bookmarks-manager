# bookmarks-manager 最终回归与交接说明

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)
- [真实 AI 提供方联调与人工验收](./10-ai-provider-h1-validation.md)
- [单条 classify H1 语义复验记录](./24-single-classify-h1-replay-validation.md)
- [单条 classify 超时降级验收记录](./25-single-classify-timeout-fallback-validation.md)
- [AI test 瞬时重试验收记录](./26-ai-test-retry-validation.md)
- [AI provider 直连诊断验收记录](./27-ai-provider-diagnostic-validation.md)
- [设置页 AI 诊断 UI 验收记录](./28-settings-ai-diagnostic-ui-validation.md)
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
  - `H1` 真实 provider AI 验收与单条 classify focused replay

## 2. 最终回归结果

| 项目 | 证据 | 结果 |
|---|---|---|
| 自动化测试 | `npm test` 于 2026-03-30 通过，`19` 个测试文件、`154` 条测试全部通过。 | 通过 |
| 构建 | `npm run build` 于 2026-03-30 通过。 | 通过 |
| `R1-DOC-04` 浏览器补验收 | 本地临时环境 `http://127.0.0.1:45577` 通过内置 Playwright MCP 访问 `/login` 与 `/jobs`；标题分别为“登录 - 书签管理器”和“任务列表 - 书签管理器”，`warning/error` 计数为 `0`。 | 通过 |
| MCP 关键业务旅程 | [11-playwright-mcp-release-journeys.md](./11-playwright-mcp-release-journeys.md) 已覆盖登录、首页、设置、模板、快照、备份、任务 / SSE 与 mock AI UI 联动。 | 通过 |
| 浏览器扩展 round-trip | [12-extension-roundtrip-validation.md](./12-extension-roundtrip-validation.md) 已 clean run，覆盖 token、保存书签、保存快照、同时保存与失败提示。 | 通过 |
| `H1` 真实 provider AI 验收 | [10-ai-provider-h1-validation.md](./10-ai-provider-h1-validation.md) 已完成 `test`、`classify-batch`、`organize`、`apply/rollback`。 | 通过（历史基线） |
| `/api/ai/test` 瞬时重试与可操作诊断 | [26-ai-test-retry-validation.md](./26-ai-test-retry-validation.md) 已证明本地 timeout-retry 合同成立；[27-ai-provider-diagnostic-validation.md](./27-ai-provider-diagnostic-validation.md) 又证明当前本地 provider 的 focused H1 replay 虽仍返回 `500`，但错误已稳定收口为 `AI 配置基础连通正常，但聊天补全接口超时`，并附带 `models_ok=true`、`model_found=true`、`models_status=200`。 | 部分通过 |
| provider 直连诊断 | [27-ai-provider-diagnostic-validation.md](./27-ai-provider-diagnostic-validation.md) 已证明当前本地 provider 的 `/models` 为 `200`、配置 model 存在且共返回 `11` 个 model id，但 `/chat/completions` 在 `30s` timeout 窗口内仍失败。 | 部分通过 |
| 设置页 AI 诊断 UI | [28-settings-ai-diagnostic-ui-validation.md](./28-settings-ai-diagnostic-ui-validation.md) 已证明设置页在真实浏览器中能同时展示成功态和 `models_ok=true` 的 timeout 诊断态，操作员不必再只靠 toast 或 network 面板。 | 通过 |
| 单条 classify 语义择优 | [22-single-classify-semantic-validation.md](./22-single-classify-semantic-validation.md) 已补齐本地语义 rerank、样本回归和 `description` 上下文。 | 通过 |
| 单条 classify 样本集 gate | [23-single-classify-sample-gate-validation.md](./23-single-classify-sample-gate-validation.md) 已固化固定样本集、复验脚本和 `npm test` 自动化入口。 | 通过 |
| 单条 classify focused H1 replay | [24-single-classify-h1-replay-validation.md](./24-single-classify-h1-replay-validation.md) 记录了当前本地 provider 在 focused replay 上的首次 timeout 基线；[25-single-classify-timeout-fallback-validation.md](./25-single-classify-timeout-fallback-validation.md) 则证明单条 classify 在 `--skip-test` 条件下已通过 timeout fallback 恢复到 `1/1`。 | 部分通过 |

## 3. 发布级结论

- 代码侧与离线 gate 仍然闭环，可交接给后续维护者继续在现有 taxonomy / semantic contract 上维护。
- `R1-DOC-04` 的历史阻塞已解除，文档 / 页面漂移不再是发布阻塞项。
- 当前风险台账中已无 `open + blocked` 的遗留项，但 `RISK-001` 仍是活跃保留风险。
- 单条 `/api/ai/classify` 已从“只保证模板内输出”继续收口到“对常见文档 / 教程 / 示例 / 社区 host 场景也有本地 deterministic 语义择优”。
- 单条 `/api/ai/classify` 现在还具备固定语义样本集与 focused H1 replay 脚本；模板调整或 provider / model 切换后不再需要靠零散手工样本复测。
- 截至 `2026-03-30`，当前本地 provider 的 `/api/ai/test` 即使加了 1 次瞬时重试也仍不是稳定绿色；但它现在已经能明确报告“基础连通正常、chat completion 超时”，不再把 provider 问题混成泛化的配置失败。
- 单条 `/api/ai/classify` 对高信号输入已具备 timeout fallback，用户面风险已进一步收口；当前主要残余集中在 provider 的 chat completion 可用性，而不是 taxonomy / 语义合同失控。
- 设置页现在也会把上述诊断直接展示给操作员，当前残余不再包含“诊断存在但只能由开发者从接口响应里读取”的可见性缺口。

## 4. 保留风险

| risk_id | 状态 | 说明 |
|---|---|---|
| `RISK-001` | mitigated | 单条 `/api/ai/classify` 现在已具备 taxonomy guardrail + 本地语义择优 + timeout fallback；`/api/ai/test` 也已具备 1 次瞬时重试、`/models` 诊断和设置页可见结果面板，但当前本地 provider 仍未恢复绿色，且直连 probe 已证明主要问题集中在 chat completion 链路，发版前仍需复跑或更换稳定 provider。 |

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
| 单条 classify H1 focused replay | `npx tsx scripts/ai-h1-classify-semantic-validate.ts --ids react-reference-docs`；若要隔离 `/api/ai/classify` 本身，可加 `--skip-test` |
| provider 直连诊断 | `npx tsx scripts/ai-provider-diagnose.ts --report /tmp/bookmarks-ai-provider-diagnose.json` |
| 设置页 AI 诊断 UI | `npx tsx scripts/settings-ai-diagnostic-validate.ts` |
| MCP UI gate | `npx tsx scripts/playwright-mcp-smoke-env.ts` 启动临时服务，再按 [08](./08-playwright-mcp-smoke-baseline.md) 与 [11](./11-playwright-mcp-release-journeys.md) 用内置 Playwright MCP 复跑 |
| 扩展 round-trip | `npx tsx scripts/extension-roundtrip-validate.ts` |
| 真实 AI `H1` | 按 [10](./10-ai-provider-h1-validation.md) 的步骤，用人工提供的临时凭证复跑，结束后清理临时环境 |

## 7. 清理结论

- 本次 `R1-DOC-04` 本地 MCP 补验收使用的临时目录 `/tmp/bookmarks-mcp-smoke-Ni4Vb8` 已确认删除。
- 本次 `R5-AI-04` focused H1 replay 使用的临时目录已在报告中确认 `tempDirCleaned = true`，未遗留临时 DB 或后台验证进程。
- 本次 `R5-AI-05` focused H1 replay fallback 验收同样确认 `tempDirCleaned = true`，未遗留临时 DB 或后台验证进程。
- 本次 `R5-AI-06` 验证中曾遇到根分区 `ENOSPC`，已清理用户本地生成的 `~/.npm` 缓存和仓库内可重建的 `dist/` 后恢复执行；focused H1 replay 结束后未遗留临时 DB 或后台验证进程。
- 本次 `R5-AI-07` direct diagnose 只写出脱敏 JSON 报告，不创建临时 DB；focused H1 replay 同样确认 `tempDirCleaned = true`。
- 本次 `R5-AI-08` 设置页浏览器 harness 使用 `createTestApp()` 临时环境和 headless Chrome，退出后已清理临时目录与会话环境。
- `R2-REL-03` 本轮未遗留额外测试服务、端口、临时二进制或测试数据。
