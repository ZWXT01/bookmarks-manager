# R5-EXT-02 真实扩展运行时验收

更新时间：2026-03-29

## 1. 目标

- 将扩展验收从 `popup-harness` 升级为 Playwright Chromium 中加载的真实 unpacked extension runtime。
- 保留真实 `chrome.storage`、`chrome.tabs.query`、`chrome.tabs.create`、`chrome.scripting.executeScript`、`chrome.tabs.sendMessage`、content script 与服务端 API 联动。
- 明确 headless 环境下的自动化边界，避免把“真实 runtime”与“点击浏览器工具栏图标”混为一谈。

## 2. 执行方式

- 前置：`npx playwright install chromium`
- 命令：`npx tsx scripts/extension-runtime-validate.ts`

脚本行为：

- 启动临时 Fastify + SQLite 环境。
- 启动临时 fixture 页面服务，提供 `/bookmark` 与 `/save-all` 两个目标页。
- 以 `chromium.launchPersistentContext()` 加载 `extension-new/`。
- 从 `chrome://extensions/` 解析临时 profile 下的 extension id。
- 直接打开 `chrome-extension://<id>/popup.html`，并通过最小 `targetUrl/targetTitle` hint 把 popup 绑定到目标页。

说明：

- 之所以需要最小 hint，是因为 headless 自动化无法稳定复现“点击浏览器工具栏 action 图标打开 popup”这个浏览器 UI 手势。
- 该 hint 只负责告诉 popup 当前要绑定哪一个目标页；真正执行书签保存、快照抓取、tab 查询、content script 消息和新标签打开时，仍然走真实 `chrome.*` API。

## 3. 验收结果

- 真实 runtime 加载成功。
- popup 能读取目标页标题 / URL，并正确填入表单。
- Token 配置后可连接临时服务并加载分类。
- `收藏` 成功，数据库中落下正确 `category_id`。
- `存档` 成功，快照文件存在，且文件内容包含目标页 marker，证明抓取的是目标页而不是 popup 页面。
- `收藏+存档` 成功，数据库与快照文件均有对应副作用。
- `管理页面`、`获取 Token` 两个入口均通过真实 `chrome.tabs.create()` 打开站内标签；未登录时允许被站点鉴权重定向到 `/login`。
- 将 token 改为无效值后，连接状态变为 `未连接`，再次点击收藏会给出失败提示。

本次脚本输出摘要：

```json
{
  "issueId": "R5-EXT-02",
  "mode": "real-extension-runtime",
  "results": {
    "runtimeLoaded": true,
    "popupBoundToTargetPage": true,
    "managerLinkOpened": true,
    "settingsLinkOpened": true,
    "bookmarkSaved": true,
    "snapshotSaved": true,
    "saveAllSaved": true,
    "failurePromptVerified": true
  }
}
```

## 4. 清理

- 临时 Chromium profile 位于 `/tmp/bookmarks-extension-runtime-*`，脚本结束后已删除。
- 临时应用数据目录位于 `/tmp/bookmarks-extension-runtime-*`，脚本结束后已删除。
- 未遗留后台浏览器进程、临时 DB 或临时快照目录。
