# bookmarks-manager 单条 classify taxonomy guardrail 验收

更新时间：2026-03-29

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 执行信息

- 执行 issue：`R5-AI-01`
- 执行时间：`2026-03-29 21:32:12 +0800` 起
- 验证入口：
  - `npm test -- tests/integration/ai-routes.test.ts tests/integration/ai-harness.test.ts`
  - `npx tsc --noEmit`
- 验证环境：`createTestApp()` 启动的本地临时服务 + queued AI fixture harness

## 2. 收口内容

- 单条 `/api/ai/classify` 不再只是把 provider 返回值裁成最多两级，而是新增了 `src/ai-classify-guardrail.ts`：
  - 优先读取活动模板的分类树
  - 若无活动模板，再回退到 live categories
  - 将 provider 返回值标准化到当前分类树
  - 完全不可映射时拒绝返回模板外分类
- 路由 prompt 也同步改为“候选分类精确枚举 + 只能从候选中选一个”，不再只给一级分类提示。
- 这样即使真实 provider 继续给出 `学习资源/React` 这类模板外二级路径，路由层也会把它收口到模板内合法结果，或直接报错，不再把坏路径透传到扩展 / UI。

## 3. 验证结果

本次新增和补强的离线回归覆盖：

- `/api/ai/classify` 在活动模板下会把 `技术开发/后端/Node.js` 收口为 `技术开发/后端`
- `/api/ai/classify` 在活动模板下会把 `学习资源/React` 归一化为 `学习资源/文档`
- `/api/ai/classify` 对完全不可映射的返回值会拒绝并返回错误，而不是透传模板外分类
- prompt 中显式包含候选分类列表，证明模型收到的是“精确候选”而不是宽泛一级分类提示

关键断言：

- `tests/integration/ai-routes.test.ts`
  - 成功路径断言 prompt 包含 `候选分类（必须原样选择其一`
  - `学习资源/React -> 学习资源/文档`
  - `完全不存在/随便 -> 502 { error: 'AI 返回的分类不在当前分类树中' }`
- `tests/integration/ai-harness.test.ts`
  - 离线 deterministic harness 证明 `学习资源/React` 会被稳定收口为 `学习资源/文档`

本次验证命令均通过：

- `npx tsc --noEmit`
- `npm test -- tests/integration/ai-routes.test.ts tests/integration/ai-harness.test.ts`

## 4. 结论

- 单条 `/api/ai/classify` 的输出合同已经从“可能给出模板外路径的辅助建议”收口为“只能返回当前模板 / 分类树内的合法分类，或显式报错”。
- 这轮关闭的是 taxonomy drift / output contract 风险，不是模型语义正确率风险。
- 后续若继续增强，应围绕“模板内候选之间是否选得够准”补语义评测样本，而不是再放松当前 guardrail。
