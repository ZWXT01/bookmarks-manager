# 输出文档契约

本 skill 的标准输出是六件套，除非用户明确要求简化，否则不要减少。

## 1. `01-reference-analysis.md`

用途：

- 收敛输入背景
- 对标参考项目
- 形成“借什么 / 不借什么 / 扩什么”的结论

必须包含：

1. 项目目标摘要
2. 已知约束
3. 参考项目清单
4. 对标结论矩阵
5. 可借鉴项
6. 不建议照搬项
7. 可新增项
8. 尚未确认项

## 2. `02-roadmap.md`

用途：

- 形成产品级路线图

必须包含：

1. 文档目标
2. 已确认前提
3. 当前问题或机会
4. 产品定位
5. 产品边界
6. 信息架构
7. 技术架构
8. 数据模型方向
9. API 范围
10. 阶段路线图
11. 验收标准
12. 风险控制

## 3. `03-issue-breakdown.md`

用途：

- 把 roadmap 变成 issue 级任务

每条 issue 必须包含：

- 标题
- 目标
- 范围
- 非目标
- 依赖
- 验收

必须包含：

- 命名规则
- 完成定义
- 推荐执行顺序或 wave
- 风险台账回写规则
- issue 级 Git 提交留痕规则
- 新增风险时应写入 `risk_status=open`、`fix_status=todo`
- 修复既有风险时应更新 `risk_status`、`fix_status`、`fix_issue_id`、`git_commit`

## 4. `04-agent-runbook.md`

用途：

- 让 Code Agent 可以按协议执行

必须包含：

1. 目的
2. 阶段门禁
3. 执行级别说明
4. 自动执行规则
5. 验证规则
6. 停止规则
7. 文档回写规则
8. Agent 输入模板
9. 人工必须提供的输入清单
10. issue 级提交留痕规则
11. 独立风险台账维护规则
12. issue 编码执行模式与风险排查执行模式的切换规则

## 5. `05-agent-status.md`

用途：

- 作为 Code Agent 的唯一进度台账

必须包含：

- 自动执行规则
- 任务有序队列
- `status`
- `started_at`
- `completed_at`
- `blocked_reason`
- 任务完成后需追加 issue 级 Git commit 的规则
- 该文件只用于 issue 编码执行模式，不作为风险排查执行队列

## 6. `06-risk-log.md`

用途：

- 作为独立风险台账，记录“任务完成但仍需持续跟踪”的风险

必须包含：

- 风险排查执行规则
- 风险记录说明
- `risk_status` 枚举
- `fix_status` 枚举
- 至少一张风险表
- 每条风险至少包含：
  - `issue_id`
  - `risk_status`
  - `fix_status`
  - `fix_issue_id`
  - `git_commit`
  - `started_at`
  - `completed_at`
  - `blocked_reason`
  - 日期
  - 影响范围
  - 触发条件或现象
  - 当前缓解方式
  - 后续排查建议

`risk_status` 默认枚举：

- `open`
- `mitigated`
- `resolved`

`fix_status` 默认枚举：

- `todo`
- `in_progress`
- `blocked`
- `done`

## 7. 输出质量规则

- 所有文件应互相链接
- 不要把 issue 拆成只有一句话的空任务
- 不要使用“后续优化”“按需调整”这种无法验收的描述
- 涉及 secrets、账号、设备时，必须在 runbook 和 status 中编码
- 若输出包含自动执行协议，默认也应包含独立风险台账
- 风险点不能只停留在一次性汇报里，应被编码进 `06-risk-log.md`
- issue 提交留痕规则不能只写在口头说明中，应体现在 issue-breakdown、runbook、status 三处
- 若 bundle 支持风险排查执行模式，runbook、status、risk-log 三者必须对“issue 模式 / 风险模式”的状态源保持一致
