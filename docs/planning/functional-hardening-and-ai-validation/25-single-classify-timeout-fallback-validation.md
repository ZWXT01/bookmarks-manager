# 单条 classify 超时降级验收记录

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [单条 classify H1 语义复验记录](./24-single-classify-h1-replay-validation.md)

## 1. 执行信息

- 执行 issue：`R5-AI-05`
- 执行时间：`2026-03-30 01:58:22 +0800` 到 `2026-03-30 02:06:02 +0800`
- 代码范围：
  - `src/ai-classify-guardrail.ts`
  - `src/routes/ai.ts`
  - `tests/ai-classify-guardrail.test.ts`
  - `tests/integration/ai-routes.test.ts`
- 目标：在真实 provider 发生 timeout / 连接型故障时，让单条 `/api/ai/classify` 对高信号书签退化到本地 deterministic guardrail，而不是直接返回 `500`

## 2. 改动摘要

- 新增 `selectDeterministicSingleClassifyCategory()`，把现有单条 classify 的本地语义评分能力显式暴露成“无模型结果时也可选分类”的入口。
- `/api/ai/classify` 现在只对 timeout / 连接型 provider 故障启用 fallback；无效密钥、普通 provider 错误和其他非连接型故障仍保持原样报错。
- 路由级合同新增两条保证：
  - 高信号输入在 provider timeout 时仍可返回模板内合法分类
  - 普通 provider 失败不会被错误吞掉

## 3. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npm test -- tests/ai-classify-guardrail.test.ts tests/integration/ai-routes.test.ts`
  - 通过
  - `9/9` 用例通过
- `npx tsx scripts/ai-h1-classify-semantic-validate.ts --skip-test --ids react-reference-docs --retries 1 --report /tmp/bookmarks-ai-h1-classify-react-docs-fallback.json`
  - 通过
  - `Accepted: 1/1`
  - `react-reference-docs -> 学习资源/官方文档`
  - `statusCode = 200`
  - `tempDirCleaned = true`

## 4. 结论

- `R5-AI-04` 暴露出的“单条 classify 在真实 provider timeout 时直接失败”已被进一步收口。
- 截至 `2026-03-30`，当前本地 provider 仍不能把 `/api/ai/test` 视为稳定绿色 gate，但单条 `/api/ai/classify` 对高信号输入已经具备 timeout 降级能力。
- 当前残余风险不再是“单条 classify 一旦 provider timeout 就完全不可用”，而是“provider 可用性依然不稳，且低信号输入不保证一定能被 deterministic fallback 稳定分类”。
