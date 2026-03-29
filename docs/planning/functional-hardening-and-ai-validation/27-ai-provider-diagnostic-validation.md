# AI provider 直连诊断验收记录

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [AI test 瞬时重试验收记录](./26-ai-test-retry-validation.md)
- [最终回归与交接说明](./13-release-handoff.md)

## 1. 执行信息

- 执行 issue：`R5-AI-07`
- 执行时间：`2026-03-30 03:02:46 +0800` 到 `2026-03-30 03:09:03 +0800`
- 代码范围：
  - `src/routes/ai.ts`
  - `tests/integration/ai-routes.test.ts`
  - `scripts/ai-provider-diagnose.ts`
- 目标：把当前 provider 残余问题从“`/api/ai/test` 仍 timeout”收口到“基础连通与模型发现正常，但 chat completion 链路 timeout”的可执行诊断结论

## 2. 改动摘要

- `/api/ai/test` 现在在 retryable timeout / 连接型故障重试后仍失败时，会补探一次 `/models`，并返回稳定的 `diagnostic` payload。
- 新增 `scripts/ai-provider-diagnose.ts`，可在不启动应用路由的情况下，直接对当前 provider 执行 `/models` 与 `/chat/completions` 诊断，并把结果写入脱敏 JSON 报告。
- 路由合同测试已证明：
  - 首次 timeout、第二次成功时，`/api/ai/test` 仍返回 `200`
  - timeout 重试后仍失败，但 `/models` 可连通且 model 存在时，`/api/ai/test` 返回稳定诊断 payload
  - 普通 provider 错误仍保持 `500`，不被错误诊断逻辑吞掉

## 3. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npm test -- tests/integration/ai-routes.test.ts`
  - 通过
  - `1/1` 文件、`4/4` 用例通过
  - 本地 fixture 证明 `/api/ai/test` 的 timeout diagnostic payload 稳定
- `./node_modules/.bin/tsx scripts/ai-provider-diagnose.ts --report /tmp/bookmarks-ai-provider-diagnose-r5-ai-07.json`
  - 未通过
  - 但输出了完整直连诊断：
    - `/models`：`200`
    - `modelFound = true`
    - `modelCount = 11`
    - `sampleModelIds` 包含 `deepseek-chat`、`deepseek-coder`、`deepseek-think`、`deepseek-r1`、`deepseek-search`
    - `/chat/completions`：`TimeoutError`
    - `errorMessage = "The operation was aborted due to timeout"`
- `./node_modules/.bin/tsx scripts/ai-h1-classify-semantic-validate.ts --ids react-reference-docs --retries 1 --report /tmp/bookmarks-ai-h1-classify-react-docs-diagnostic.json`
  - 未通过
  - `/api/ai/test` 返回：
    - `statusCode = 500`
    - `error = "AI 配置基础连通正常，但聊天补全接口超时"`
    - `diagnostic = { models_ok: true, model_found: true, models_status: 200 }`
  - `tempDirCleaned = true`
- `npm test`
  - 通过
  - `19/19` 文件，`153/153` 用例通过
- `npm run build`
  - 通过

## 4. 结论

- 路由层和直连脚本现在已经能把问题精确收口到 provider 的 chat completion 链路，而不是把它继续模糊成 base URL、API key 或 model 配置失败。
- 截至 `2026-03-30`，当前本地 provider 的 `/models` 端点连通、配置 model 可发现，但 `/chat/completions` 在 `30s` timeout 窗口内仍失败，因此 `RISK-001` 继续保持 `mitigated`，不能视为已完全关闭。
- 单条 `/api/ai/classify` 的 timeout fallback 仍然有效；当前剩余不再是“用户无法得到合法分类”，而是“`/api/ai/test` 和更广泛 provider 健康状况仍需 provider 侧处理”。

## 5. 环境与清理

- `scripts/ai-provider-diagnose.ts` 只读取当前配置并写出脱敏 JSON 报告，不创建临时 DB。
- focused H1 replay 结束后，报告中的 `tempDirCleaned = true`，未遗留临时 DB 或后台验证进程。
- 本次验证继续沿用上一轮为解除 `ENOSPC` 已清理出的空间；本轮未新增额外需要回收的测试服务或临时目录。
