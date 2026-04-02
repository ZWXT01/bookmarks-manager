---
name: plan-product-from-references
description: Use when a user wants to turn a product idea, expected UX, expected effects, expected features, constraints, and reference repositories or documents into a concrete planning bundle before implementation. This skill analyzes references, decides what to borrow or avoid, chooses an appropriate planning horizon, scaffolds planning documents, and produces roadmap, issue-breakdown, agent-runbook, and status-tracker docs that a Code Agent can follow.
---

# Plan Product From References

## Overview

Use this skill before coding a new product, a major feature set, or a significant redesign.

This skill is for the stage where the user says things like:

- “我先不急着开发，先给我出一套可执行方案”
- “这些参考项目你先看一下，帮我整理能借鉴什么”
- “先做路线图、任务拆分和 Agent 执行文档”

This skill does not implement product features. It produces an execution bundle that other agents can use.

If the bundle is meant for Code Agent auto-execution, it must also encode:

- 独立风险台账规则
- issue 级 Git commit 留痕规则
- “正常情况单 issue 编号提交，历史补录才允许多 issue 编号”的限制
- issue 编码执行模式与风险排查执行模式的切换规则
- secrets 不可提交、示例文档不可写真实敏感值的规则
- 高风险 / 破坏性操作必须写清影响面、确认点、回滚方式和验收标准
- 测试完成后必须清理临时进程、临时端口、临时二进制和测试数据的规则

## Required Inputs

Collect or infer the following:

1. 产品形态
2. 预期效果
3. 预期功能
4. 约束条件
   - 技术栈
   - 部署形态
   - 用户类型
   - 权限模型
   - 是否单用户 / 多用户
5. 参考资料
   - GitHub 仓库
   - 文档
   - 截图
   - 设计稿
6. 非目标或延后目标

If critical information is missing, ask only blocking questions. Keep questions short and low-count.

## Output Location

Default output location:

- `docs/planning/<initiative-slug>/`

Unless the user gives another path, always create a new planning folder so the workflow does not mutate unrelated planning docs.

## Required Output Bundle

Always create these six files:

1. `01-reference-analysis.md`
2. `02-roadmap.md`
3. `03-issue-breakdown.md`
4. `04-agent-runbook.md`
5. `05-agent-status.md`
6. `06-risk-log.md`

Read [references/output-bundle.md](references/output-bundle.md) before writing.

## When To Read Additional References

- Always read [references/output-bundle.md](references/output-bundle.md)
- Read [references/planning-rules.md](references/planning-rules.md) when deciding:
  - 规划周期是短期还是中长期
  - 是否需要 `R1 ~ Rn` 分阶段
  - issue 粒度
  - Agent 执行级别和 gate 设计

## Workflow

### 1. Normalize the request

- 提炼用户的产品目标
- 提炼用户的约束和边界
- 区分“现在必须做”和“未来希望做”

If the user mixes multiple products or initiatives, split them before planning.

### 2. Review references

For each reference artifact, classify it into:

- `borrow`
- `avoid`
- `extend`
- `irrelevant`

Do not only summarize references. Convert them into planning signals:

- 信息架构是否值得借
- UI 是否值得借
- 后端边界是否值得借
- 风险边界是否需要避开

### 3. Choose planning horizon

Use `references/planning-rules.md`.

Default rules:

- 小功能：短期方案即可
- 中型产品：至少要有 `R1 / R1.5 / R2`
- 有明显集成风险、账号风控、外部设备、平台依赖时：必须加入 `Spike` 或 `Gate`

### 4. Scaffold the document bundle

Run:

```bash
python3 workflow-skills/plan-product-from-references/scripts/scaffold_planning_docs.py \
  --project-name "<项目名>" \
  --slug "<initiative-slug>" \
  --out "docs/planning/<initiative-slug>"
```

If the target folder already exists:

- update in place if the user is clearly iterating the same initiative
- otherwise create a new slugged folder

### 5. Fill the planning bundle

Populate files in this order:

1. `01-reference-analysis.md`
2. `02-roadmap.md`
3. `03-issue-breakdown.md`
4. `04-agent-runbook.md`
5. `05-agent-status.md`
6. `06-risk-log.md`

Required content rules:

- `01-reference-analysis.md`
  - 输入背景
  - 参考项目结论
  - 借鉴项 / 不借项 / 扩展项
  - 需要确认的问题
- `02-roadmap.md`
  - 产品边界
  - 信息架构
  - 模块边界
  - 数据模型方向
  - 分阶段路线图
  - 验收标准
- `03-issue-breakdown.md`
  - 按阶段拆 issue
  - 每条 issue 必须有：目标、范围、非目标、依赖、验收
  - 必须编码风险回写和 issue 级提交留痕规则
  - 若 issue 涉及 secrets、端口暴露、数据删除、重建或服务中断，必须写清安全约束、影响面、确认点与回滚方式
  - 若 issue 包含测试、排查或临时验证，必须写清测试收尾和临时产物清理要求
- `04-agent-runbook.md`
  - 让 Code Agent 能照着跑
  - 必须有执行级别、门禁规则、停止规则、验证规则
  - 必须有 issue 级提交留痕、独立风险台账维护规则，以及风险排查执行模式
  - 必须有“敏感信息不可提交”和“高风险操作谨慎执行”的显式规则
  - 必须要求验证完成后清理临时进程、端口和测试数据
- `05-agent-status.md`
  - 默认执行队列
  - `started_at`
  - `completed_at`
  - `blocked_reason`
  - 任务完成后的提交留痕规则
  - 明确只用于 issue 编码执行模式
- `06-risk-log.md`
  - 独立风险台账
  - 风险状态和记录格式
  - `risk_status` / `fix_status`
  - `fix_issue_id` / `git_commit`
  - 风险排查执行规则

### 6. Cross-link the documents

Make the documents navigable:

- roadmap 链接到 issue 和 runbook
- issue 链接到 runbook 和 status
- runbook 链接到 status
- issue / runbook / status 都应链接到 risk-log

### 7. Final handoff

The final response must tell the user:

1. 文档生成位置
2. 文档分别负责什么
3. 是否已经适合交给 Code Agent
4. 如果适合，应该怎么对 Agent 说

## Quality Bar

Do not accept vague planning language.

Bad:

- “后续优化 UI”
- “后端补一下接口”
- “再做一些搜索增强”

Good:

- 明确页面
- 明确接口
- 明确数据模型
- 明确依赖
- 明确验收方式

## Execution-Level Rules

When preparing `04-agent-runbook.md`, use these default execution levels unless the project needs additional ones:

- `A0`: 仓库内可直接实现
- `A1`: 需要环境或样例数据验证
- `H1`: 需要人工提供 secrets / 凭证 / 账号
- `H2`: 需要人工提供设备 / 外部系统
- `G1`: gate 任务，结论决定是否进入下一阶段

## Completion Checklist

Before finishing, verify:

- planning folder exists
- all six docs exist
- links are correct
- issue breakdown and status queue are aligned
- the first task in `05-agent-status.md` is actionable
- `06-risk-log.md` exists and is referenced by the execution docs
- security / risky-operation guardrails are present in the bundle
- the final response explains how to use the bundle with a Code Agent
