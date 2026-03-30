# AI organize assigning 单活锁与取消时序验收记录

更新时间：2026-03-31

关联 issue：

- `R7-AI-01`

关联代码：

- `src/ai-organize-plan.ts`
- `src/ai-organize.ts`
- `src/routes/ai.ts`
- `tests/ai-organize-plan.test.ts`
- `tests/integration/ai-organize-routes.test.ts`

## 1. 本次收口目标

- 把 `assigning` 单活锁从“只在 createPlan 上有效”收口为 start / retry 共用合同。
- 阻止 canceled plan 在 in-flight provider 返回后继续写回 preview 数据。
- 让 organize `cancel` / `retry` 的状态机错误返回明确的 `404/409`，而不是被路由折叠成 `500`。

## 2. 实现结论

- `src/ai-organize-plan.ts` 新增统一的 `assigning` 槽位检查与超时回收逻辑，`createPlan()` 和 `transitionStatus(..., 'assigning')` 共用；`PlanError` 现在会显式携带 `activePlanId`。
- `src/ai-organize.ts` 在批次开始、provider 返回后、失败阈值写回前、批次增量回写前和最终 `preview` 终态前都增加了取消检查。已取消 plan 会直接停止执行，不再写 `assignments`、`batches_done`、`source_snapshot` 或 `preview`。
- `src/routes/ai.ts` 的 `cancel` / `retry` 现在会透传状态机层的 `404/409`，`retry` 还会把 `activePlanId` 返回给调用方。
- `tests/integration/ai-organize-routes.test.ts` 新增了四条合同回归：
  - 已有 `assigning` plan 时再次 start 返回 `409 + activePlanId`
  - 已有 `assigning` plan 时 retry 失败 plan 返回 `409 + activePlanId`
  - canceled in-flight plan 在 provider 返回后不会写回 stale preview，后续新 plan 仍可成功 preview
  - cancel missing plan 返回 `404`
- `tests/ai-organize-plan.test.ts` 也补了状态机级的 `404/409` 单测，避免后续路由层绕过集成测试时回退。

## 3. Clean Rerun

- `npx tsc --noEmit`
  - 通过
- `npx vitest run tests/ai-organize-plan.test.ts tests/integration/ai-organize-routes.test.ts --reporter=verbose`
  - `2/2` 文件，`37/37` 用例通过
- `npm test`
  - `22/22` 文件，`177/177` 用例通过
- `npm run build`
  - 通过

## 4. 验收结论

- `start` 和 `retry` 现在共用同一套 `assigning` 单活锁，不再出现“start 被拦住但 retry 能偷偷开第二个 assigning plan”的合同裂缝。
- 取消中的旧 plan 即使 provider 随后返回，也不会把旧 `assignments` / `preview` 覆盖回数据库；新 plan 可以在 cancel 后继续创建并完成 preview。
- organize 状态机错误的返回码已经明确化：missing plan 是 `404`，状态冲突和 active-plan 冲突是 `409`。

## 5. 测试注意事项

- `JobQueue.onIdle()` 当前更适合“队列已空”或 cancel 路径观察，对这种“先挂起 provider、再手动 resolve”的场景不够稳定；本次新增回归统一改为等待 plan / job 终态，而不是依赖队列空闲事件。
- 这条注意事项只影响测试等待策略，不构成当前 release gate 的产品级阻塞。
