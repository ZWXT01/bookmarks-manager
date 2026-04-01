# AI organize error plan 放弃合同验收记录

## 目标

- 收口 `error` plan 的“放弃/取消”合同，避免首页 modal 显示了可取消动作，但服务端状态机实际拒绝 `error -> canceled`。
- 修正前端取消动作对非 `2xx` 的误报，避免服务端失败时仍提示“已取消”并关闭 modal。

## 实现摘要

- `src/ai-organize-plan.ts`
  - 状态机现在允许 `error -> canceled`，与 `failed` 一样可被显式放弃。
- `public/app.js`
  - `cancelOrganize()` 和 `cancelAndRestart()` 现在都会检查 HTTP 结果，并优先展示后端返回的错误信息。
- `tests/integration/ai-organize-routes.test.ts`
  - 新增 `error` plan cancel 回归，证明取消后 plan 进入 `canceled`，同时保留原 failed job 的 message / status 留痕。

## Clean Rerun

- `npx tsc --noEmit`
- `npx vitest run tests/integration/ai-organize-routes.test.ts --reporter=verbose`
  - `1/1` 文件，`27/27` 用例通过
- `npm test`
  - `22/22` 文件，`187/187` 用例通过
- `npm run build`

## 结论

- `error` plan 现在可以被显式取消，不再返回 `409 invalid transition`。
- 首页 modal 的“放弃”动作不再对失败响应静默成功；只有服务端确认成功时才会关闭 modal。
- 取消 `error` plan 不会篡改原 failed job 的状态和错误信息留痕。
