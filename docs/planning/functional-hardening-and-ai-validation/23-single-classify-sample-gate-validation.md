# bookmarks-manager 单条 classify 语义样本集验收

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)

## 1. 执行信息

- 执行 issue：`R5-AI-03`
- 执行时间：`2026-03-30 00:25:41 +0800` 到 `2026-03-30 00:35:33 +0800`
- 验证入口：
  - `npx tsx scripts/ai-classify-semantic-validate.ts`
  - `npx tsc --noEmit`
  - `npm test -- tests/ai-classify-guardrail.test.ts tests/ai-classify-semantic-samples.test.ts tests/integration/ai-routes.test.ts tests/integration/ai-harness.test.ts`
  - `npm test`
  - `npm run build`

## 2. 固化内容

- 新增固定样本集：`docs/planning/functional-hardening-and-ai-validation/fixtures/ai-classify-semantic-samples.json`
  - 覆盖文档、教程、在线课程、代码示例
  - 覆盖 `GitHub releases`、`GitHub issues`
  - 覆盖 `Stack Overflow`、`掘金`
  - 覆盖 `Chrome Web Store`
- 新增复验脚本：`scripts/ai-classify-semantic-validate.ts`
  - 默认读取固定样本集
  - 输出总样本数、通过数、失败数和 JSON 报告路径
  - 样本失败时逐条输出 `expected / actual`
- 新增自动化 gate：`tests/ai-classify-semantic-samples.test.ts`
  - 将整份样本集纳入 `npm test`
- 新样本也补出了更具体的 host 规则：
  - `GitHub releases/issues` 优先落到 `Release更新` / `Issue跟踪`
  - `Chrome Web Store` 优先落到 `工具软件/浏览器插件`

## 3. 验证结果

- `npx tsx scripts/ai-classify-semantic-validate.ts` 通过：
  - `Validated 9 single-classify semantic samples.`
  - `Passed: 9`
  - `Failed: 0`
- 定向 classify 回归通过：
  - `4` 个测试文件、`14` 条测试
- `npm test` 通过：
  - `19` 个测试文件、`152` 条测试
- `npm run build` 通过

## 4. 结论

- 单条 `/api/ai/classify` 现在不只在代码里“有一套启发式规则”，而是已经有了固定样本集和可复跑脚本，后续模板调整或 provider 切换时可以直接复验。
- 这轮关闭的是“语义择优缺少固定样本 gate”的盲区，不是替代真实 provider 的最终人工验收。
- 后续如果继续增强单条 classify，优先先扩充 `ai-classify-semantic-samples.json`，再复跑脚本和 `npm test`。
