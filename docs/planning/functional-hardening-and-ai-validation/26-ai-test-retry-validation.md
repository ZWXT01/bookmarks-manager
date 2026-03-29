# AI test 瞬时重试验收记录

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [单条 classify H1 语义复验记录](./24-single-classify-h1-replay-validation.md)
- [单条 classify 超时降级验收记录](./25-single-classify-timeout-fallback-validation.md)

## 1. 执行信息

- 执行 issue：`R5-AI-06`
- 执行时间：`2026-03-30 02:24:55 +0800` 到 `2026-03-30 02:41:31 +0800`
- 代码范围：
  - `src/routes/ai.ts`
  - `tests/integration/ai-routes.test.ts`
- 目标：为 `/api/ai/test` 增加 1 次仅针对 timeout / 连接型故障的瞬时重试，并验证这条改动对当前真实 provider 是否足以恢复绿色

## 2. 改动摘要

- `/api/ai/test` 现在会在 timeout / 连接型 provider 故障时自动重试 1 次。
- 普通 provider 失败、配置错误和非连接型故障仍保持原样报错，不会被错误吞掉。
- 单条 classify 上一轮新增的 retryable 错误识别逻辑被提炼成通用 helper，供 `/api/ai/test` 与 `/api/ai/classify` 共用。

## 3. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npm test -- tests/integration/ai-routes.test.ts`
  - 通过
  - `4/4` 用例通过
  - 本地 fixture 证明：
    - 首次 `Request timed out.`、第二次 `OK` 时，`/api/ai/test` 返回 `200`
    - 普通 `fixture test failure` 仍返回 `500`
- `./node_modules/.bin/tsx scripts/ai-h1-classify-semantic-validate.ts --ids react-reference-docs --retries 1 --report /tmp/bookmarks-ai-h1-classify-react-docs-with-test-retry.json`
  - 未通过
  - `/api/ai/test` 返回 `500`
  - `error: "Request timed out."`
  - `tempDirCleaned = true`
- `npm test`
  - 通过
  - `19/19` 文件，`153/153` 用例通过
- `npm run build`
  - 通过

## 4. 结论

- `/api/ai/test` 的本地瞬时重试合同已经成立，能覆盖“第一次 timeout，第二次成功”的短暂抖动场景。
- 但截至 `2026-03-30`，当前本地 provider 并没有被这 1 次重试拉回绿色；focused H1 replay 仍停在 `/api/ai/test -> 500 Request timed out.`。
- 当前残余风险因此进一步收敛为“provider 可用性问题已经超出一次瞬时重试能解决的范围”，而不是“路由完全没有任何抗抖动能力”。

## 5. 环境与清理

- 执行中一度遇到根分区 `ENOSPC`，已清理验证临时目录、用户本地生成的 `~/.npm` 缓存和仓库内可重建的 `dist/` 输出后恢复执行。
- focused H1 replay 结束后，报告中的 `tempDirCleaned = true`，未遗留临时 DB 或后台验证进程。
