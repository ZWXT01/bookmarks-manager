# 设置页 AI 诊断 UI 验收记录

更新时间：2026-03-30

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [AI provider 直连诊断验收记录](./27-ai-provider-diagnostic-validation.md)
- [最终回归与交接说明](./13-release-handoff.md)

## 1. 执行信息

- 执行 issue：`R5-AI-08`
- 执行时间：`2026-03-30 03:22:21 +0800` 到 `2026-03-30 03:25:03 +0800`
- 代码范围：
  - `views/settings.ejs`
  - `tests/integration/page-assets.test.ts`
  - `scripts/settings-ai-diagnostic-validate.ts`
- 目标：让设置页操作员在点击“测试连接”后，能直接看到 AI 测试成功态和带 `diagnostic` 的失败态，而不只依赖 toast 或 network 面板

## 2. 改动摘要

- 设置页 AI 配置区域新增了结果面板和稳定选择器，测试连接后会把成功态、普通失败态和诊断失败态直接渲染到页面。
- 当 `/api/ai/test` 返回 `diagnostic` 时，设置页会显示模型列表探测、当前模型发现状态和模型列表状态码等摘要。
- 新增 `scripts/settings-ai-diagnostic-validate.ts`，在真实浏览器里用两次受控 `/api/ai/test` 响应验证设置页 UI：
  - 第一次返回成功态
  - 第二次返回 `models_ok=true` 的 timeout 诊断态
- `tests/integration/page-assets.test.ts` 也新增了 settings 页的诊断壳与稳定选择器断言，防止页面结构回退。

## 3. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npm test -- tests/integration/page-assets.test.ts`
  - 通过
  - `1/1` 文件、`4/4` 用例通过
- `./node_modules/.bin/tsx scripts/settings-ai-diagnostic-validate.ts`
  - 通过
  - 浏览器 harness 输出：
    - 成功态：
      - `title = "AI 连接测试成功"`
      - `badge = "通过"`
      - `message = "AI 配置测试成功"`
    - 诊断失败态：
      - `title = "基础连通正常，聊天补全未通过"`
      - `badge = "需处理"`
      - `message = "AI 配置基础连通正常，但聊天补全接口超时"`
      - `detailLines = ["模型列表探测：正常", "当前模型：已发现", "模型列表状态码：200"]`
- `npm test`
  - 通过
  - `19/19` 文件，`154/154` 用例通过
- `npm run build`
  - 通过

## 4. 结论

- `R5-AI-07` 新增的 provider 诊断现在已经贯通到了设置页 UI，当前操作员可以在浏览器里直接区分“连接成功”和“基础连通正常但聊天补全超时”。
- 这条收口没有改变 `/api/ai/test` 的后端合同，但关闭了“诊断只存在于接口层、非开发者难以使用”的可见性缺口。
- `RISK-001` 仍然保留，因为 provider 的 chat completion timeout 依旧存在；但它现在已经从“故障不透明”进一步收敛到“故障透明且可见”。

## 5. 环境与清理

- 浏览器 harness 使用 `createTestApp()` 启动临时 Fastify 实例，并在 headless Chrome 中执行设置页验证。
- 脚本结束后已关闭浏览器、关闭应用并清理临时目录，未遗留额外测试服务或数据。
