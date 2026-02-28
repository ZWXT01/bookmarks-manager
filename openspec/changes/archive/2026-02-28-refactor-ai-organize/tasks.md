## 1. 数据库与基础设施

- [x] 1.1 创建 `ai_organize_plans` 表（id, job_id, status, scope, target_tree, assignments, diff_summary, backup_snapshot, phase, batches_done, batches_total, failed_batch_ids, needs_review_count, created_at, applied_at）
- [x] 1.2 确保 `bookmarks` 表有 `updated_at` 字段（冲突检测依赖），无则迁移添加
- [x] 1.3 删除旧建议表：`ai_classification_suggestions`、`ai_simplify_suggestions`、`ai_level_simplify_suggestions`

## 2. Plan 管理模块 (`src/ai-organize-plan.ts`)

- [x] 2.1 实现 Plan CRUD：createPlan（含单活跃 Plan 检查 + Plan 清理策略：保留最近 5 个）、getPlan、updatePlan、deletePlan
- [x] 2.2 实现 Plan 状态机：designing → assigning → preview → applied / canceled / rolled_back / failed / error。终态操作为 no-op，failed 支持 retry→assigning
- [x] 2.3 实现目标分类树编辑：updatePlanTree（验证：2 级层级、一级 3-20 个、总数 ≤ 200、同级名称唯一 case-insensitive、名称 ≤ 50 字符 auto-trim）
- [x] 2.4 实现 Diff 计算：computeDiff（三层粒度：分类级汇总 + 书签钻取 + 空分类标记）
- [x] 2.5 实现备份快照：createBackupSnapshot（序列化 categories + bookmarks.category_id 映射）
- [x] 2.6 实现原子应用：applyPlan（单事务：备份 → 冲突检测(updated_at > plan.created_at) → 智能复用现有分类(casefold name match) → 创建新分类 → 移动书签 → 返回冲突列表和空分类列表供用户决策）
- [x] 2.7 实现回滚：rollbackPlan（24h 窗口检查，从 backup_snapshot 恢复，超时返回 403）
- [x] 2.8 实现 24h 快照清理：applied_at + 24h 后清空 backup_snapshot 字段

## 3. AI 整理引擎 (`src/ai-organize.ts`)

- [x] 3.1 实现本地特征提取：extractFeatures（域名 TOP 200、关键词 TOP 100、现有分类列表）
- [x] 3.2 实现 AI 分类树设计：designCategoryTree（特征摘要 + 现有分类列表 → AI → 分类树 JSON，校验数量约束）
- [x] 3.3 实现批量归类：assignBookmarks（scope 解析、分批 50 条、发送 url/title/current_category、可配置重试参数：默认 60s 超时/2 次重试/连续 5 批失败→failed、跳过失败批次继续、未归类标记 needs_review、更新 Plan 进度字段）
- [x] 3.4 实现 AI 输出校验：validateAssignment（拒绝不在目标树中的分类路径，标记为 needs_review）

## 4. API 路由 (`src/routes/ai.ts`)

- [x] 4.1 重写 `POST /api/ai/organize`：启动整理（scope 参数：all/uncategorized/category:<id>，可选重试配置参数）
- [x] 4.2 实现 `GET /api/ai/organize/:planId`：获取 Plan 详情 + 进度（phase/batches_done/batches_total）+ Diff 预览
- [x] 4.3 实现 `PUT /api/ai/organize/:planId/tree`：编辑分类树（含校验）+ confirm 锁定
- [x] 4.4 实现 `POST /api/ai/organize/:planId/apply`：原子应用（返回冲突列表 + 空分类列表）
- [x] 4.5 实现 `POST /api/ai/organize/:planId/apply/resolve`：用户提交冲突决策（覆盖/跳过）+ 空分类决策（删除/保留）后执行最终 apply
- [x] 4.6 实现 `POST /api/ai/organize/:planId/rollback`：回滚（24h 窗口校验）
- [x] 4.7 实现 `POST /api/ai/organize/:planId/cancel`：取消（任意非终态 → canceled）
- [x] 4.8 实现 `POST /api/ai/organize/:planId/retry`：从 failed 恢复到 assigning
- [x] 4.9 保留 `POST /api/ai/classify`（单个书签分类）和 `POST /api/ai/test`（AI 配置测试），删除其余旧路由

## 5. 前端 UI

- [x] 5.1 移除旧 AI UI：删除 `app.js` 和 `index.ejs` 中的 AI 分类/精简相关 modal、按钮、交互逻辑
- [x] 5.2 实现整理入口：添加"AI 整理"按钮，弹出整理向导（选择 scope：全部/未分类/指定分类）
- [x] 5.3 实现分类树编辑器：展示 AI 生成的分类树草案，支持增删改节点（含校验反馈），确认锁定
- [x] 5.4 实现归类进度展示：进度条（batches_done/batches_total）+ phase 状态 + 失败批次提示
- [x] 5.5 实现 Diff 预览界面：分类级汇总 + 点击钻取书签列表 + 手动修改单书签归类 + 待审核书签列表 + 空分类勾选删除
- [x] 5.6 实现冲突解决界面：列出冲突书签，用户逐个选择覆盖/跳过
- [x] 5.7 实现回滚控件：应用后 24h 内显示回滚按钮，超时隐藏
- [x] 5.8 实现 failed 状态处理：显示失败原因 + 重试/取消按钮

## 6. 清理

- [x] 6.1 删除旧文件：`src/ai-classifier.ts`、`src/ai-classify-job.ts`、`src/ai-classify-level.ts`、`src/ai-simplify-job.ts`、`src/ai-simplify-level.ts`
- [x] 6.2 清理 `src/index.ts` 中对旧 AI 模块的 import 引用（如有）
- [x] 6.3 端到端验证：启动整理 → AI 设计分类树 → 手动微调 → 批量归类 → Diff 预览 → 冲突解决 → 应用 → 回滚
