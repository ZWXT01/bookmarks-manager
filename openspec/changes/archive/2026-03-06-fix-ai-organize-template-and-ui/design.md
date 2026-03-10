## Context

书签管理器使用 Alpine.js + Tailwind CSS + EJS 服务端渲染架构，后端为 Fastify + better-sqlite3。AI 整理系统通过 Plan 状态机管理书签归类流程（`assigning` → `preview` → `applied`），每个 Plan 绑定创建时的 `template_id`。当前存在以下技术问题：

1. 整理计划的预览和应用 UI 位于主页弹窗（`views/index.ejs`），但用户更自然的操作路径是在任务详情页（`views/job.ejs`）查看和操作
2. `applyPlan()` 中空分类检测使用全局扫描（`src/ai-organize-plan.ts:423-428`），导致新模板下首次分类时误删大量空分类
3. 项目中 30+ 处使用浏览器原生 `confirm()`/`alert()`，破坏 UI 一致性
4. 预置模板种子数据含 `/` 字符（`UI/UX`、`JavaScript/TypeScript`、`CI/CD`），与路径分隔符冲突
5. 批量处理结果需等待全部完成才显示，无增量反馈

## Goals / Non-Goals

**Goals:**
- 将整理计划的预览/应用/冲突解决流程完整迁移至任务详情页
- 修正空分类检测为仅检查源分类
- 提供全局自定义弹窗组件替换所有原生对话框
- 通过 SSE 实现批次结果增量推送
- 修正模板系统的种子数据、未保存检查、重置功能和级联删除

**Non-Goals:**
- 不重构整体页面架构为 SPA
- 不修改 AI 分类的核心算法逻辑
- 不改变 Plan 状态机的状态流转规则
- 不添加模板版本控制或历史记录

## Decisions

### D1: 自定义弹窗组件实现方式

**选择**: 在 `public/app.js` 中实现全局 `AppDialog` 对象，提供 `AppDialog.confirm(message, options)` 和 `AppDialog.alert(message, options)` 两个 Promise-based 方法，复用 Alpine.js x-show 机制渲染弹窗 DOM。

**替代方案**:
- 方案 B: 每个 EJS 页面内联独立弹窗组件 → 代码重复，维护成本高
- 方案 C: 引入第三方弹窗库（如 SweetAlert2）→ 增加依赖，风格不统一

**理由**: 项目已有 Alpine.js 和 Tailwind CSS，无需引入新依赖。全局对象可在所有页面复用，API 与原生 `confirm()`/`alert()` 对齐（返回 Promise），替换时改动最小。弹窗 DOM 通过 JS 动态创建并挂载到 body，无需修改 EJS 模板结构。

### D2: 整理计划 UI 迁移策略

**选择**: 将 Diff 预览、应用、冲突解决 UI 完整移至 `views/job.ejs`，主页弹窗（`views/index.ejs`）仅保留任务发起和进度显示功能。任务完成后自动跳转到任务详情页。

**替代方案**:
- 方案 B: 在两处都保留应用 UI → 状态同步复杂，容易不一致

**理由**: 任务详情页已有 plan 数据和 assignments 展示，是查看和操作整理结果的自然位置。主页弹窗职责简化为"发起任务 + 查看进度"，职责更清晰。

### D3: 空分类检测逻辑修正

**选择**: 在 `applyPlan()` 和 `resolveAndApply()` 中，收集所有被移出书签的源分类 ID（排除 `category_id IS NULL` 即"未分类"），仅对这些源分类检查是否变空，替换当前的全局空叶子分类扫描。

**替代方案**:
- 方案 B: 保持全局扫描但排除新创建的分类 → 仍可能误删用户手动清空的分类

**理由**: 用户期望的行为是"书签从 A 移到 B 后，如果 A 变空则提示删除 A"，而非"扫描所有空分类"。仅检查源分类精确匹配用户预期。

### D4: SSE 增量推送批次结果

**选择**: 扩展现有 SSE 事件流（`/api/ai/organize/stream/:jobId`），新增 `batch_assignments` 事件类型，每批完成时推送该批的 assignments 数据。前端收到后追加到已有列表。

**替代方案**:
- 方案 B: 前端轮询 API 获取增量 → 延迟高，服务器负载大
- 方案 C: WebSocket → 项目未使用 WebSocket，引入成本高

**理由**: 项目已有 SSE 基础设施（EventSource），扩展事件类型成本最低。

### D5: 返回按钮动态导航

**选择**: 后端在渲染任务详情页时，通过 `Referer` header 判断来源页面，将 `backUrl` 传给 EJS 模板。若 Referer 包含 `/jobs` 则 `backUrl = '/jobs'`，否则 `backUrl = '/'`。

**替代方案**:
- 方案 B: 使用 query parameter `?from=jobs` → 需修改所有链接到任务详情的地方
- 方案 C: 使用 `history.back()` → 可能回退到非预期页面

**理由**: Referer 方案无需修改链接源，后端自动判断，前端只需使用传入的 `backUrl`。

### D6: 预置模板重置

**选择**: 新增 `POST /api/templates/:id/reset` 端点，仅限 preset 类型模板。独立实现重置逻辑（不复用 `applyTemplate()`）：在事务中清空所有分类 → 重建预置分类树 → 所有书签 `category_id` 设为 NULL → 删除该模板的旧 snapshot 数据。

**替代方案**:
- 方案 B: 给 `applyTemplate()` 增加 `skipRestore` 参数 → 侵入性修改，影响正常模板切换流程

**理由**: `applyTemplate()` 会调用 `restoreSnapshot()` 恢复书签分布，与"重置后所有书签变为未分类"的需求矛盾。独立实现逻辑清晰，不影响正常模板切换流程。

### D7: AJAX 分页统一

**选择**: 为 assignments 和 failures 表格新增 AJAX 分页 API 端点（`GET /api/ai/organize/:planId/assignments?page=N` 和 `GET /api/jobs/:jobId/failures?page=N`），前端使用 fetch + DOM 替换，与现有 suggestions 分页模式一致。

**理由**: 保持项目内分页实现的一致性，避免页面刷新打断用户操作。

### D8: SSE batch_assignments 数据 enrichment

**选择**: 后端在推送 `batch_assignments` 事件前，JOIN bookmarks 表获取 `title` 和 `url`，payload 直接包含完整数据 `[{bookmark_id, title, url, category_path, status}]`，前端无需额外请求。

**理由**: 每批数据量有限（10-30 条），后端 JOIN 开销可忽略；前端逻辑简化，避免批量查询的竞态问题。

### D9: SSE 流式推送期间的分页行为

**选择**: `assigning` 阶段（SSE 流式推送期间），assignments 列表仅显示实时追加的结果，分页控件禁用（隐藏）。流结束后（plan 进入 `preview` 状态），切换为标准 AJAX 分页模式。

**理由**: 流式推送期间数据持续变化，分页会导致数据跳动和用户困惑。禁用分页是最简洁的方案。

### D10: 模板删除级联策略

**选择**: 删除模板时，按 plan 状态分别处理：`assigning` 状态的 plan 先取消（cancel job）再删除；`preview` 及其他状态的 plan 直接删除。不再阻止删除操作。

**替代方案**:
- 方案 B: `assigning` 状态阻止删除 → 用户体验差，需等待任务完成

**理由**: 用户明确要删除模板时，应允许操作。`assigning` 状态需先取消以确保 job 正确终止。

## Risks / Trade-offs

- [Referer 不可靠] → 部分浏览器或隐私设置可能不发送 Referer header → 回退到默认 `backUrl = '/'`，功能降级但不影响使用
- [SSE 连接断开] → 批次结果推送中断 → 前端已有 polling fallback 机制，断开后自动切换到轮询
- [全局弹窗组件与 Alpine.js 作用域] → 弹窗组件在 Alpine.js 组件外部创建 → 使用独立 DOM 节点和原生 JS 事件，不依赖 Alpine.js 数据绑定
- [预置模板种子数据迁移] → 已有数据库中的旧数据不会自动更新 → `seedPresetTemplates()` 使用 `INSERT OR IGNORE`，仅影响新安装；需增加迁移逻辑更新已有记录中的 `/` 字符
- [模板级联删除] → 删除模板时级联删除关联 plans 和 jobs → 使用数据库事务确保原子性；`assigning` 状态的 plan 先取消 job 再删除，其他状态直接删除
