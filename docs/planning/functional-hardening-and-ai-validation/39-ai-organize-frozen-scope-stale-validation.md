# AI organize 冻结 scope 缺对象 stale 验收记录

## 目标

- 收口 `organize` 在 worker 真正执行时的冻结 scope 合同，避免 scope 中已有缺失书签却静默缩小处理集合继续 preview。
- 收口 assigning 阶段的致命异常，避免 job 已 `failed` 但 plan 仍卡在 `assigning`。

## 实现摘要

- `src/ai-organize.ts`
  - 新增 `failPlanExecution()`，统一把 assigning 阶段的致命异常落到 `plan = error`、`job = failed + message`。
  - `assignBookmarks()` 在读取冻结后的 `scope_bookmark_ids` 后，会校验 live bookmarks 是否完整；若存在缺失对象，直接把 plan 标记为 stale `error` 并停止，不再继续发起 AI 请求。
- `src/routes/ai.ts`
  - organize start / retry 的 worker catch 统一接入 `failPlanExecution()`，避免异常后残留假活跃 `assigning` plan。
- `tests/integration/ai-organize-routes.test.ts`
  - 新增 “ids scope 缺对象 start” 回归。
  - 新增 “retry 前删除冻结 scope 书签” 回归。

## Clean Rerun

- `npx tsc --noEmit`
- `npx vitest run tests/integration/ai-organize-routes.test.ts --reporter=verbose`
  - `1/1` 文件，`24/24` 用例通过
- `npm test`
  - `22/22` 文件，`184/184` 用例通过
- `npm run build`

## 结论

- organize worker 现在不会再在冻结 scope 缺对象时静默缩水；缺失对象会被显式判定为 stale `error`。
- 这条 stale 合同同时覆盖 `start` 和 `retry`。
- assigning 阶段出现致命异常后，plan 不会再假装活跃地停留在 `assigning`。
