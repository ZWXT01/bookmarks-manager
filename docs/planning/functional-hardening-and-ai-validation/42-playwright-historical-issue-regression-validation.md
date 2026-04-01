# 历史 issue Playwright 浏览器复验记录

更新时间：2026-04-01

关联 issue：

- `R7-QA-07`

## 1. 目标

- 把此前已经收口、且具有页面 / 浏览器宿主表面的历史 issue 做一次统一的 clean browser replay。
- 不恢复仓库内 `e2e/` 和 `playwright.config.ts` 为主验证路径。
- 记录当前会话里“没有可调用的 Playwright MCP server”这一事实，因此本次执行采用独立 Playwright 浏览器 harness 做等价复验。

## 2. 本轮新增入口

- `scripts/playwright-release-journeys-validate.ts`
  - 回放 `R1-QA-01`、`R2-E2E-01`、`R2-REL-03` 的首页 / 设置 / 任务 / 快照 / 模板 / AI organize 入口。
- `scripts/ai-organize-ui-validate.ts`
  - 回放 `R6-AI-01`、`R7-AI-01`、`R7-AI-05`、`R7-AI-06` 的 `assigning cancel`、`failed retry`、`error cancel`、`preview apply` 页面合同。
- `scripts/playwright-issue-regression-validate.ts`
  - 统一串联已有浏览器脚本与上述两条新入口，作为历史 issue 浏览器复验总入口。

## 3. 兼容性修正

- `scripts/extension-roundtrip-validate.ts`
  - 把 popup 未配置状态断言从旧文案 `请配置 Token` 对齐到当前 UI 文案 `待配置`。
  - 把 `save-all` 成功态断言从旧文案 `快照已保存` 对齐到当前 UI 文案 `已完成收藏和存档`。
- 执行前额外补装了 Playwright Chromium：
  - `npx playwright install chromium`

## 4. Clean Rerun

1. `npx playwright install chromium`
2. `npx tsx scripts/playwright-issue-regression-validate.ts`
3. `npx tsc --noEmit`
4. `npm test`
5. `npm run build`

## 5. 浏览器矩阵结果

- 总入口 `scripts/playwright-issue-regression-validate.ts` clean run 通过。
- 共顺序执行 `10` 条浏览器脚本，总耗时 `132589ms`。
- 覆盖范围：
  - `R1-QA-01`、`R2-E2E-01`、`R2-REL-03`
  - `R3-UI-01`
  - `R3-QA-03`、`R4-QA-02`
  - `R5-AI-08`
  - `R6-UI-02`
  - `R6-TPL-06`
  - `R6-AI-01`、`R7-AI-01`、`R7-AI-05`、`R7-AI-06`
  - `R2-EXT-02`
  - `R5-EXT-02`、`R6-EXT-04`、`R6-EXT-05`
  - `R5-EXT-03`

关键结果摘录：

- release journeys：
  - 首页活跃模板恢复为 `MCP Smoke 模板`
  - `/settings`、`/jobs`、`/snapshots` 均可见
  - `AI organize` idle 入口可见
- 分类导航：
  - 初始与刷新后都保持单行水平布局
  - 按钮滚动、滚轮横移、拖拽滚动全部成立
- 跨页面交互：
  - 分类排序、删除、移动、单条 / 批量书签移动、模板切换和刷新保持全部成立
- 设置页 AI 诊断：
  - 成功态与 `models_ok=true` 的诊断失败态均可见
- 模板长树弹窗：
  - 小视口下底部保存 / 取消按钮始终可达
- 预置模板：
  - `8` 套模板可见，copy/apply 后首页导航、分类管理与默认 classify 候选同步切换
- AI organize：
  - `assigning cancel` 后 plan/job 都进入 `canceled`
  - `failed retry` 后恢复到 `preview`
  - `error cancel` 后进入 `canceled`
  - 任务详情页 `preview apply` 后进入 `applied`
- 扩展：
  - popup-harness round-trip、真实 runtime、真实 action popup target 全部通过

## 6. 常规 Gate

- `npx tsc --noEmit`：通过
- `npm test`：`22/22` 文件、`188/188` 用例通过
- `npm run build`：通过

## 7. 结论

- 历史 issue 中有浏览器表面的主合同现在已经有统一的 Playwright 复验入口，不再散落在多份旧验收记录里。
- 这条矩阵是对历史 issue 的补充回放，不改变“仓库内 `e2e/` 仍是历史资产”的结论。
- 后续若改首页交互、模板弹窗、设置页 AI 诊断、AI organize modal / 任务页，或扩展 popup / runtime 行为，应先复跑 `npx tsx scripts/playwright-issue-regression-validate.ts`。
