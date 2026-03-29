# 单条 classify H1 语义复验记录

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)

## 1. 执行信息

- 执行 issue：`R5-AI-04`
- 执行时间：`2026-03-30 01:28:05 +0800` 到 `2026-03-30 01:33:10 +0800`
- 验证脚本：`scripts/ai-h1-classify-semantic-validate.ts`
- 固定样本：`docs/planning/functional-hardening-and-ai-validation/fixtures/ai-classify-semantic-samples.json`
- provider 来源：本地 `data/app.db` 设置项，未向仓库回写任何真实密钥
- provider 脱敏信息：
  - `base_url`: `https://2c***ce/...`
  - `model`: `deepse***hat`
  - `ai_batch_size`: `30`
- 本轮脚本收口：
  - 默认 `timeout_cap_ms` 从 `25000` 调整到 `60000`，与单条 `/api/ai/classify` 路由合同对齐，避免假阴性
  - 新增 `testRoute.attempts`、逐样本 `attempts`、中途 totals 刷新与 `SIGINT` / `SIGTERM` 清理
  - 保留 `--ids`、`--skip-test`、`--retries`，用于 focused replay 与故障隔离

## 2. 执行命令

1. `npx tsx scripts/ai-h1-classify-semantic-validate.ts --ids react-reference-docs --retries 1 --report /tmp/bookmarks-ai-h1-classify-react-docs.json`
2. `npx tsx scripts/ai-h1-classify-semantic-validate.ts --skip-test --ids react-reference-docs --retries 1 --report /tmp/bookmarks-ai-h1-classify-react-docs-skip-test.json`

## 3. focused replay 结果

- `/api/ai/test`
  - `500`
  - `attempts = 1`
  - 返回 `error: "Request timed out."`
  - 说明当前本地 provider 在真实 `30s` 测试路由合同下未通过
- `/api/ai/classify`
  - 在 `--skip-test` 隔离后继续针对 `react-reference-docs` 执行
  - `500`
  - `attempts = 1`
  - 返回 `error: "Request timed out."`
  - `accepted = 0/1`
  - 说明当前本地 provider 在真实 `60s` 单条 classify 路由合同下仍未返回结果

## 4. 结论

- 代码侧的单条 classify taxonomy / semantic guardrail 仍然成立；本轮失败不是“模板外分类回归”，而是当前本地 provider 在 focused H1 replay 中直接超时。
- `R15-H1-04` 的历史 3 样本 organize / classify-batch 验收记录仍保留，但截至 `2026-03-30`，当前本地 provider 已不能把 `/api/ai/test` 和单条 `/api/ai/classify` 视为稳定绿色 gate。
- 后续若要继续把单条 classify 作为真实 provider gate，优先项已经从“再补本地 guardrail”切换为“确认 provider / model 可用性与时延”，否则只会持续得到 `Request timed out.`。

## 5. 清理结果

- 两次 focused replay 结束后，报告中的 `tempDirCleaned = true`，对应临时目录已自动清理。
- 未遗留额外临时 DB、临时 `.env` 或后台验证进程。
