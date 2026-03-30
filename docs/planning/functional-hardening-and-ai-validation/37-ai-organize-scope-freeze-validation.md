# AI organize 作用域冻结验收记录

更新时间：2026-03-31

关联 issue：

- `R7-AI-02`

关联代码：

- `src/ai-organize-plan.ts`
- `src/ai-organize.ts`
- `tests/ai-organize-plan.test.ts`
- `tests/integration/ai-organize-routes.test.ts`

## 1. 本次收口目标

- 冻结 organize plan 的书签作用域，避免 `all / uncategorized / category:N` 在 retry 或排队等待时重新读取 live scope。
- 让 failed plan retry 后继续只处理“创建时决定的那批书签”，而不是把后来新增的书签偷偷吸进来。

## 2. 实现结论

- `src/ai-organize-plan.ts` 现在在 `PlanSourceSnapshot` 中新增 `scope_bookmark_ids` 和 `scope_frozen`。
- `createPlan()` 会在 plan 创建时就解析当前 scope，并把冻结后的 bookmark id 集合写进初始 `source_snapshot`。
- `assignBookmarks()` 现在通过 `getPlanScopeBookmarkIds()` 只读取冻结后的 bookmark 集合；prompt、批次切分和 job total 都不再回扫 live scope。
- `transitionStatus(..., 'assigning')` 在 retry 时会调用 `ensurePlanScopeSnapshot()`；对历史没有 scope freeze 的旧 failed plan，会在首次 retry 时补冻结，避免继续漂移。

## 3. 定向回归

- `tests/ai-organize-plan.test.ts`
  - 新增 plan 创建即冻结 `scope_bookmark_ids` 的 unit test。
- `tests/integration/ai-organize-routes.test.ts`
  - 新增 failed plan retry 后仍只处理原始两条书签、不吸入后来新增书签的集成测试。

## 4. Clean Rerun

- `npx tsc --noEmit`
  - 通过
- `npx vitest run tests/ai-organize-plan.test.ts tests/integration/ai-organize-routes.test.ts --reporter=verbose`
  - `2/2` 文件，`39/39` 用例通过
- `npm test`
  - `22/22` 文件，`179/179` 用例通过
- `npm run build`
  - 通过

## 5. 验收结论

- organize plan 现在不仅冻结模板树和 apply 安全快照，也冻结了“本次要整理哪些书签”。
- failed plan retry 前即使新增书签，retry 后的 prompt、assignments 和 job total 仍只反映原始冻结集合。
- `all` 作用域为空时也会保持“冻结为空”的语义，不会因为后续有新书签出现而在 retry 时偷偷扩大处理范围。
