# 浏览器扩展 Round-Trip 验收记录

更新时间：2026-03-29

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [Playwright MCP 关键业务旅程验收](./11-playwright-mcp-release-journeys.md)

## 1. 执行信息

- 执行 issue：`R2-EXT-02`
- 执行时间：`2026-03-29 15:23:49 +0800` 到 `2026-03-29 16:06:16 +0800`
- 验证脚本：`scripts/extension-roundtrip-validate.ts`
- 验证工具：
  - Playwright + 本机 `google-chrome` headless
  - `createTestApp()` 启动的临时 Fastify + SQLite 环境
  - 临时静态服务器承载 `extension-new/popup.html`

## 2. 验收策略

- 当前机器上的稳定条件是“真实 Chrome headless 可启动，但不会把 unpacked extension target 暴露给自动化”；Playwright 自带 `chromium` 又未预装浏览器二进制。
- 因此本次采用 `popup-harness` 路径：
  - 直接加载仓库中的 `extension-new/popup.html`、`popup.js`、`popup.css`
  - 用最小 `chrome.storage` / `chrome.tabs` / `chrome.scripting` bridge 模拟扩展宿主接口
  - popup 到服务端 API、SQLite、快照文件目录的副作用全部走真实临时环境
- 这条路径覆盖了本 issue 真正关心的 contract：
  - Token 配置与连接校验
  - 保存书签
  - 保存快照
  - 收藏 + 存档
  - 失败提示
  - 清理临时数据

## 3. 本次修正

- [popup.js](/home/human/projects/bookmarks_manager/extension-new/popup.js)
  - 分类下拉现在使用 `category.id` 作为 `option.value`
  - 下拉文案改为 `fullPath || name`，避免二级分类重名歧义
  - 保存书签请求改为发送 `category_id`，修正此前 silently 丢分类的问题

## 4. 种子与场景

- 临时环境分类：
  - `扩展验收/收藏`
  - `扩展验收/同时保存`
- popup 验收场景使用 2 个逻辑 target URL：
  - `${baseUrl}/extension-fixture/bookmark`
  - `${baseUrl}/extension-fixture/save-all`
- 快照内容复用临时环境登录页 HTML，以保证快照正文是有效 HTML，同时避免 URL 去重冲突影响 `save-all` 验收。

## 5. 验收结果

| 步骤 | 断言 | 结果 |
|---|---|---|
| Token 配置 | 无 token 时弹出设置区；保存 `serverUrl + apiToken` 后连接状态变为 `已连接` | 通过 |
| 分类加载 | popup 拉到 `扩展验收/收藏`、`扩展验收/同时保存` 两个二级分类，且以下拉完整路径展示 | 通过 |
| 保存书签 | `POST /api/bookmarks` 成功；书签落库且 `category_id` 指向 `扩展验收/收藏` | 通过 |
| 保存快照 | `POST /api/snapshots` 成功；快照落库、HTML 文件写入磁盘、`bookmark_id` 回链到刚创建书签 | 通过 |
| 收藏 + 存档 | 同一按钮串行完成书签与快照保存；最终临时库中新增第 2 条书签和第 2 条快照 | 通过 |
| 失败提示 | 使用无效 token 时连接状态变为 `未连接`；点击保存显示 `未连接到服务器` | 通过 |
| 清理 | 脚本结束后临时 Fastify、临时静态服务器、Chrome 进程关闭；`/tmp/bookmarks-extension-roundtrip-*` 本次目录已删除 | 通过 |

## 6. 实跑结果

最后一次 clean run 输出：

```json
{
  "issueId": "R2-EXT-02",
  "mode": "popup-harness",
  "results": {
    "tokenConfigured": true,
    "bookmarkSaved": true,
    "snapshotSaved": true,
    "saveAllSaved": true,
    "failurePromptVerified": true,
    "bookmarkCount": 2,
    "snapshotCount": 2
  },
  "cleanup": {
    "tempRootCleaned": true
  }
}
```

## 7. 结论

- `R2-EXT-02` 已具备可复跑的扩展 round-trip 验收脚本，且真实服务端副作用已经闭环。
- 本次把“扩展 UI 与服务端 contract 漂移”从人工点测升级成了可复现 smoke。
- 当前残余边界是：本脚本验证的是 popup 资产 + 最小 `chrome.*` bridge，而不是浏览器工具栏里的真实 unpacked extension target。若未来需要把“真实 extension 宿主运行时”也纳入硬 gate，需要单独准备带可用 `chromium` browser bundle 或 headful/Xvfb 的执行机。
