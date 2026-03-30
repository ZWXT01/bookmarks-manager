# 多待应用 organize plan apply 合同验收记录

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)
- [最终回归与交接说明](./13-release-handoff.md)

## 1. 执行信息

- 执行 issue：`R6-AI-01`
- 执行时间：`2026-03-30 16:33:43 +0800` 到 `2026-03-30 17:02:56 +0800`
- 代码范围：
  - `src/ai-organize-plan.ts`
  - `views/job.ejs`
  - `tests/integration/ai-organize-routes.test.ts`
- 目标：把多待应用 organize plan 的 apply 规则从“主要靠 stale 拒绝和源码隐式约束”收口为明确合同，并用干净重跑结果证明三类高风险场景都可解释、可回退、可复验。

## 2. 改动摘要

- 将 organize apply 的硬性 stale 校验与软冲突拆开：
  - 书签删除、模板漂移、目标分类失效继续 `409` 拒绝。
  - 同模板重叠 plan、书签分类漂移、预览后书签被编辑改为显式冲突项，由操作者在 `apply/resolve` 中做 `override` 或 `skip`。
- 同模板不重叠 plan 不再被“更新 plan 存在”误伤，可以直接 `apply`。
- 跨模板 plan 继续按模板快照隔离写入，不被活动模板覆盖。
- 任务详情页现在会展示冲突原因，包括：
  - 与更新 plan 重叠
  - 当前分类已变化
  - 预览后书签被编辑

## 3. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npx vitest run tests/integration/ai-organize-routes.test.ts --reporter=verbose`
  - 通过
  - `14/14` 用例通过
  - 已覆盖：
    - 同模板重叠 plan 进入显式冲突解决并允许 `override`
    - 同模板不重叠 plan 直接 `apply`
    - 跨模板 plan `apply / rollback` 隔离写入
    - 分类漂移冲突、目标分类失效、删除书签、cancel、retry、rollback guard rails
- `npx vitest run tests/integration/ai-routes.test.ts --reporter=verbose`
  - 通过
  - `4/4` 用例通过
  - 验证 AI 路由合同与 organize 相关默认入口未被本轮回归破坏
- `npm test`
  - 通过
  - `21/21` 文件、`163/163` 用例通过
- `npm run build`
  - 通过

## 4. 结论

- organize apply 现在的最终合同已经明确：
  - 同模板不重叠：直接 `apply`
  - 同模板重叠：进入显式冲突解决，需人工 `override` / `skip`
  - 跨模板：继续按模板快照隔离 `apply`
- 当前合同已经不再依赖“只允许最新 plan 应用”的隐式规则；操作者可以从 API 返回和任务详情页直接看见冲突对象及原因。
- 这轮回归采用了新的干净重跑结果，不再沿用此前被中断或上下文混杂的测试记录。

## 5. 环境与清理

- 本次验证未创建长期后台服务。
- 定向 Vitest、全量 `npm test` 和 `npm run build` 均在当前工作区 clean rerun 完成。
- 本次未修改用户原有的 `package.json`、`package-lock.json`、`src/index.ts` 及未跟踪的 `e2e/`、`playwright.config.ts`、`workflow-skills/`。
