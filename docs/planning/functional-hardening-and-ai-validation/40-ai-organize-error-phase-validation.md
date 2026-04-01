# AI organize error phase 与 retry 语义验收记录

## 目标

- 收口 `error` plan 的产品语义，避免首页 organize modal 在 plan 进入 `error` 后仍停留在 `assigning`。
- 明确 `/api/ai/organize/:planId/retry` 的判定顺序和 retry 合同，避免 missing plan / invalid status 被 AI 配置错误盖住。

## 实现摘要

- `src/ai-organize-plan.ts`
  - `error` 现在允许显式回到 `assigning`，与 `failed` 一样进入重试路径。
- `src/routes/ai.ts`
  - `retry` 入口先判 plan 是否存在、当前状态是否可重试，再判 AI 配置。
  - organize `active/detail/pending` 响应现在会附带当前 job 的 `message`，便于前端直接展示中断原因。
- `public/app.js`
  - organize phase state machine 现在显式识别 `error`。
  - `retryOrganize()` 在非 `2xx` 返回时会直接展示后端错误，不再静默吞掉。
- `views/index.ejs`
  - organize modal 新增 `error` phase 展示，支持显示 job message。
- `views/job.ejs`
  - organize plan badge 现在能区分 `failed` 和 `error`。
- `tests/integration/ai-organize-routes.test.ts`
  - 新增 missing-plan retry 优先级回归。
  - 新增 error plan retry 恢复回归。
  - 新增 error detail message 可见性回归。

## Clean Rerun

- `npx tsc --noEmit`
- `npx vitest run tests/integration/ai-organize-routes.test.ts --reporter=verbose`
  - `1/1` 文件，`26/26` 用例通过
- `npm test`
  - `22/22` 文件，`186/186` 用例通过
- `npm run build`

## 结论

- missing plan 的 `retry` 现在稳定优先返回 `404`，不会再被 AI 配置错误盖住。
- `error` plan 现在具备明确的 retry 语义；在问题已修复的前提下，可以重新进入 `assigning` 并完成 preview。
- 首页 organize modal 和任务详情页都已明确识别 `error`，不会再在 error plan 上卡住或退回原始状态字符串。
