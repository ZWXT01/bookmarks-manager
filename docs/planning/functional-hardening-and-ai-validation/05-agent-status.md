# bookmarks-manager Agent 进度台账

更新时间：2026-03-28

关联文档：

- [执行路线图](./02-roadmap.md)
- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 执行手册](./04-agent-runbook.md)
- [风险台账](./06-risk-log.md)

## 1. 自动执行规则

- 本文件只用于 issue 编码执行模式。
- 风险排查执行模式应改为优先读取 [风险台账](./06-risk-log.md)。
- Agent 必须优先读取本文件。
- Agent 必须选择第一个依赖已满足且 `status=todo` 的任务。
- 开始前写入 `started_at`。
- 完成后写入 `completed_at`。
- 阻塞时写入 `blocked_reason`。
- 每个任务完成后，必须额外留下 1 次独立 Git commit。
- 若当前目录还不是 Git 仓库，则必须先初始化仓库。

## 2. 任务队列

| order | stage | issue_id | title | exec_level | depends_on | status | started_at | completed_at | blocked_reason |
|---:|---|---|---|---|---|---|---|---|---|
| 10 | G1 | `G1-QA-01` | 基线与验收矩阵冻结 | `G1` |  | done | 2026-03-28 15:14:47 +0800 | 2026-03-28 15:22:19 +0800 |  |
| 20 | R1 | `R1-QA-01` | 建立内置 Playwright MCP UI 验证基线 | `A1` | `G1-QA-01` | todo |  |  |  |
| 30 | R1 | `R1-API-02` | 补齐设置 / 模板 / 快照 / 备份 API 自动化覆盖 | `A0` | `G1-QA-01` | todo |  |  |  |
| 40 | R1 | `R1-BE-03` | 修正备份 / 还原与快照资产合同 | `G1` | `G1-QA-01` | todo |  |  |  |
| 50 | R1 | `R1-DOC-04` | 清理 README / 页面遗留功能漂移 | `A0` | `G1-QA-01` | todo |  |  |  |
| 60 | R1.5 | `R15-AI-01` | 建立 AI mock / fixture 与 deterministic harness | `A0` | `R1-API-02,R1-BE-03` | todo |  |  |  |
| 70 | R1.5 | `R15-AI-02` | 覆盖 AI classify / test / classify-batch HTTP 合同 | `A0` | `R15-AI-01` | todo |  |  |  |
| 80 | R1.5 | `R15-AI-03` | 覆盖 organize 生命周期与配置漂移 | `A0` | `R15-AI-01,R1-BE-03` | todo |  |  |  |
| 90 | R1.5 | `R15-H1-04` | 真实 AI 提供方联调与人工验收 | `H1` | `R15-AI-02,R15-AI-03` | todo |  |  |  |
| 100 | R2 | `R2-E2E-01` | 补齐 Playwright MCP 关键业务旅程 | `A1` | `R1-QA-01,R1-API-02,R15-AI-02,R15-AI-03` | todo |  |  |  |
| 110 | R2 | `R2-EXT-02` | 浏览器扩展与快照 round-trip 验收 | `A1` | `R2-E2E-01,R15-H1-04` | todo |  |  |  |
| 120 | R2 | `R2-REL-03` | 最终回归、发布说明与交接 | `A0` | `R2-E2E-01,R2-EXT-02,R15-H1-04,R1-DOC-04` | todo |  |  |  |
