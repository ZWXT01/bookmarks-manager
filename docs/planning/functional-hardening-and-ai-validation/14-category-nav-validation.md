# bookmarks-manager 分类导航 UI 回归验收

更新时间：2026-03-29

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [最终回归与交接说明](./13-release-handoff.md)

## 1. 执行信息

- 执行 issue：`R3-UI-01`
- 执行时间：`2026-03-29 17:09:40 +0800` 起
- 验证入口：`npx tsx scripts/category-nav-validate.ts`
- 验证环境：`createTestApp()` 启动的本地临时服务 + headless `google-chrome`

## 2. 根因与修复

- 首页分类导航原先把 `OverlayScrollbars` 直接初始化在 `.category-tabs` 这个单行 flex tab strip 上。
- 该滚动库会在运行时包裹宿主内容；分类按钮被搬进包装节点后，原始 `display: flex` 语义不再直接作用在 tab 项上，于是页面首次渲染后看似正常，但在脚本初始化完成后会退化成竖排。
- 本次修复改为：
  - 分类导航保留原生横向滚动，不再对 tab strip 使用 `OverlayScrollbars`
  - 保留左右滚动按钮
  - 新增鼠标滚轮横向滚动
  - 新增桌面端拖拽滚动，并在拖拽后抑制误点分类
  - 保留触屏设备的原生横向滑动

## 3. 验证结果

`scripts/category-nav-validate.ts` 会预置 `14` 个一级分类和对应子分类，然后自动验证：

- 初次登录后分类导航保持单行横排
- 分类数超过容器宽度时确实产生横向溢出
- 向右滚动按钮可移动导航
- 鼠标滚轮可横向滚动导航
- 拖拽手势可横向滚动导航
- 页面刷新后分类导航仍保持单行横排

本次 clean run 输出：

```json
{
  "issueId": "R3-UI-01",
  "mode": "category-nav-harness",
  "results": {
    "tabCount": 16,
    "rowCountInitial": 1,
    "rowCountAfterReload": 1,
    "overflowDetected": true,
    "buttonScrollWorked": true,
    "wheelScrollWorked": true,
    "dragScrollWorked": true
  }
}
```

## 4. 结论

- 当前已复现并修复“首页分类导航刷新后由横排退化为竖排”的核心回归。
- 分类较多时，用户现在至少可通过按钮、滚轮、拖拽或触屏横滑访问全部分类，不再只能看到部分分类。
- 后续若再改分类导航结构，必须先复跑 `scripts/category-nav-validate.ts`，避免重新引入 hydration / layout 漂移。
