# R5-EXT-03 真实 action popup 验收

更新时间：2026-03-29

## 1. 目标

- 证明扩展的真实 browser action popup target 可以在 Chromium 宿主中被打开和附着。
- 证明 popup 绑定的确实是“当前活动页”，而不是普通扩展页、后台页或直接打开的 `popup.html` 标签页。
- 和 `R5-EXT-02` 形成互补：前者覆盖真实 runtime 业务链，当前文档覆盖真实 action popup 目标绑定。

## 2. 执行方式

- 命令：`npx tsx scripts/extension-action-popup-validate.ts`

脚本行为：

- 以 `chromium.executablePath()` 启动临时 Chromium，并显式开启 remote debugging。
- 用 Playwright `connectOverCDP()` 建立页面控制，用 raw CDP WebSocket 建立 popup target 附着能力。
- 打开一个本地 fixture 页作为当前活动页。
- 从扩展页调用 `chrome.action.openPopup()`，打开真实 action popup target。
- 通过 raw CDP `Target.attachToTarget` + `Runtime.evaluate` 读取 popup 内的 `#title`、`#url` 与 `chrome.tabs.query()` 结果。

说明：

- 这里不模拟浏览器工具栏图标的物理点击手势。
- 但 `chrome.action.openPopup()` 打开的就是同一个 browser action popup target，因此可以验证 popup 对当前活动页的真实绑定合同。

## 3. 验收结果

- 真实 action popup target 成功打开。
- popup target 可被发现并附着。
- popup 内的 `#title` 与 `#url` 分别等于当前活动页的标题和 URL。
- popup 内部的 `chrome.tabs.query({ active: true, lastFocusedWindow: true })` 能看到当前活动页，且该 tab 为 `active=true`。

本次脚本输出摘要：

```json
{
  "issueId": "R5-EXT-03",
  "mode": "action-popup-runtime",
  "results": {
    "actionPopupOpened": true,
    "popupBoundToActiveTargetPage": true,
    "activeTabVisibleInsidePopup": true
  }
}
```

## 4. 结论

- 扩展的 popup 现在已经有三层验证：
  - `scripts/extension-roundtrip-validate.ts`：deterministic popup-harness
  - `scripts/extension-runtime-validate.ts`：真实 Chromium runtime 业务链
  - `scripts/extension-action-popup-validate.ts`：真实 action popup target 绑定
- 因此，扩展宿主层的主要合同盲区已收口，不再需要把“工具栏物理点击手势本身”视为 release gate 阻塞项。
