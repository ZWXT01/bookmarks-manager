# bookmarks-manager Issue 级任务拆分

更新时间：2026-03-28

配套文档：

- [执行路线图](./02-roadmap.md)
- [Agent 执行手册](./04-agent-runbook.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 使用说明

- 本文件把路线图拆成可单独执行和验收的 issue。
- Agent 进入 issue 编码执行模式时，应先读 [Agent 进度台账](./05-agent-status.md)，只做第一个依赖已满足且 `status=todo` 的任务。
- 发现新的残余风险、环境限制或行为歧义时，必须同步回写 [风险台账](./06-risk-log.md)。

## 2. issue 命名规则

- 命名格式：`<阶段>-<域>-<序号>`。
- 阶段枚举：`G1`、`R1`、`R15`、`R2`。
- 域枚举建议：`QA`、`API`、`BE`、`DOC`、`AI`、`E2E`、`EXT`、`REL`、`H1`。
- 示例：`R15-AI-03`、`R1-BE-03`。

## 3. 完成定义

- 每完成一个 issue 至少产生 1 次独立 Git commit。
- 正常情况下，每笔 commit 只记录 1 个 issue 编号；只有补录历史未提交任务时，才允许一次 commit 记录多个 issue 编号。
- 若任务完成后仍存在残余风险、验证盲区或兼容性缺口，必须回写到独立风险台账。
- 新增风险时，至少写入 `risk_status=open`、`fix_status=todo`。
- 若当前 issue 处理了既有风险，必须同步更新 `risk_status`、`fix_status`、`fix_issue_id`、`git_commit`。
- 涉及 secrets、端口暴露、数据删除、重建或服务中断的 issue，必须写清安全约束、影响面、确认点、回滚方式和验收标准。
- `.env`、真实 token、真实连接串和其他敏感信息不得作为文档样例或提交内容。
- 若 issue 包含测试、排查或临时验证，完成定义里必须包含“停止临时进程、释放临时端口、清理临时二进制和测试数据”。

## 4. 阶段拆分

## G1-QA-01 基线与验收矩阵冻结

- 目标：把当前真实功能面、测试基线和决策 gate 固定下来，避免后续执行过程中目标漂移。
- 范围：
  - 复核现有模块、接口、视图、扩展与测试覆盖。
  - 记录 `build`、`test` 和“仓库内 Playwright 仅作历史资产、UI 验证改用内置 Playwright MCP”的基线结论。
  - 冻结 `ai_simplify`、备份 / 还原合同、扩展是否纳入 release gate 三个关键决策。
  - 初始化 [Agent 进度台账](./05-agent-status.md) 与 [风险台账](./06-risk-log.md)。
- 非目标：
  - 不在本 issue 中改业务实现。
  - 不修项目内 Playwright 环境。
- 依赖：无。
- 验收：
  - 形成一份可执行的功能覆盖矩阵。
  - 关键决策被写入文档，而不是留在口头沟通。
  - 后续 issue 的依赖顺序在 [Agent 进度台账](./05-agent-status.md) 中可直接执行。

## R1-QA-01 建立内置 Playwright MCP UI 验证基线

- 目标：让 UI 回归不再依赖仓库内 Playwright 套件，而是直接通过内置 Playwright MCP 执行稳定 smoke。
- 范围：
  - 设计 MCP UI smoke checklist。
  - 明确服务启动、登录、选择器策略、截图 / 断言留痕与清理规则。
  - 将仓库内 `e2e/` 明确标注为历史资产或次要资产，不作为当前 release gate。
- 非目标：
  - 不修复项目内 `npm run test:e2e`。
  - 不在本 issue 中处理 AI 业务逻辑。
- 依赖：`G1-QA-01`。
- 验收：
  - 可以通过内置 Playwright MCP 对临时环境完成最小 UI smoke。
  - UI 验证步骤不依赖项目内 Playwright 配置和 spec 文件。
  - 验证后不会遗留悬挂进程、临时端口和截图产物。

## R1-API-02 补齐设置 / 模板 / 快照 / 备份 API 自动化覆盖

- 目标：把当前明显缺失的非 AI 运维面 API 拉进自动化回归。
- 范围：
  - 设置页保存 / 重置 / 读取接口。
  - 模板 CRUD / apply / reset。
  - 快照保存 / 查询 / 删除 / 批删。
  - 备份列表 / 创建 / 下载参数校验 / 删除 / 还原错误路径。
- 非目标：
  - 不做真实浏览器扩展自动化。
  - 不在本 issue 中引入真实 AI 调用。
- 依赖：`G1-QA-01`。
- 验收：
  - 新增测试覆盖成功、参数错误、对象不存在和安全校验分支。
  - 测试使用临时数据目录，不污染仓库内真实 `data/`。
  - 执行完成后 `npm test` 仍通过。

## R1-BE-03 修正备份 / 还原与快照资产合同

- 目标：明确并落实施工级 backup / restore / snapshot contract，避免当前“备份整库、还原部分状态”的隐性风险。
- 范围：
  - 决定还原是完整恢复还是显式部分恢复，并把合同写入代码与文档。
  - 将 `snapshots` schema 收口到统一初始化路径。
  - 为快照文件资产定义是否纳入备份与恢复范围。
  - 为还原流程增加临时副本验证和 pre-restore 回滚路径。
- 非目标：
  - 不做跨机器同步。
  - 不做对象存储或云备份。
- 依赖：`G1-QA-01`。
- 验收：
  - 还原行为与文档描述一致，且有自动化或可重复演练证明。
  - 快照元数据和文件资产的恢复边界明确。
  - 对真实数据有影响的操作具备影响面、确认点、回滚方式和验收标准。
- 安全 / 高风险约束：
  - 自动执行默认只使用临时数据库和临时快照目录。
  - 若需对真实备份文件做恢复演练，必须先取得人工确认。
  - 完成后必须清理临时数据库、临时快照文件和测试备份。

## R1-DOC-04 清理 README / 页面遗留功能漂移

- 目标：让 README、页面文案和实际代码的能力边界一致。
- 范围：
  - 清理 README 中不存在的 `ai_simplify`、过时目录结构、旧扩展路径。
  - 清理 `pages.ts` / 任务页中的 simplify 遗留表述，或将其改成明确的 backlog 标记。
  - 同步设置页和 AI 配置说明。
- 非目标：
  - 不恢复已下线功能。
  - 不在本 issue 中大改 UI 设计。
- 依赖：`G1-QA-01`。
- 验收：
  - 文档不再承诺当前不存在的接口和模块。
  - 页面和 README 的术语与当前代码一致。
  - 若功能被判定为延期目标，会在 backlog 中被显式保留而不是隐式遗留。

## R15-AI-01 建立 AI mock / fixture 与 deterministic harness

- 目标：让 AI 路径具备离线可重复的自动化验证能力。
- 范围：
  - 为 OpenAI 兼容客户端建立可替换的 mock / fixture 注入点。
  - 准备固定测试书签数据集和固定模型返回样本。
  - 覆盖成功、超时、空响应、非 JSON、非法分类路径、部分批次失败等场景。
- 非目标：
  - 不在本 issue 中做真实 provider 联调。
  - 不重写 AI 提示词体系。
- 依赖：`R1-API-02`、`R1-BE-03`。
- 验收：
  - AI 相关测试默认可离线运行。
  - fixture 覆盖至少单条分类、批量分类、organize 批次失败三类场景。
  - 完成后不会残留 mock server 进程和临时数据。

## R15-AI-02 覆盖 AI classify / test / classify-batch HTTP 合同

- 目标：补齐 AI 入口 API 的自动化验证。
- 范围：
  - `/api/ai/test`
  - `/api/ai/classify`
  - `/api/ai/classify-batch`
  - 与模板、批量大小、错误码、扩展依赖路径相关的验证。
- 非目标：
  - 不在本 issue 中做 organize apply / rollback。
  - 不做真实网络连通性验证。
- 依赖：`R15-AI-01`。
- 验收：
  - 缺配置、无模板、非法 `batch_size`、AI 失败和成功路径均被覆盖。
  - 批量任务的 job 创建、状态变化和错误回写可验证。
  - `npm test` 中新增用例稳定通过。

## R15-AI-03 覆盖 organize 生命周期与配置漂移

- 目标：让 organize 全生命周期和模板快照语义具备清晰合同。
- 范围：
  - `/api/ai/organize`
  - `/api/ai/organize/active`
  - `/api/ai/organize/pending`
  - `/api/ai/organize/:planId`
  - `/api/ai/organize/:planId/assignments`
  - `/apply`、`/apply/resolve`、`/apply/confirm-empty`、`/rollback`、`/cancel`、`/retry`
  - `ai_batch_size` 是接入运行时还是移除。
  - cross-template snapshot、rollback TTL、stale plan recovery。
- 非目标：
  - 不验证真实模型分类质量。
  - 不引入新的 AI provider 类型。
- 依赖：`R15-AI-01`、`R1-BE-03`。
- 验收：
  - live template 与 cross-template 两条路径都有测试。
  - rollback 窗口、坏快照、needs_review、冲突决策、空分类处理都有等价覆盖。
  - `ai_batch_size` 的合同被修正为“真实生效”或“明确移除”。

## R15-H1-04 真实 AI 提供方联调与人工验收

- 目标：验证真实 OpenAI 兼容 provider 下 AI 功能可用，而不是只在 mock 中通过。
- 范围：
  - 使用人工提供的 `base_url`、`api_key`、`model`。
  - 使用固定书签样本做 `test`、`classify`、`classify-batch`、`organize`、`apply/rollback` 演练。
  - 记录分类质量、失败样式、人工复核工作量。
- 非目标：
  - 不把真实凭证提交到仓库。
  - 不追求零误判，只追求可接受、可解释、可回退。
- 依赖：`R15-AI-02`、`R15-AI-03`。
- 验收：
  - 有一份真实 provider 验收记录，标明输入样本、模型、通过 / 失败原因。
  - 密钥只存在本地临时环境，不出现在提交、日志和文档样例中。
  - 联调结束后清理临时 `.env`、临时 token、临时数据与后台进程。
- 安全约束：
  - 本 issue 执行级别为 `H1`，缺凭证时必须停止，不得伪造“已验证”。

## R2-E2E-01 补齐 Playwright MCP 关键业务旅程

- 目标：把内置 Playwright MCP 的 smoke 从最小基线扩展到 release gate 所需路径。
- 范围：
  - 书签、分类、搜索现有用例修通。
  - 增加设置、任务页 / SSE、模板、快照、备份基本旅程。
  - 为 AI 路径增加 mock 条件下的 UI / API 联动 smoke。
- 非目标：
  - 不在 MCP UI 验证中依赖真实 AI provider。
  - 不覆盖移动端。
- 依赖：`R1-QA-01`、`R1-API-02`、`R15-AI-02`、`R15-AI-03`。
- 验收：
  - 内置 Playwright MCP 能稳定跑完关键 UI 旅程。
  - 核心用户旅程有 trace 和失败截图保留策略。
  - 运行后清理测试服务、临时端口和 `tmp` 产物。

## R2-EXT-02 浏览器扩展与快照 round-trip 验收

- 目标：验证 `extension-new/` 与服务端 API 的真实保存链路。
- 范围：
  - API Token 配置。
  - 保存书签。
  - 保存快照。
  - 同时保存书签与快照。
  - 失败提示和最小回归清单。
- 非目标：
  - 不构建商店发布包。
  - 不覆盖 Firefox / Edge 全矩阵兼容。
- 依赖：`R2-E2E-01`、`R15-H1-04`。
- 验收：
  - 扩展对临时环境的 round-trip 可复现。
  - 书签、快照和任务页能看见对应副作用。
  - 验证后清理临时 Token、临时快照和扩展测试数据。

## R2-REL-03 最终回归、发布说明与交接

- 目标：输出一套可交接给后续维护者或 Code Agent 的发布级结果。
- 范围：
  - 汇总 build / unit / integration / e2e / H1 人工验收结果。
  - 关闭已解决风险，保留未解决风险。
  - 更新 README、运行说明、回归矩阵和交接说明。
- 非目标：
  - 不追加新功能。
  - 不在本 issue 中继续扩展测试范围。
- 依赖：`R2-E2E-01`、`R2-EXT-02`、`R15-H1-04`、`R1-DOC-04`。
- 验收：
  - 有最终发布清单和结果归档。
  - [风险台账](./06-risk-log.md) 中未解决项都有明确状态。
  - 自动执行完成后仓库内不遗留测试临时进程、端口、临时二进制和测试数据。

## 5. 推荐执行顺序

1. `G1-QA-01`
2. `R1-QA-01`
3. `R1-API-02`
4. `R1-BE-03`
5. `R1-DOC-04`
6. `R15-AI-01`
7. `R15-AI-02`
8. `R15-AI-03`
9. `R15-H1-04`
10. `R2-E2E-01`
11. `R2-EXT-02`
12. `R2-REL-03`
