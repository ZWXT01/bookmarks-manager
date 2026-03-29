# bookmarks-manager 分类跨页面交互验收

更新时间：2026-03-29

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 执行信息

- 执行 issue：`R3-QA-03`
- 执行时间：`2026-03-29 19:03:40 +0800` 起
- 验证入口：`npx tsx scripts/category-interaction-validate.ts`
- 验证环境：`createTestApp()` 启动的本地临时服务 + headless `google-chrome`

## 2. 收口内容

- 首页分类导航、分类管理弹窗和“添加书签”分类下拉统一受同一份 `categoryTree / categories` 前端状态驱动。
- 为交互验收新增了最小但稳定的 UI 选择器：
  - `data-testid="category-nav-tab"`
  - `data-testid="open-category-manager"`
  - `data-testid="add-bookmark-category-select"`
- 新增 `scripts/category-interaction-validate.ts`，真实驱动分类管理弹窗中的 Sortable 拖拽，不靠 API 直写替代 UI 行为。

## 3. 验证结果

脚本会自动完成：

- 登录首页，确认分类管理卡片顺序与首页导航顺序一致
- 在分类管理弹窗中把第一个一级分类拖到末尾
- 验证排序保存后，首页导航同步更新
- 验证“添加书签”分类下拉按新的一级分类顺序同步重排
- 刷新首页后，再次验证导航和下拉顺序保持一致

本次 clean run 输出：

```json
{
  "issueId": "R3-QA-03",
  "mode": "category-interaction-harness",
  "results": {
    "initialManagerOrder": ["工作", "学习", "生活", "娱乐"],
    "initialNavOrder": ["工作", "学习", "生活", "娱乐"],
    "reorderedManagerOrder": ["学习", "生活", "娱乐", "工作"],
    "reorderedNavOrder": ["学习", "生活", "娱乐", "工作"],
    "reorderedSelectOrder": [
      "学习",
      "学习/资料",
      "生活",
      "生活/清单",
      "娱乐",
      "娱乐/电影",
      "工作",
      "工作/项目"
    ],
    "reloadedNavOrder": ["学习", "生活", "娱乐", "工作"],
    "reloadedSelectOrder": [
      "学习",
      "学习/资料",
      "生活",
      "生活/清单",
      "娱乐",
      "娱乐/电影",
      "工作",
      "工作/项目"
    ]
  }
}
```

## 4. 结论

- 当前已经有一条可复跑的真实 UI interaction suite，证明“管理页拖拽排序 -> 首页导航同步 -> 表单下拉同步 -> 刷新后保持一致”这条合同成立。
- 后续若再调整分类导航、管理弹窗或任意依赖 `categories` 顺序的表单，必须先复跑 `scripts/category-interaction-validate.ts`。
