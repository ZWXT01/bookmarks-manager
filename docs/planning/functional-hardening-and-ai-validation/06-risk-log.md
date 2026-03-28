# bookmarks-manager 风险点台账

更新时间：2026-03-28

关联文档：

- [执行路线图](./02-roadmap.md)
- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 执行手册](./04-agent-runbook.md)
- [Agent 进度台账](./05-agent-status.md)

## 1. 说明

- 本文件是风险点的唯一台账，也是“风险排查执行模式”的唯一状态源。
- 风险点不能只停留在一次性汇报里，后续执行必须持续回写本文件。
- 每条风险记录至少应包含：`issue_id`、日期、影响范围、触发条件或现象、当前缓解方式、后续排查建议。
- 除风险本身的生命周期状态外，还应记录修复执行状态、承接 issue 与 Git commit。
- 若风险已消除，应更新 `risk_status`，而不是直接删除历史记录。
- secrets 泄露、端口暴露、误删数据、权限扩大、异常进程和高风险误操作都应进入本台账。

`risk_status` 枚举：

- `open`
- `mitigated`
- `resolved`

`fix_status` 枚举：

- `todo`
- `in_progress`
- `blocked`
- `done`

## 2. 风险排查执行规则

- 优先读取本文件。
- 自动选择第一个 `fix_status = todo` 的风险项。
- 开始前写入 `started_at`，并将 `fix_status` 改为 `in_progress`。
- 完成后写入 `completed_at`，并更新 `risk_status` 与 `fix_status`。
- 若阻塞则写入 `blocked_reason`，并将 `fix_status` 改为 `blocked`。
- 完成提交后回写 `git_commit`。

## 3. 风险列表

| risk_id | date | issue_id | area | risk_status | fix_status | fix_issue_id | git_commit | started_at | completed_at | blocked_reason | risk | current_mitigation | follow_up |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `RISK-001` | 2026-03-28 | `R15-AI-01` | AI provider contract | open | todo |  |  |  |  |  | 真实 OpenAI 兼容模型可能不支持“联网浏览”或稳定 JSON 输出，导致 `classify` / `organize` 质量和回归结果不可重复。 | 当前只把 AI 当作增强能力，默认通过 `needs_review` 兜底；先走 mock / fixture 双轨。 | 在 `R15-H1-04` 用固定数据集做真实 provider 验收，记录模型、输入、输出和人工复核成本。 |
| `RISK-002` | 2026-03-28 | `R1-QA-01` | UI verification drift | open | todo |  |  |  |  |  | 仓库内 `e2e/` 仍然存在，但当前执行策略已切换为内置 Playwright MCP；若不明确主次，后续会出现两套 UI 验证标准并行漂移。 | `G1-QA-01` 已冻结内置 Playwright MCP 为唯一 UI gate 基线，仓库内 Playwright 只作为历史资产盘点。 | 在 `R1-QA-01` 中固定 MCP smoke checklist，并把仓库内 Playwright 明确标记为非 release gate 资产。 |
| `RISK-003` | 2026-03-28 | `R1-BE-03` | Backup / restore contract | open | todo |  |  |  |  |  | 当前备份生成的是整库文件，但还原实现只复制 `categories` 和 `bookmarks`，其余表和资产不在显式恢复范围内。 | `G1-QA-01` 已冻结本轮目标合同为“显式部分恢复”；当前仍将还原视为高风险路径，不纳入自动执行。 | 由 `R1-BE-03` 将代码、文档和临时副本演练对齐到显式部分恢复合同。 |
| `RISK-004` | 2026-03-28 | `R1-BE-03` | Snapshot storage | open | todo |  |  |  |  |  | `snapshots` 表在路由层懒初始化，HTML 快照文件在文件系统中，和数据库 schema / 备份逻辑分离。 | 目前仅把快照当作附属资产，不承诺灾备完整性。 | 将 schema 收口到统一初始化路径，并明确快照文件是否纳入备份。 |
| `RISK-005` | 2026-03-28 | `R1-DOC-04` | Docs and UI drift | open | todo |  |  |  |  |  | README 仍声明 `ai_simplify`、旧模块文件名和旧扩展目录；任务页仍保留 simplify 遗留变量，容易误导测试与验收。 | `G1-QA-01` 已冻结 `ai_simplify` 为历史遗留 / backlog，不纳入本轮 release gate；当前仍以代码而不是 README 作为事实来源。 | 在 `R1-DOC-04` 清理 README、页面文案和遗留变量，并把 backlog 身份写清。 |
| `RISK-006` | 2026-03-28 | `R15-AI-03` | AI settings drift | open | todo |  |  |  |  |  | 设置页存有 `ai_batch_size`，但 AI 路由默认使用请求体 `batch_size`，导致配置含义不一致。 | 临时把设置项视为非权威，不依赖它做验收。 | 决定“接入运行时”或“彻底移除”，并补测试证明。 |
| `RISK-007` | 2026-03-28 | `R1-API-02` | Coverage blind spots | open | todo |  |  |  |  |  | 模板、快照、备份、设置和 AI 路由仍存在明显自动化盲区，容易在重构中无声回归。 | 先用本规划包把盲区转成显式 issue 和风险。 | 按 `R1-API-02`、`R15-AI-02`、`R15-AI-03` 补齐自动化覆盖。 |
| `RISK-008` | 2026-03-28 | `R2-EXT-02` | Browser extension round-trip | open | todo |  |  |  |  |  | `extension-new/` 负责书签 / 快照保存，但当前缺少正式自动化或稳定 smoke 验收，扩展与服务端可能出现隐性契约漂移。 | `G1-QA-01` 已冻结 `extension-new/` 属于最终 `R2` release gate，但当前仍仅能依赖人工临时点测。 | 在 `R2-EXT-02` 建立临时环境 smoke 清单，验证 token、保存书签、保存快照、同时保存与失败提示。 |
