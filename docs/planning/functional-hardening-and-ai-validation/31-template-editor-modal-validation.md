# 模板编辑弹窗长树可达性验收记录

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)
- [最终回归与交接说明](./13-release-handoff.md)

## 1. 执行信息

- 执行 issue：`R6-UI-02`
- 执行时间：`2026-03-30 19:18:07 +0800` 到 `2026-03-30 19:25:06 +0800`
- 代码范围：
  - `views/index.ejs`
  - `public/app.js`
  - `tests/integration/page-assets.test.ts`
  - `tests/integration/ai-routes.test.ts`
  - `scripts/template-editor-validate.ts`
- 目标：修复自定义模板分类树持续增长时，模板编辑弹窗越拉越长、底部保存 / 取消按钮在小视口下不可达的问题，并建立可复跑 UI 验收。

## 2. 改动摘要

- 模板选择 / 编辑弹窗不再依赖静态 Tailwind 产物中不稳定的 `max-h-[80vh]` / `max-h-[85vh]` 任意值类名，而是改成显式 `max-height: calc(100vh - 2rem)`。
- 两个模板弹窗都收口为固定头尾 + 中间滚动区布局：
  - header 与 footer 固定在弹窗壳体内
  - 长树内容只滚动 body，不再把整个弹窗越撑越长
  - 外层 overlay 允许竖向滚动，避免低高度视口下整块被裁掉
- 为模板弹窗补了稳定选择器，便于页面壳体回归和真实浏览器脚本验证。
- clean rerun 过程中还暴露出 `tests/integration/ai-routes.test.ts` 默认 `10s` 超时过紧的问题；已把这组三个长用例的 timeout 放宽到 `30s`，防止干净全量回归时因负载波动出现伪失败。

## 3. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npx vitest run tests/integration/page-assets.test.ts --reporter=verbose`
  - 通过
  - `1/1` 文件、`5/5` 用例通过
  - 已验证首页输出包含模板弹窗稳定选择器、显式视口高度样式，且不再包含 `max-h-[80vh]` / `max-h-[85vh]`
- `npx tsx scripts/template-editor-validate.ts`
  - 通过
  - 以 `960x560` 视口打开模板选择 / 编辑弹窗
  - 以 `18` 个一级分类、`72` 个子分类构造长树模板
  - 滚到最底部后：
    - `template-edit-footer.bottom = 544`
    - `template-edit-save.bottom = 532`
    - `template-edit-cancel.bottom = 532`
    - 均仍在 `560` 高度视口内
  - 保存路径通过：模板名称成功更新为 `长树模板验收模板（已保存）`
  - 取消路径通过：未保存名称 `长树模板验收模板（未保存）` 未落库
- `npm test`
  - 通过
  - `21/21` 文件、`164/164` 用例通过
- `npm run build`
  - 通过

## 4. 结论

- 模板编辑弹窗当前已经具备明确的视口高度边界，不再出现“内容越多，弹窗越长，底部按钮越不可见”的隐性 UI 失败。
- 模板选择弹窗同步收口到了同一套壳体，避免同类问题在相邻入口复发。
- 这轮结果已经基于 interruption 后的 clean rerun 重算，不沿用中断前的半截测试输出。

## 5. 环境与清理

- 本次浏览器验收使用 headless Chrome 与 `createTestApp()` 临时环境，脚本结束后已清理临时目录与会话环境。
- 本次未修改用户原有的 `package.json`、`package-lock.json`、`src/index.ts`，以及未跟踪的 `e2e/`、`playwright.config.ts`、`workflow-skills/`。
