# AI organize retry 预检与旧失败产物清理验收记录

更新时间：2026-03-31

关联 issue：

- `R7-AI-03`

关联代码：

- `src/ai-organize-plan.ts`
- `src/routes/ai.ts`
- `tests/ai-organize-plan.test.ts`
- `tests/integration/ai-organize-routes.test.ts`

## 1. 本次收口目标

- retry 前先做 AI 配置预检，避免 failed plan 在缺配置时被推进到 `assigning` 但没有实际 worker 入队。
- retry 进入 `assigning` 时清掉旧失败产物，避免任务详情页或接口在重新运行阶段继续暴露旧 `assignments / diff / failed_batch_ids`。

## 2. 实现结论

- `src/routes/ai.ts` 的 `POST /api/ai/organize/:planId/retry` 现在会先校验 AI 配置；缺配置时直接返回 `400`，plan 保持 `failed`，不会创建新的 retry job。
- `src/ai-organize-plan.ts` 的 `transitionStatus(..., 'assigning')` 现在会在 retry 时清掉旧 `assignments`、`failed_batch_ids`、`needs_review_count`、批次计数和旧 `bookmark_states / live_target_categories`，但保留冻结后的 `scope_bookmark_ids` 与模板快照。
- `tests/ai-organize-plan.test.ts` 新增了 retry 清理旧失败产物的 state-machine 级单测。
- `tests/integration/ai-organize-routes.test.ts` 新增两条集成回归：
  - 缺 AI 配置时 retry 返回 `400` 且 plan 保持 `failed`
  - retry 进入 `assigning` 时，详情接口不再暴露旧 preview 数据

## 3. Clean Rerun

- `npx tsc --noEmit`
  - 通过
- `npx vitest run tests/ai-organize-plan.test.ts tests/integration/ai-organize-routes.test.ts --reporter=verbose`
  - `2/2` 文件，`42/42` 用例通过
- `npm test`
  - `22/22` 文件，`182/182` 用例通过
- `npm run build`
  - 通过

## 4. 验收结论

- retry 入口现在不会再产生“状态已经变成 `assigning`，但因为没配置 AI 实际上什么都没跑”的假成功。
- retry 进入 `assigning` 后，任务详情接口也不再短暂暴露旧失败 assignments / diff；新的运行阶段会从干净的状态重新累积结果。
