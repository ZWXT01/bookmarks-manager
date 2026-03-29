# bookmarks-manager Playwright MCP 关键业务旅程验收

更新时间：2026-03-29

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [Playwright MCP Smoke 基线](./08-playwright-mcp-smoke-baseline.md)

## 1. 执行信息

- 执行 issue：`R2-E2E-01`
- 执行时间：`2026-03-29 14:33:28 +0800` 到 `2026-03-29 15:00:41 +0800`
- 验证工具：内置 Playwright MCP
- 验证环境：本地临时服务，由 `scripts/playwright-mcp-smoke-env.ts` 启动到随机 `127.0.0.1` 端口
- 登录凭证：`createTestApp()` 默认测试账号 `test-admin` / `test-password`
- API Token：`test-api-token`
- AI 条件：使用 deterministic mock harness，不依赖真实 provider

## 2. 临时环境与种子数据

- `scripts/playwright-mcp-smoke-env.ts` 复用 `tests/helpers/app.ts`，启动临时 SQLite、快照目录和 Fastify 服务。
- 脚本预置 2 个模板：
  - `MCP Smoke 模板`
  - `MCP 备用模板`
- 脚本预置 3 条书签、1 条快照、1 条已完成历史 import job。
- AI harness 队列固定为 2 次调用：
  - `/api/ai/test` 返回文本 `OK`
  - `/api/ai/organize` 返回 3 条确定性的分类建议
- 脚本内置 `SIGINT` / `SIGTERM` 清理逻辑；本次执行结束后额外做了进程与目录复核，确认临时服务已停止且 `/tmp/bookmarks-mcp-smoke-*` 本次目录已删除。

## 3. 关键旅程结果

| 步骤 | 路径 / 操作 | 断言 | 结果 |
|---|---|---|---|
| 登录 | `/login -> /` | 登录页可访问，提交后进入首页 | 通过 |
| 首页模板 | `/` | 初始占位后约 1 秒内恢复为 `MCP Smoke 模板` | 通过 |
| 搜索 | 首页搜索 `本地任务页` | 结果收敛到 1 条；分类 tab 过滤可继续生效 | 通过 |
| 分类新增 | 首页 `添加分类` | 新增 `MCP 新分类` 后，分类导航出现新 tab | 通过 |
| 书签新增 | 首页 `添加书签` | 新增 `MCP 新书签`，分类为 `MCP 新分类` | 通过 |
| 设置与 AI test | `/settings` | 读取 mock AI 设置并通过 `测试连接` | 通过 |
| 备份 | 首页 `备份还原 -> 立即备份` | 生成新的 `manual_*.db` 备份条目 | 通过 |
| 快照页 | `/snapshots` | 预置快照 `登录页快照` 可见并可搜索 | 通过 |
| 批量检查与任务页 | 首页 `批量检查`，再到 `/jobs` | SSE / 轮询能走到 `检查完成`；任务列表看到最新 check job 和历史 import job | 通过 |
| 模板弹窗 | 首页 `切换模板` | `MCP Smoke 模板` 与 `MCP 备用模板` 均可见 | 通过 |
| AI 整理 UI | 首页 `AI 整理` | mock organize 预览完成，显示 `分类完成` 与 `查看任务详情` | 通过 |
| AI 任务详情 | `/jobs/:id` | 整理任务展示 `3 / 3` 分配、目标模板和建议明细 | 通过 |

## 4. 控制台与交互稳定性

- 修正首页第三方静态资源引用后，关键页面 `warning` / `error` 级别控制台消息为 `0`。
- 已不再出现：
  - `OverlayScrollbars` CSS / JS SRI 阻断
  - `favicon.ico` 404
- 仍会看到非 gate 级噪音：
  - 首页 `loadCategories` 的 info 级 aborted log
  - 浏览器对密码输入框 autocomplete / form 结构的提示
- MCP 在本项目里对部分 Alpine 弹窗按钮的普通 click 稳定性一般；本次对 `测试连接`、`备份还原`、`批量检查`、`AI 整理` 采用浏览器内 `element.click()` 方式触发，结果稳定。

## 5. 留痕与失败处理策略

- 成功路径只保留：
  - 临时环境 JSON 元数据
  - 路径 / 标题 / 关键断言摘要
  - 控制台 `warning` / `error` 计数摘要
- 失败路径统一保留：
  - 1 份 Playwright accessibility snapshot
  - 1 张截图
  - 对应控制台摘要
  - 失败步骤、目标路径和断言说明
- 失败产物建议落到 `/tmp/playwright-mcp-output/r2-e2e-01-*`；任务结束后删除本次会话目录。

## 6. 结论

- `R2-E2E-01` 的 release-gate 范围已经覆盖到书签、分类、搜索、设置、任务 / SSE、模板、快照、备份以及 mock AI UI / API 联动主路径。
- 本次执行未依赖仓库内 `e2e/` 或 `playwright.config.ts`，仍维持“内置 Playwright MCP 是唯一 UI gate”的基线。
- 当前未见阻断 `R2-EXT-02` 的前端控制台错误；下一步可以继续做浏览器扩展 round-trip 验收。
