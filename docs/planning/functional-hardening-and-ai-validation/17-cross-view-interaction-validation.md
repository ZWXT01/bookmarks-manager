# bookmarks-manager 扩展跨页面交互验收

更新时间：2026-03-29

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 执行信息

- 执行 issue：`R4-QA-02`
- 执行时间：`2026-03-29 19:40:27 +0800` 起
- 验证入口：`npx tsx scripts/category-interaction-validate.ts`
- 验证环境：`createTestApp()` 启动的本地临时服务 + headless `google-chrome`

## 2. 收口内容

- 在原有“分类排序同步”基础上，把同一套浏览器 harness 扩展到了更高风险的跨页面链路：
  - 删除一级分类后，首页导航、分类下拉、当前筛选和书签列表同步收口
  - 通过现有 API 移动子分类后，首页子分类下拉和表单分类下拉同步更新
  - 单条书签移动、批量书签移动后的列表筛选结果与分类标签同步更新
  - 自定义模板切换后，当前模板、首页导航、分类下拉和书签归属同步更新，刷新后保持一致
- 验收过程中发现并修复了一个额外前端缺陷：
  - `deleteCategory()` 原本会先按旧 `currentCategory` 刷新书签，再把筛选置空，导致“导航已回到全部，但列表仍停留旧筛选结果”
  - 现在统一由 `loadCategories()` 内的 `normalizeCategoryUiState()` 收口失效的 `currentCategory`、展开父分类和已选分类，模板切换也一并受益
- 为了让 destructive flow 稳定可驱动，补了可复用选择器：
  - `public/dialog.js`：`app-dialog` / `app-dialog-confirm`
  - `views/index.ejs`：书签行、移动弹窗、模板切换、分类删除、子分类导航等 `data-testid`

## 3. 验证结果

脚本会自动完成：

- 登录并确认初始分类管理顺序与首页导航一致
- 在分类管理弹窗中拖拽一级分类排序
- 删除当前筛选中的一级分类，验证导航、下拉、当前筛选和书签归属同步更新
- 移动子分类到新的一级分类下，验证子分类导航和“添加书签”下拉同步更新
- 执行单条书签移动，验证源分类筛选即时清空、目标分类筛选即时出现
- 执行批量书签移动，验证列表标签和分类筛选即时更新
- 切换到另一套自定义模板，验证当前模板、导航、下拉和书签归属同步切换，并在刷新后保持一致

本次 clean run 输出：

```json
{
  "issueId": "R4-QA-02",
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
    "deletedCategory": {
      "navOrder": ["学习", "生活", "工作"],
      "selectOrder": ["学习", "学习/资料", "生活", "生活/清单", "工作", "工作/项目"],
      "allTabSelected": true,
      "visibleTitlesAfterReset": ["采购清单", "电影推荐", "React 教程", "Spec 文档"],
      "bookmarkCategories": {
        "电影推荐": "未分类",
        "采购清单": "生活/清单",
        "React 教程": "学习/资料",
        "Spec 文档": "工作/项目"
      }
    },
    "movedCategory": {
      "workSubcategories": ["项目", "资料"],
      "selectOrder": ["学习", "生活", "生活/清单", "工作", "工作/项目", "工作/资料"]
    },
    "singleMove": {
      "emptySourceTitles": [],
      "targetTitles": ["采购清单", "Spec 文档"],
      "bookmarkCategories": {
        "采购清单": "生活/清单",
        "Spec 文档": "生活/清单"
      }
    },
    "batchMove": {
      "projectTitles": ["采购清单", "React 教程"],
      "bookmarkCategories": {
        "电影推荐": "未分类",
        "采购清单": "工作/项目",
        "React 教程": "工作/项目",
        "Spec 文档": "生活/清单"
      }
    },
    "templateSwitch": {
      "activeTemplate": "交互回归模板 B",
      "navOrder": ["归档", "资源", "生活"],
      "selectOrder": ["归档", "归档/已处理", "资源", "资源/学习", "生活", "生活/采购"],
      "bookmarkCategories": {
        "电影推荐": "归档/已处理",
        "采购清单": "生活/采购",
        "React 教程": "资源/学习",
        "Spec 文档": "资源/学习"
      },
      "resourceTitles": ["React 教程", "Spec 文档"],
      "reloadedTemplate": "交互回归模板 B",
      "reloadedNavOrder": ["归档", "资源", "生活"],
      "reloadedBookmarkCategories": {
        "电影推荐": "归档/已处理",
        "采购清单": "生活/采购",
        "React 教程": "资源/学习",
        "Spec 文档": "资源/学习"
      }
    }
  }
}
```

## 4. 结论

- 当前跨页面交互 gate 已从“只覆盖排序同步”扩展到“删除分类 / 移动分类 / 书签移动 / 模板切换”这一组更容易误导用户和造成错误操作的链路。
- 这轮不仅补了验证，还修掉了 `currentCategory` 等前端状态在分类树重建后的失效时序问题；同类逻辑以后应统一走 `normalizeCategoryUiState()`。
- 后续若继续改首页分类导航、模板切换、分类删除或书签移动链路，必须先复跑 `scripts/category-interaction-validate.ts`。
