# 备份 / 还原与快照资产合同

更新时间：2026-03-28

关联文档：

- [执行路线图](./02-roadmap.md)
- [Issue 拆分](./03-issue-breakdown.md)
- [风险台账](./06-risk-log.md)

## 1. 当前合同

- 备份产物是 SQLite `.db` 文件。
- `/api/backups/restore` 当前只恢复 `categories` 与 `bookmarks`。
- `settings`、`api_tokens`、`jobs`、`job_failures`、`category_templates`、`template_snapshots`、`ai_organize_plans`、`plan_state_logs`、`snapshots` 表不会从备份覆盖回当前库。
- `data/snapshots/*.html` 快照文件不纳入当前备份文件，也不会在 restore 时被删除或从备份重建。

## 2. 快照边界

- `snapshots` schema 已收口到 `src/db.ts` 的统一初始化路径，不再在路由层懒创建。
- restore 过程中会删除并重建 `bookmarks`，因此已有 `snapshots.bookmark_id` 若引用被替换的书签，SQLite 会按外键规则把它置为 `NULL`。
- 这意味着当前合同只保证“快照元数据和 HTML 文件资产被保留”，不保证 restore 后仍自动保留原书签绑定关系。

## 3. Restore 流程

- 命名备份和上传备份都会先落到临时目录，再执行 `integrity_check` 与必需表/列校验。
- 校验通过后，系统会先创建一个 `pre_restore_*.db` 作为当前库的回滚点。
- 之后才会在事务内替换 `categories` 与 `bookmarks`。
- 若事务失败，会回滚数据库事务；`pre_restore_*.db` 会保留，供后续人工或同一路径 restore 回滚。

## 4. 验证方式

- `tests/integration/ops-routes.test.ts`
  - 覆盖命名备份、部分 restore、`pre_restore` 回滚路径、快照文件保留和设置表保留。
- 所有自动验证都只使用临时数据库、临时备份目录和临时快照目录，不触碰仓库内真实 `data/`。
