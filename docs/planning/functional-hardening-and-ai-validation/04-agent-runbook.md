# bookmarks-manager Code Agent 执行手册

更新时间：2026-03-28

关联文档：

- [执行路线图](./02-roadmap.md)
- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 目的

本手册用于让 Code Agent 按统一协议执行当前规划包，重点保证三件事：

- 只做当前 issue，不越级、不抢跑。
- 每个 issue 都有验证、提交和风险回写。
- AI、备份 / 还原、扩展这些高风险模块不会在缺前置条件时被“假完成”。

## 2. 阶段门禁

- `G1` -> `R1`
  - `ai_simplify` 去留已明确。
  - 备份 / 还原合同已明确。
  - 扩展是否纳入 release gate 已明确。
- `R1` -> `R1.5`
  - 内置 Playwright MCP smoke checklist 可运行。
  - 设置 / 模板 / 快照 / 备份路径已进入自动化。
  - 快照与备份合同已写清。
- `R1.5` -> `R2`
  - AI mock / fixture 能离线回归。
  - organize 生命周期和模板快照行为具备测试。
  - H1 真实 AI 验收前置资料准备完毕。
- `R2` 完成
  - `build`、`test` 与内置 Playwright MCP smoke 全通过。
  - H1 AI 验收记录存在。
  - 未解决问题已进入 [风险台账](./06-risk-log.md)。

## 3. 执行级别

- `A0`
  - 仓库内可直接完成。
  - 不依赖 secrets、外部设备。
- `A1`
  - 需要本地临时环境、可访问的运行中服务、MCP UI 验证或外部网络可达性。
- `H1`
  - 需要人工提供 secrets、AI 凭证或真实模型配置。
- `H2`
  - 需要人工提供额外设备、浏览器实例或长期在线节点。
- `G1`
  - Gate 任务，不得自动跳过；若结论未明确，后续阶段一律不开始。

## 4. 自动执行规则

### 4.1 issue 编码执行模式

- 优先读取 [Agent 进度台账](./05-agent-status.md)。
- 自动选择第一个满足依赖且状态为 `todo` 的任务。
- 每次只处理 1 个主任务。
- 开始时写入 `started_at`。
- 完成时写入 `completed_at`。
- 阻塞时写入 `blocked_reason`，并把任务保持在当前行，不擅自跳过。
- 完成后必须留下 1 次独立 Git commit。
- 正常情况下，每笔 commit 只记录 1 个 issue 编号。
- 只有补录历史上已完成但未提交的连续任务时，才允许一次 commit 记录多个 issue 编号。

### 4.2 风险排查执行模式

- 优先读取 [风险台账](./06-risk-log.md)。
- 自动选择第一个 `fix_status = todo` 的风险项。
- 每次只处理 1 个风险项。
- 开始前将 `fix_status` 更新为 `in_progress`，并写入 `started_at`。
- 完成后必须更新 `risk_status`、`fix_status`、`fix_issue_id`、`git_commit`。
- 正常情况下，每笔 commit 只记录 1 个 `risk_id`。

## 5. 验证规则

- TypeScript、路由、服务逻辑变更后，默认运行：
  - `npm run build`
  - `npm test`
- 涉及 UI、页面交互、任务页、设置页、快照、模板时，额外使用内置 Playwright MCP 执行 smoke。
- 仓库内 `e2e/` 与 `playwright.config.ts` 不作为当前主验证路径，除非后续另立 issue 恢复其地位。
- 涉及 AI 相关 issue 时，必须区分两层验证：
  - 离线 mock / fixture 自动化。
  - H1 真实 provider 人工验收。
- 验证过程中产生的临时进程、临时端口、临时二进制、临时 `.env`、测试数据，任务结束前默认必须清理。
- 若某测试产物必须暂留，必须记录保留原因、位置和后续清理动作。

## 6. 安全与高风险操作规则

- `.env`、真实连接串、真实 token、cookie、私钥和其他敏感信息不得提交到 Git。
- 文档、示例配置与风险台账只能写占位值或脱敏信息，不能回写真实 secrets。
- 若任务涉及 AI 凭证，必须明确区分：
  - 人工提供。
  - 本地临时注入。
  - 不可提交、不可留档。
- 若任务涉及删库、删卷、还原备份、批量清理快照、开放公网端口、凭证轮换等高风险操作，必须先写明影响面、确认点、回滚方式和验收步骤。
- 若影响用户数据、线上可用性或安全边界且条件不明，Agent 必须先停下并请求人工确认。
- `R1-BE-03` 默认只能在临时数据库和临时快照目录中验证，不得直接对真实数据自动执行。

## 7. 文档回写规则

- 开始任务时写入 `started_at`。
- 完成任务时写入 `completed_at`。
- 遇到外部阻塞时写入 `blocked_reason`。
- 完成后为该 issue 补 1 次独立 Git commit；正常情况下每笔 commit 只记录 1 个 issue 编号。
- 若当前目录尚未初始化为 Git 仓库，先创建仓库再进入自动执行。
- 任务完成后若仍有残余风险，必须回写到 [风险台账](./06-risk-log.md)。
- 风险排查执行模式下，应写入 `fix_status`、`fix_issue_id`、`git_commit`。
- 文档漂移问题必须同步更新 README / 页面文案 / 规划文档，不允许只改代码不改文档接口。

## 8. 停止规则

- `G1` 结论未明确时停止，不进入后续阶段。
- 缺少 AI 凭证、外部网络、可访问的临时环境或必须的人工输入时停止，并在 `blocked_reason` 写清原因。
- 遇到高风险动作但影响面、确认点或回滚方式不清晰时停止。
- 发现与当前 issue 冲突的用户未提交更改时停止，并要求人工确认如何继续。
- 若出现与当前 issue 无关但会污染结论的全局失败，也应停止并先记录到 [风险台账](./06-risk-log.md)。

## 9. Agent 输入模板

- issue 编码执行模式模板

```text
请按 docs/planning/functional-hardening-and-ai-validation/05-agent-status.md 执行下一个 todo issue。
执行前先读取：
1. docs/planning/functional-hardening-and-ai-validation/03-issue-breakdown.md
2. docs/planning/functional-hardening-and-ai-validation/04-agent-runbook.md
3. docs/planning/functional-hardening-and-ai-validation/06-risk-log.md

要求：
- 只做一个 issue
- 开始/完成/阻塞都要回写状态台账
- 每个 issue 至少 1 次独立 commit
- 若发现残余风险，回写风险台账
- 测试完成后清理临时进程、端口、临时文件和测试数据
```

- 风险排查执行模式模板

```text
请切换到风险排查执行模式，读取 docs/planning/functional-hardening-and-ai-validation/06-risk-log.md，
只处理第一个 fix_status=todo 的风险项。

要求：
- 开始时写 started_at，并将 fix_status 改为 in_progress
- 只修 1 个 risk_id
- 完成后更新 risk_status / fix_status / fix_issue_id / git_commit
- 不要跳过 blocked 风险
- 不要提交任何真实 secrets 或临时凭证
```

## 10. 人工必须提供的输入清单

- `R15-H1-04` 所需的真实 AI `base_url`、`api_key`、`model`。
- 对 `ai_simplify` 的明确决策：下线遗留或另立 backlog。
- 对备份 / 还原合同的明确决策：完整恢复或显式部分恢复。
- 是否把 `extension-new/` 作为正式 release gate。
- 是否允许 Agent 直接用内置 Playwright MCP 对临时启动的本地服务做 UI 验证。
