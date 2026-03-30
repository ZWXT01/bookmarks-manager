# Grok 默认 provider 验证与 SSE 兼容验收记录

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)
- [最终回归与交接说明](./13-release-handoff.md)

## 1. 执行信息

- 执行 issue：`R5-AI-09`
- 执行时间：`2026-03-30 14:40:00 +0800` 到 `2026-03-30 15:34:32 +0800`
- 代码范围：
  - `src/provider-validation-config.ts`
  - `src/ai-client.ts`
  - `src/routes/ai.ts`
  - `src/ai-organize.ts`
  - `scripts/ai-provider-diagnose.ts`
  - `scripts/ai-h1-classify-semantic-validate.ts`
  - `scripts/ai-h1-validate.ts`
  - `views/settings.ejs`
  - `tests/ai-client.test.ts`
  - `tests/provider-validation-config.test.ts`
  - `tests/integration/ai-routes.test.ts`
  - `tests/integration/page-assets.test.ts`
- 目标：让真实 provider 验证默认使用本地 Grok 源，并兼容 CherryStudio 风格的 OpenAI 兼容 SSE completion 返回，恢复 default provider 的 direct diagnose、focused H1 与 full H1 绿色闭环。

## 2. 改动摘要

- 新增共享 validation config helper，provider validation 脚本默认使用 `--provider grok`，并从本地 `validation_grok_*` 设置项读取；若要验证当前应用配置，需要显式传 `--provider current`。
- 将默认 Grok validation endpoint 与设置页预设修正到实际可用的 `https://grok2api.1018666.xyz/v1`。
- 为 AI client 增加统一 completion text 提取层，兼容：
  - 标准 `choices[0].message.content`
  - `text/event-stream` `data: ... delta.content` 分块响应
  - `<think>...</think>` 噪音剥离
- 单条 classify 与 organize 现在统一走这套解析层，因此默认 Grok 源返回的 SSE completion 不再被误判成“空结果”。

## 3. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npm test`
  - 通过
  - `21/21` 文件、`162/162` 用例通过
- `npm run build`
  - 通过
- `npx tsx scripts/ai-provider-diagnose.ts --report /tmp/bookmarks-ai-provider-diagnose-grok-default.json`
  - 通过
  - `/models = 200`
  - `modelFound = true`
  - `modelCount = 15`
  - `/chat/completions = 200`
  - `content-type = text/event-stream; charset=utf-8`
- `npx tsx scripts/ai-h1-classify-semantic-validate.ts --ids react-reference-docs --retries 1 --report /tmp/bookmarks-ai-h1-classify-react-docs-grok-fixed.json`
  - 通过
  - `/api/ai/test = 200`
  - `react-reference-docs = 1/1 accepted`
  - `actualCategory = 学习资源/官方文档`
  - `tempDirCleaned = true`
- `npx tsx scripts/ai-h1-validate.ts --report /tmp/bookmarks-ai-h1-grok-fixed.json`
  - 通过
  - `/api/ai/test = 200`
  - `singleAccepted = 1/1`
  - `batchAccepted = 3/3`
  - `batchNeedsReview = 0`
  - `organizeAccepted = 3/3`
  - `organizeNeedsReview = 0`
  - `apply.applied_count = 3`
  - `rollback.restored_bookmarks = 3`
  - `tempDirCleaned = true`

## 4. 结论

- 默认 provider 验证现在已经从“依赖当前应用设置碰巧指向正确 provider”收口成明确的 Grok 默认源。
- 当前 Grok OpenAI 兼容入口返回的是 SSE completion，而不是普通 JSON completion；这也是此前 `/api/ai/test` 能通、但 `classify` / `organize` 误报空结果的根因。
- 在补齐 SSE `delta.content` 解析和 `<think>` 清理后，默认 Grok 源的 direct diagnose、focused H1 与 full H1 已全部恢复绿色。
- 当前 release gate 下，`RISK-001` 可关闭；后续只有在手工切换 provider / endpoint 时，才需要显式传 `--provider current` 重新复验当前应用配置。

## 5. 环境与清理

- 本次 default Grok diagnose 只写出脱敏 JSON 报告，不创建临时 DB。
- focused H1 与 full H1 报告均确认 `tempDirCleaned = true`。
- 本次未遗留后台验证进程、临时服务或额外端口占用。
