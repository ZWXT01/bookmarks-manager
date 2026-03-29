# bookmarks-manager 单条 classify 语义择优验收

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)

## 1. 执行信息

- 执行 issue：`R5-AI-02`
- 执行时间：`2026-03-30 00:10:08 +0800` 到 `2026-03-30 00:21:54 +0800`
- 验证入口：
  - `npx tsc --noEmit`
  - `npm test -- tests/ai-classify-guardrail.test.ts tests/integration/ai-routes.test.ts tests/integration/ai-harness.test.ts`
  - `npm test`
  - `npm run build`

## 2. 收口内容

- `src/ai-classify-guardrail.ts` 在原有 taxonomy guardrail 之上新增了本地 deterministic 语义择优：
  - 基于 `title`、`url`、可选 `description`、host/path 信号和分类别名，对候选路径打分
  - 对文档、教程、课程、书籍、示例等内容型子分类给出更强 bonus
  - 对 `GitHub`、`Stack Overflow`、`知乎`、`Reddit`、浏览器扩展商店等社区 / host 给予显式 host bonus
  - 当 provider 输出不可映射，但输入上下文对当前模板中的某个候选足够明确时，允许做 deterministic rescue
- `src/routes/ai.ts` 现在把可选 `description` 同时送入 prompt 和本地语义择优；输入校验也改为“标题 / URL / 描述至少提供一项”。

## 3. 回归覆盖

- 新增 `tests/ai-classify-guardrail.test.ts`，固定 4 类纯函数样本：
  - 普通主题页保持在框架 / 技术桶，不被过度改写
  - 文档页从“合法但过宽”的框架桶 rerank 到 `学习资源/官方文档`
  - provider 输出不可映射时，示例页可被 rescue 到 `学习资源/代码示例`
  - 社区 host 可直接恢复到 `技术社区/GitHub`
- `tests/integration/ai-routes.test.ts` 额外覆盖：
  - 文档语义 override
  - 仅 `description` 输入也能完成单条 classify
  - prompt 中包含 `描述:`，证明 route 已把新增上下文传给 provider
- `tests/integration/ai-harness.test.ts` 额外覆盖：
  - provider 返回 `技术开发/前端` 时，文档类输入仍会在路由层 rerank 为 `学习资源/官方文档`

## 4. 验证结果

- `npx tsc --noEmit` 通过
- AI 定向回归通过：`3` 个测试文件、`13` 条测试
- `npm test` 通过：`18` 个测试文件、`151` 条测试
- `npm run build` 通过

## 5. 结论

- 单条 `/api/ai/classify` 现在不只保证“输出在模板内”，还对常见的内容型高信号场景做了本地 deterministic 收口。
- 这轮关闭的是“模板内明显语义漂移”的主要盲区，不是宣称真实 provider 已经达到零误判。
- 后续如果模板做了大改，或更换了 provider / model，优先扩充 `tests/ai-classify-guardrail.test.ts` 的样本，再按需要补 `H1` 抽样人工验收。
