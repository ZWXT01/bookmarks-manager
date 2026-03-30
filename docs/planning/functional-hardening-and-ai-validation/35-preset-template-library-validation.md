# 预置模板库扩容与切换验收记录

更新时间：2026-03-30

## 1. 执行信息

- 执行 issue：`R6-TPL-06`
- 执行时间：`2026-03-30 23:18:30 +0800` 到 `2026-03-30 23:49:11 +0800`
- 代码范围：
  - `src/db.ts`
  - `public/app.js`
  - `views/index.ejs`
  - `tests/integration/ops-routes.test.ts`
  - `tests/integration/page-assets.test.ts`
  - `scripts/preset-template-validate.ts`

## 2. 收口目标

- 扩大内置预置模板覆盖面，降低用户必须从默认模板或空白模板手工搭树的成本。
- 让模板库里的预置模板不再只是“可预览参考”，而是可以直接创建自定义副本，或创建后立即应用到当前分类体系。
- 建立“模板库 -> 首页导航 / 分类管理 / AI 默认候选分类”同步切换的可复跑验收。

## 3. 实现摘要

- `src/db.ts` 现在把预置模板从 4 套扩到 8 套，新增：
  - `产品运营版`
  - `内容创作版`
  - `研究学习版`
  - `收藏归档版`
- `views/index.ejs` 的模板库卡片新增了稳定选择器，以及“创建副本 / 创建并应用”按钮。
- `public/app.js` 现在支持：
  - 基于预置模板直接生成自定义副本
  - 创建副本后立即应用
  - 自动生成不冲突的自定义模板名称
- `tests/integration/ops-routes.test.ts` 和 `tests/integration/page-assets.test.ts` 已补齐预置模板数量、名称和模板库壳体选择器回归。
- 新增 `scripts/preset-template-validate.ts`，在真实浏览器里验证：
  - 模板库预置模板列表
  - 基于预置模板创建自定义副本
  - 创建后应用模板
  - 直接创建并应用模板
  - 首页导航 / 分类管理同步切换
  - AI 单条 classify 默认候选分类跟随活动模板刷新

## 4. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npx vitest run tests/integration/ops-routes.test.ts tests/integration/page-assets.test.ts --reporter=verbose`
  - 通过，`2/2` 文件，`9/9` 用例
- `npx tsx scripts/preset-template-validate.ts`
  - 通过
  - 关键结果：
    - `presetNames` 包含 8 套预置模板
    - `产品运营版（自定义）` 创建并应用后，首页导航 / 分类管理切到 `市场洞察`、`内容运营`、`产品设计`、`商业化`、`项目协作`
    - `内容创作版（自定义）` 创建并应用后，首页导航 / 分类管理切到 `选题灵感`、`写作与脚本`、`视觉制作`、`发布运营`、`品牌资产`
    - 单条 classify 默认候选分类已随活动模板切换到对应模板树
- `npm test`
  - 通过，`22/22` 文件，`171/171` 用例
- `npm run build`
  - 通过

## 5. 结论

- 预置模板库现在已经覆盖更多实际场景，不再只有少量通用模板可选。
- 模板库里的预置模板已经从“只读参考”收口到“可直接落地使用”：用户可以直接创建自定义副本，或创建后立即应用。
- 首页分类导航、分类管理和 AI 默认候选分类现在已经和活动模板切换一起进入回归，不再需要靠手工点验确认是否同步。
