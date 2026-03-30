# 模板编辑后 AI 默认源验收记录

更新时间：2026-03-30

## 1. 执行信息

- 执行 issue：`R6-AI-03`
- 执行时间：`2026-03-30 19:38:52 +0800` 到 `2026-03-30 19:49:39 +0800`
- 代码范围：
  - `src/ai-organize-plan.ts`
  - `src/ai-organize.ts`
  - `tests/integration/ai-routes.test.ts`
  - `tests/integration/ai-organize-routes.test.ts`
  - `tests/integration/ai-harness.test.ts`

## 2. 收口目标

- 把默认单条 `classify`、`classify-batch` 和 `organize` 的分类源统一到“最新活动模板”，而不是 live categories 或旧 snapshot。
- 保留显式 `template_id` 的跨模板 organize 合同，避免默认活动模板覆盖显式指定模板。
- 补齐 assigning 期间模板被编辑时的安全合同，确保旧 preview 会被明确判 stale，而不是继续伪装成新模板结果。

## 3. 实现摘要

- `createPlan()` 现在会在 plan 创建时冻结 `target_tree` 和初始 `source_snapshot.template`，把当时使用的模板树与模板更新时间写进 plan。
- `assignBookmarks()` 现在统一基于 plan 自带的 `target_tree` 生成候选分类和校验集合，不再在“目标模板就是当前活动模板”时回退到 live categories。
- `buildPlanSourceSnapshot()` 现在会优先复用 plan 创建时冻结的模板快照，避免 assigning 期间模板被改后，把新模板的 `updated_at` / 路径错误写回旧 preview。
- 新回归证明了三条合同：
  - 默认单条 `classify` 和默认 `classify-batch` 在活动模板编辑后只会看到最新模板路径，不再混入旧分类。
  - 默认 `organize` 在活动模板编辑后会跟随最新活动模板；显式 `template_id` 仍稳定使用指定模板。
  - assigning 中途改模板时，旧 preview 会因为 `target template changed` 被拒绝 apply。

## 4. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npx vitest run tests/integration/ai-harness.test.ts --reporter=verbose`
  - 通过，`1/1` 文件，`6/6` 用例
- `npx vitest run tests/integration/ai-routes.test.ts --reporter=verbose`
  - 通过，`1/1` 文件，`5/5` 用例
  - 期间出现的 `fixture test failure`、`fixture classify failure` 为预期负路径日志
- `npx vitest run tests/integration/ai-organize-routes.test.ts --reporter=verbose`
  - 通过，`1/1` 文件，`15/15` 用例
- `npm test`
  - 通过，`21/21` 文件，`167/167` 用例
- `npm run build`
  - 通过

## 5. 结论

- 默认 AI 分类入口在模板编辑后已不再读漂移的 live categories，而是统一读最新活动模板。
- 显式 `template_id` 的 organize 没有被默认活动模板覆盖，跨模板合同保持稳定。
- assigning 期间模板被改时，旧 preview 会被安全地判 stale；不会出现“候选分类已经换成新模板，但 preview 仍沿用旧模板结果”的隐蔽错配。
