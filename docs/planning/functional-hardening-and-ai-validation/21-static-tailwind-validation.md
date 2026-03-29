# R5-UI-04 静态 Tailwind 迁移验收

更新时间：2026-03-29

## 1. 目标

- 关闭前端页面对运行时 `tailwind.js` 的直接依赖。
- 以受版本控制的静态样式产物替代运行时 `<script>` 注入。
- 补上页面资产合同回归，防止运行时 Tailwind 和 warning shim 回退。

## 2. 变更范围

- 新增 [scripts/generate-static-tailwind.ts](../../../scripts/generate-static-tailwind.ts)，从 `views/**/*.ejs`、`public/app.js`、`public/dialog.js` 提取 class，并通过本地 headless Chromium 生成 `public/tailwind.generated.css`。
- 新增 [public/tailwind.generated.css](../../../public/tailwind.generated.css) 作为受版本控制的静态样式产物。
- 将以下页面从运行时 `<script src="/public/lib/tailwind.js">` 切到静态 `<link rel="stylesheet" href="/public/tailwind.generated.css">`：
  - `views/index.ejs`
  - `views/login.ejs`
  - `views/job.ejs`
  - `views/jobs.ejs`
  - `views/settings.ejs`
  - `views/snapshots.ejs`
- 新增 [tests/integration/page-assets.test.ts](../../../tests/integration/page-assets.test.ts)，覆盖匿名 `/login` 与认证后的 `/`、`/settings`、`/jobs`、`/snapshots` 页面资产合同。

## 3. 验证结果

- `npx tsx scripts/generate-static-tailwind.ts`
  - 通过；成功生成 `public/tailwind.generated.css`，覆盖关键 utility，包括 `px-4`、`gap-2`、`rounded-lg`、`bg-white`、`max-w-screen-2xl`。
- `npx tsc --noEmit`
  - 通过。
- `npm test`
  - 通过，`17` 个测试文件、`146` 条测试。
- `npm run build`
  - 通过。
- `npx tsx scripts/category-interaction-validate.ts`
  - 通过；首页分类导航、管理页排序、删除 / 移动分类、单条 / 批量书签移动、模板切换与刷新保持链路未因静态样式替换退化。

## 4. 结论

- 页面运行时已经不再直接依赖 `tailwind.js`，`RISK-009` 可从 `mitigated` 收口到 `resolved`。
- `public/lib/tailwind.js` 当前只保留为生成脚本输入，不再作为页面运行时依赖。
- 后续若新增或修改页面 utility class，先复跑 `npx tsx scripts/generate-static-tailwind.ts`，再执行 `npm test` 与 `npx tsx scripts/category-interaction-validate.ts`。
