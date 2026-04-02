# bookmarks-manager Issue 级任务拆分

更新时间：2026-04-02

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
- 阶段枚举：`G1`、`R1`、`R15`、`R2`、`R3`、`R4`、`R5`、`R6`、`R7`、`R8`、`R9`、`R10`。
- 域枚举建议：`QA`、`API`、`BE`、`DOC`、`AI`、`E2E`、`EXT`、`REL`、`H1`、`UI`、`CLEAN`。
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

## R1-QA-05 清理测试骨架与冗余内容

- 目标：在 `R1-API-02` 补齐主要运维面覆盖后，收口当前仓库里重复、临时或未纳管的测试辅助与骨架，避免后续继续在两套测试基建上叠加。
- 范围：
  - 清理重复或无主归属的测试 helper、fixture、占位文件与过时目录。
  - 明确当前受支持的测试入口、辅助工具和目录结构。
  - 删除不会再被后续 issue 复用的冗余测试内容，并补必要说明，避免后续误用。
- 非目标：
  - 不在本 issue 中新增业务功能覆盖。
  - 不替代 `R15-AI-01` 的 AI mock / fixture 设计。
  - 不恢复仓库内 Playwright 为主验证路径。
- 依赖：`R1-API-02`。
- 验收：
  - 测试辅助只有一套清晰主路径，后续 issue 不需要在重复 helper 间做选择。
  - 被删除的内容都属于冗余、占位或已被替代资产，不影响后续 `R1.5` / `R2` 计划。
  - `npm test` 与 `npm run build` 仍通过。

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

## R3-UI-01 收口首页分类导航与前端布局回归

- 目标：修复首页分类导航在刷新 / 水合后从水平变垂直、滚动或拖拽失效、部分分类不可见等前端回归，并为同类布局漂移建立可复跑验收。
- 范围：
  - 复现并修复首页分类导航的 hydration / Alpine 状态 / CSS 布局漂移。
  - 修复分类导航在分类较多时的水平滚动、拖拽或等价访问交互，保证分类不会因为容器回归而不可达。
  - 盘点首页及相关导航 / 弹层中相同类型的前端 UI 漂移点，至少收口一轮高风险回归。
- 非目标：
  - 不在本 issue 中重做整站视觉设计。
  - 不展开全站主题系统重构。
- 依赖：`R2-REL-03`。
- 验收：
  - 刷新前后分类导航布局一致，不再出现先水平后垂直的回归。
  - 分类较多时仍可滚动、拖拽或等价访问，不会只显示部分分类。
  - 至少有 1 份自动化或可复跑 UI 验收证明覆盖该问题。

## R3-AI-02 强化 AI organize 高风险数据安全与时序回归

- 目标：围绕会改动书签与分类的 AI organize 流程，补齐高风险数据安全合同与多时序测试，降低误应用和数据丢失风险。
- 范围：
  - 不同书签数量 / scope / `batch_size` 下的 plan 生成与应用。
  - 书签在 plan 生成后被移动、编辑、删除时的 apply / rollback 行为。
  - 分类在 plan 生成后被重命名、移动、删除或模板切换后的 apply / rollback 行为。
  - 多个 organize 任务在不同时间创建、交错 `apply` / `rollback` / `cancel` / `retry` 时的冲突、stale plan 与 guardrail 合同。
- 非目标：
  - 不追求真实模型零误判。
  - 不在本 issue 中新增新的 AI provider 类型。
- 依赖：`R2-REL-03`。
- 验收：
  - 对数据丢失 / 误覆盖的高风险路径有明确 guardrail 与自动化覆盖。
  - 多个 plan 共存时谁可以 `apply`、谁必须失效或进入人工决策有清晰合同。
  - 执行结束后 `npm test` 仍通过，且不遗留临时数据和后台任务。

## R3-QA-03 补齐跨页面交互一致性 UI 回归

- 目标：补齐“一个页面改动，另一个页面展示应同步一致”的 UI 交互测试，避免分类顺序、导航状态、筛选状态等跨页面漂移。
- 范围：
  - 分类管理页排序与首页分类导航顺序一致性。
  - 管理页拖拽 / 移动 / 删除分类后，首页分类导航与相关下拉 / 筛选在即时或刷新后的一致性。
  - 盘点类似的跨页面交互合同，例如模板切换、书签移动、快照 / 任务入口状态刷新。
- 非目标：
  - 不做全站像素级视觉比对。
  - 不替代 `R3-UI-01` 的具体布局修复。
- 依赖：`R3-UI-01`。
- 验收：
  - 至少建立 1 组可复跑的 UI interaction suite，覆盖排序同步、拖拽后同步、刷新后保持一致。
  - 首页导航、管理页和相关表单的分类顺序合同被明确写入测试。
  - 运行后仍以内置 Playwright MCP 或可复跑 harness 为主，不回退到仓库内 Playwright spec 作为主 gate。

## R4-CLEAN-01 清理 ai_simplify 遗留死代码与历史兼容面

- 目标：把 `ai_simplify` 从当前运行时能力面彻底降级为“仅历史兼容读取”，避免新代码继续把它当活跃任务类型或专属 UI 分支。
- 范围：
  - 将 `jobs` 中“当前可创建任务类型”和“历史库中可能存在的遗留类型”拆开。
  - 清理任务详情页对 `ai_simplify` 的专属展示分支，统一收口为历史 AI 任务兼容态。
  - 同步回写功能矩阵中关于 `ai_simplify` 的剩余实现面描述。
- 非目标：
  - 不恢复 `ai_simplify` 路由或业务流程。
  - 不删除数据库迁移中用于清理旧 simplify 表的兼容语句。
- 依赖：`R2-REL-03`。
- 验收：
  - 运行时代码不能再通过 `createJob()` 创建新的 `ai_simplify` 任务。
  - 任务详情页不再保留 `ai_simplify` 专属 UI 标签，但历史任务记录仍可正常打开。
  - `npm test`、`npx tsc --noEmit`、`npm run build` 通过。

## R4-QA-02 扩展跨页面 UI interaction harness 到删除 / 移动 / 模板切换 / 书签移动

- 目标：把现有分类交互 harness 扩展到更高风险的跨页面联动路径，覆盖删除分类、移动分类、模板切换、单条 / 批量书签移动后的 UI 同步与刷新保持。
- 范围：
  - 在现有浏览器 harness 上继续覆盖一级分类删除、子分类移动、单条书签移动、批量书签移动和自定义模板切换。
  - 验证首页分类导航、子分类下拉、“添加书签”分类下拉、当前模板显示、书签列表与当前筛选状态的一致性。
  - 修复这条链路里暴露出的同类前端状态时序问题，例如 `currentCategory`、已展开父分类、已选分类在数据刷新后的失效态。
- 非目标：
  - 不在本 issue 中新做一套“移动分类”前端管理 UI。
  - 不做全站视觉 diff 或仓库内 Playwright spec 重建。
- 依赖：`R3-QA-03`。
- 验收：
  - `scripts/category-interaction-validate.ts` 可 clean run，且覆盖排序、删除、分类移动、书签移动、模板切换和刷新保持。
  - 删除分类和模板切换后，不再出现“筛选状态已失效但书签列表仍停留旧结果”的前端漂移。
  - `npm test`、`npx tsc --noEmit`、`npm run build` 通过。

## R5-AI-01 收口单条 classify taxonomy guardrail

- 目标：把 `/api/ai/classify` 从“可能返回模板外层级的辅助建议”收口成“输出必须落在当前模板 / 分类树内”的强合同入口。
- 范围：
  - 为单条 classify 建立候选分类枚举、路径标准化和 taxonomy guardrail。
  - 优先读取当前活动模板；若无活动模板，再回退到当前 live categories。
  - 对模板外返回做 deterministic 收口：可映射则归一化，不可映射则拒绝返回错误结果。
  - 补足对应的离线 HTTP 合同与 deterministic harness 覆盖。
- 非目标：
  - 不在本 issue 中重新验收真实 provider 的语义正确率。
  - 不在本 issue 中改动 classify-batch / organize 的批量分配合同。
- 依赖：`R15-H1-04`、`R4-CLEAN-01`。
- 验收：
  - 单条 `/api/ai/classify` 在有活动模板时只能返回模板内的合法分类路径。
  - `学习资源/React` 这类模板外二级结果会被归一化或显式拒绝，不再直接透传到调用方。
  - `npm test`、`npx tsc --noEmit`、`npm run build` 通过。

## R5-EXT-02 将扩展 round-trip gate 升级到真实 unpacked runtime

- 目标：把扩展验收从“普通页面中的 popup-harness”升级到“Playwright Chromium 中加载的真实 unpacked extension runtime”，收口浏览器宿主层面的剩余盲区。
- 范围：
  - 使用 `chromium.launchPersistentContext()` 加载 `extension-new/`，在真实扩展宿主中运行 popup。
  - 验证真实 `chrome.storage`、`chrome.tabs.create`、`chrome.tabs.query`、`chrome.scripting.executeScript`、`chrome.tabs.sendMessage`、content script 与服务端 API 的联动。
  - 覆盖 token 配置、目标页标题 / URL 绑定、保存书签、保存快照、收藏+存档、失败提示，以及管理页 / 获取 Token 入口打开新标签。
  - 为 headless 自动化无法直接点击工具栏 action popup 的限制，补充最小目标页 hint 钩子，并把约束写入验收文档。
- 非目标：
  - 不在本 issue 中重建仓库内 Playwright 扩展 spec。
  - 不把“点击浏览器工具栏图标打开 popup”的 UI 手势本身纳入自动化范围。
- 依赖：`R2-EXT-02`、`R2-REL-03`。
- 验收：
  - `scripts/extension-runtime-validate.ts` 可 clean run，并在真实 Chromium unpacked extension runtime 下覆盖书签、快照、save-all、失败提示和新标签打开。
  - 快照文件内容能证明抓取的确实是目标页，而不是 popup 页面或 mock 内容。
  - `npm test`、`npx tsc --noEmit`、`npm run build` 通过，且临时 profile、临时 DB、临时快照和后台进程已清理。

## R5-EXT-03 覆盖真实 action popup 目标绑定

- 目标：把扩展验证继续推进到真实 browser action popup target 本身，证明 popup 在真实宿主中确实绑定到当前活动页，而不是只验证“直接打开 popup.html”或“普通页面里的 popup-harness”。
- 范围：
  - 使用 `chrome.action.openPopup()` 打开真实 action popup target。
  - 使用 Chromium remote debugging + raw CDP 附着到 popup target，读取其 DOM 和 `chrome.tabs.query()` 结果。
  - 验证 popup 中的标题 / URL 来自当前活动页，而不是扩展页或后台页。
  - 将这条验证补入扩展 release gate 文档，和 `R5-EXT-02` 形成互补。
- 非目标：
  - 不模拟浏览器工具栏图标的物理点击手势。
  - 不在本 issue 中重复覆盖书签保存、快照保存和 save-all 主链路。
- 依赖：`R5-EXT-02`。
- 验收：
  - `scripts/extension-action-popup-validate.ts` 可 clean run。
  - 真实 action popup target 可被发现并附着，且其 `#title` / `#url` 与当前活动页一致。
  - popup 内部可看见当前活动 tab，证明 active-page 绑定合同成立。
  - `npm test`、`npx tsc --noEmit`、`npm run build` 通过。

## R5-UI-04 移除运行时 Tailwind 并固化静态样式产物

- 目标：把首页、登录、设置、任务、快照等页面对运行时 `tailwind.js` 的依赖彻底收口为可复跑的静态样式产物，关闭前端资产完整性的残余风险。
- 范围：
  - 新增可复跑的静态 Tailwind 生成脚本，基于仓库内模板与前端脚本提取 class，并输出受版本控制的 `public/tailwind.generated.css`。
  - 将 `views/index.ejs`、`views/login.ejs`、`views/job.ejs`、`views/jobs.ejs`、`views/settings.ejs`、`views/snapshots.ejs` 从运行时 `<script src="/public/lib/tailwind.js">` 切换到静态 `<link>`。
  - 新增页面资产合同测试，防止运行时 Tailwind 引用和 warning suppress shim 回退。
  - 复跑现有分类交互浏览器 harness，证明静态样式替换后首页导航、分类联动和模板切换主链路未退化。
- 非目标：
  - 不在本 issue 中重做整站样式体系或引入新的 npm CSS 构建链。
  - 不移除 `public/lib/tailwind.js` 这份 vendor bundle 本身；它只收口为生成脚本输入，不再被页面运行时直接引用。
- 依赖：`R2-E2E-01`、`R3-UI-01`。
- 验收：
  - 受影响页面不再包含运行时 Tailwind `<script>` 或 warning suppress shim，而是统一引用 `public/tailwind.generated.css`。
  - `scripts/generate-static-tailwind.ts` 可复跑并稳定生成完整静态样式资产。
  - `tests/integration/page-assets.test.ts`、`npx tsx scripts/category-interaction-validate.ts`、`npx tsc --noEmit`、`npm test`、`npm run build` 通过。

## R5-AI-02 强化单条 classify 语义择优与样本回归

- 目标：在 `R5-AI-01` 的 taxonomy guardrail 之上，再补一层本地 deterministic 语义择优，降低单条 `/api/ai/classify` 在模板内候选之间选错合法分类的概率。
- 范围：
  - 基于 `title`、`url`、可选 `description`、常见 host/path 信号和分类别名，对单条 classify 候选路径做本地 rerank。
  - 覆盖常见的“文档 / 教程 / 课程 / 书籍 / 示例 / 社区 host”语义信号，避免模型把文档页错误落到框架 / 技术主题桶里。
  - 对完全不可映射但内容信号足够强的返回结果，允许在当前模板内做 deterministic rescue，而不是直接失败。
  - 新增纯函数语义样本回归，并补足 HTTP 合同测试与离线 harness 验证。
- 非目标：
  - 不在本 issue 中重新引入模板外分类输出。
  - 不把这层语义择优扩展到 `classify-batch` / `organize` 的批量分配链路。
  - 不以本 issue 替代真实 provider 的后续抽样人工验收。
- 依赖：`R5-AI-01`。
- 验收：
  - 单条 `/api/ai/classify` 在文档 / 示例 / 社区 host 等高信号场景下，能稳定落到模板内更合适的子分类，而不是停留在宽泛但合法的主题桶。
  - `description` 可作为可选上下文参与 prompt 和本地 rerank，但不破坏现有调用方。
  - `tests/ai-classify-guardrail.test.ts`、`tests/integration/ai-routes.test.ts`、`tests/integration/ai-harness.test.ts`、`npx tsc --noEmit`、`npm test`、`npm run build` 通过。

## R5-AI-03 固化单条 classify 语义样本集与复验脚本

- 目标：把 `R5-AI-02` 补上的单条 classify 语义择优从“几条散落断言”升级为“固定样本集 + 可复跑脚本 + 自动化 gate”，降低后续模板调整或 provider 切换时的回归盲区。
- 范围：
  - 新增覆盖文档、教程、课程、代码示例、GitHub issues/releases、技术社区 host、浏览器插件商店 host 的固定语义样本集。
  - 新增可复跑的 `npx tsx scripts/ai-classify-semantic-validate.ts`，输出通过率与逐样本结果。
  - 将这份样本集纳入 `npm test`，避免以后只在零散用例里验证单条 classify。
  - 补齐因新样本暴露出的更具体 host 规则，例如 `GitHub releases/issues` 与 `Chrome Web Store`。
- 非目标：
  - 不在本 issue 中做真实 provider `H1` 复验。
  - 不把单条 classify 的样本 gate 扩展到 `classify-batch` / `organize` 批量链路。
- 依赖：`R5-AI-02`。
- 验收：
  - 固定语义样本集可 clean run，且样本脚本会对失败样本输出逐条结果。
  - `tests/ai-classify-semantic-samples.test.ts` 已将这份样本集纳入 `npm test`。
  - `npx tsx scripts/ai-classify-semantic-validate.ts`、`npx tsc --noEmit`、`npm test`、`npm run build` 通过。

## R5-AI-04 固化单条 classify H1 语义复验与超时留痕

- 目标：在 `R5-AI-03` 的本地固定样本 gate 之上，再补一条真实 provider focused H1 replay 入口，避免模板、provider 或 model 变化后只剩历史 3 条样本和零散手工复测。
- 范围：
  - 新增可选择样本子集、可跳过 `/api/ai/test`、可记录 `attempts` 与临时清理状态的 `scripts/ai-h1-classify-semantic-validate.ts`。
  - 将脚本默认 `timeout_cap_ms` 对齐到真实单条 classify 路由合同，避免脚本自身的过低超时上限制造假阴性。
  - 使用当前本地 provider 配置至少执行一次 focused H1 replay，并把 `/api/ai/test` 与单条 `/api/ai/classify` 的真实结果或阻塞样式写入独立验收文档。
- 非目标：
  - 不在本 issue 中修改生产 classify prompt、taxonomy guardrail 或 batch / organize 合同。
  - 不在本 issue 中修复 provider 侧网络、SLA 或模型可用性。
- 依赖：`R5-AI-03`、`R15-H1-04`。
- 验收：
  - `scripts/ai-h1-classify-semantic-validate.ts` 可 `--help`，并支持 `--ids`、`--skip-test`、`--retries` 和自动清理。
  - focused H1 replay 至少对当前 provider 跑过一次，且结果和阻塞原因已写入独立验收记录。
  - `npx tsc --noEmit`、`npm test`、`npm run build` 通过，且未遗留临时目录、临时 DB 或后台验证进程。

## R5-AI-05 收口单条 classify 超时降级路径

- 目标：在 `R5-AI-04` 已确认当前 provider 会 timeout 的前提下，把单条 `/api/ai/classify` 从“provider 超时即 500”收口到“高信号输入可退化到本地 deterministic guardrail”的更稳妥合同。
- 范围：
  - 为单条 classify 暴露明确的 deterministic fallback 入口，复用既有 taxonomy / semantic 评分，而不是另起一套临时规则。
  - 仅对 timeout / 连接型 provider 故障启用 fallback；普通 provider 失败和配置错误继续原样报错。
  - 补足 route / unit 测试，并用 focused H1 replay 证明 `react-reference-docs` 这类高信号样本可在真实 provider timeout 时仍返回模板内合法分类。
- 非目标：
  - 不在本 issue 中把 `/api/ai/test` 改成绿色。
  - 不把 timeout fallback 扩展到 `classify-batch` / `organize` 批量链路。
  - 不承诺低信号输入都能在无 provider 的情况下稳定分类。
- 依赖：`R5-AI-04`。
- 验收：
  - 单条 `/api/ai/classify` 在 timeout / 连接型故障下，对高信号输入可返回模板内合法分类。
  - 普通 provider 错误仍保持 `500`，不发生错误吞没。
  - `npx tsc --noEmit`、定向 classify 回归、focused H1 replay、`npm test`、`npm run build` 通过。

## R5-AI-06 验证 `/api/ai/test` 重试与当前 provider 残余

- 目标：在 `R5-AI-05` 已收口单条 classify timeout fallback 之后，把 `/api/ai/test` 的 transient retry 合同和当前 provider 的真实残余状态写实，不再把 provider 可用性问题误判成代码未处理。
- 范围：
  - 验证 `/api/ai/test` 在“首个 timeout、第二次成功”场景下会重试并返回 `200`。
  - 用 focused H1 replay 验证当前本地 provider 是否能被这层 retry 拉回绿色。
  - 将结果补入 release handoff、风险台账和基线矩阵，明确 `/api/ai/test` 仍不是当前 provider 的稳定绿色 gate。
- 非目标：
  - 不继续修改 `/api/ai/test` 路由实现。
  - 不把 `classify-batch` / `organize` 再拉回本 issue 复验。
- 依赖：`R5-AI-05`。
- 验收：
  - `/api/ai/test` 的 transient retry 合同已有自动化证明。
  - focused H1 replay 已补跑，且结果和残余原因被写入独立验收记录。
  - 未遗留临时目录、临时 DB 或后台验证进程。

## R5-AI-06 收口 `/api/ai/test` 瞬时重试与残余留痕

- 目标：为 `/api/ai/test` 增加最小但明确的瞬时抗抖动能力，避免一次 timeout 就把 AI 配置判成死路，同时验证这条改动是否足以把当前真实 provider 拉回绿色。
- 范围：
  - `/api/ai/test` 对 timeout / 连接型故障增加 1 次重试。
  - 补 route 合同测试，证明“瞬时 timeout 后第二次成功”会返回 `200`，普通 provider 失败仍保持 `500`。
  - 对当前本地 provider 补 focused H1 replay，并把成功 / 失败样式写入独立验收文档。
- 非目标：
  - 不在本 issue 中继续扩大到 `classify-batch` / `organize` 的 provider retry 策略。
  - 不承诺一次重试就能修复 provider 侧真实可用性问题。
  - 不修改设置页字段或 AI 配置存储合同。
- 依赖：`R5-AI-05`。
- 验收：
  - `/api/ai/test` 在 timeout / 连接型瞬时故障下会自动重试 1 次。
  - 本地合同测试已证明瞬时 timeout 可恢复，而普通 provider 失败仍保持原样。
  - `npx tsc --noEmit`、定向 `/api/ai/test` 回归、focused H1 replay、`npm test`、`npm run build` 通过；若真实 provider 仍未恢复绿色，必须在文档中明确保留为残余风险。

## R5-AI-07 固化 provider 直连诊断与 `/api/ai/test` 可操作错误

- 目标：在 `R5-AI-06` 已证明“一次瞬时重试不足以把当前 provider 拉回绿色”的前提下，把残余问题从“仍超时但原因模糊”收口为“可明确区分 `/models` 探活、模型存在性和 `/chat/completions` 超时”的可执行诊断合同。
- 范围：
  - `/api/ai/test` 在 retryable timeout / 连接型故障重试后仍失败时，自动探测 `/models`，并返回稳定的诊断 payload。
  - 新增独立 `scripts/ai-provider-diagnose.ts`，直连 `/models` 与 `/chat/completions`，输出脱敏 JSON 报告。
  - 补 route 合同测试，证明 timeout 诊断 payload 稳定，普通 provider 失败仍保持原样。
  - 对当前本地 provider 补 direct diagnose 与 focused H1 replay，并把结论写入独立验收文档。
- 非目标：
  - 不在本 issue 中修复 provider 侧 timeout 本身。
  - 不把 `/api/ai/test` 扩大成多阶段健康检查 API。
  - 不把 diagnose 脚本接入 UI、定时任务或后台健康探针。
- 依赖：`R5-AI-06`。
- 验收：
  - `/api/ai/test` 在 retryable 故障重试后仍失败时，能区分“`/models` 可连通且 model 存在”“`/models` 可连通但 model 不存在”和“`/models` 自身也失败”。
  - `scripts/ai-provider-diagnose.ts` 能输出脱敏 report，至少包含 `/models` 与 `/chat/completions` 的状态、耗时和失败摘要。
  - `npx tsc --noEmit`、定向 AI route 回归、direct diagnose、focused H1 replay、`npm test`、`npm run build` 通过；若真实 provider 仍不绿，必须把问题范围收敛到可操作口径。

## R5-AI-08 收口设置页 AI 诊断可见性

- 目标：把 `R5-AI-07` 新增的 provider 诊断从“仅在 API 响应里可见”推进到“设置页操作员在点击测试连接后即可直接看到”的可操作 UI，避免非开发者只能从 network / 日志中判断是配置错误还是 chat completion timeout。
- 范围：
  - 设置页为 AI 测试按钮、输入框和结果面板补稳定选择器。
  - 将 `/api/ai/test` 的成功态、普通失败态和带 `diagnostic` 的失败态渲染成可见结果面板，而不只弹 toast。
  - 新增浏览器 harness，验证成功态和 `models_ok=true` 的诊断失败态都能正确展示。
  - 补页面级回归，确保 settings 页始终保留 AI 诊断壳和稳定选择器。
- 非目标：
  - 不在本 issue 中修改 `/api/ai/test` 路由合同。
  - 不把 provider diagnose 脚本接进设置页后台轮询。
  - 不在本 issue 中处理设置页其它遗留交互。
- 依赖：`R5-AI-07`。
- 验收：
  - 设置页点击“测试连接”后，成功态和带 `diagnostic` 的失败态都能在页面上直接展示，而不只依赖 toast。
  - `scripts/settings-ai-diagnostic-validate.ts` 能在真实浏览器中验证成功态与诊断失败态的 UI。
  - `npx tsc --noEmit`、定向页面回归、设置页 AI 诊断浏览器 harness、`npm test`、`npm run build` 通过。

## R5-AI-09 默认使用 Grok provider 验证并兼容 SSE completion

- 目标：把真实 provider 验证从“依赖当前应用设置碰巧指向某个 provider”收口成明确的 `grok` 默认源，并兼容 CherryStudio 风格的 OpenAI 兼容 `text/event-stream` completion 响应，避免 `/api/ai/test` 绿了但 `classify` / `organize` 因流式文本未被解析而继续误报空结果。
- 范围：
  - 新增共享 validation config helper，`scripts/ai-provider-diagnose.ts`、`scripts/ai-h1-classify-semantic-validate.ts`、`scripts/ai-h1-validate.ts` 默认使用 `--provider grok`，且保留 `--provider current` 作为显式回退。
  - provider validation 默认从本地 `validation_grok_*` 设置项读取，并回退到当前 `ai_*` 仅在其本身已指向 Grok 时。
  - 将 Grok 预设与 validation 默认 endpoint 修正到实际可用的 `https://grok2api.1018666.xyz/v1`，避免先前 `grop2api` / 缺少 `/v1` 的 `404` 漂移。
  - 为 AI client 增加统一 completion text 提取层，兼容标准 `choices[0].message.content` 与 `data: ... delta.content` 分块流式响应，并清理 `<think>...</think>` 噪音。
  - 补自动化回归，并对 Grok 默认源重跑 direct diagnose、focused classify H1 与 full H1。
- 非目标：
  - 不在本 issue 中引入多 provider UI 配置中心。
  - 不为所有第三方 provider 单独适配私有协议；本次只覆盖当前已验证可用的 Grok OpenAI 兼容入口。
  - 不在本 issue 中扩大 AI organize 的业务规则或 taxonomy 语义合同。
- 依赖：`R5-AI-08`。
- 验收：
  - provider validation 脚本默认无需额外参数即可使用 Grok；若要强制回到当前应用配置，必须显式传 `--provider current`。
  - `scripts/ai-provider-diagnose.ts` 在默认 Grok 源下返回 `/models = 200`、`modelFound = true`、`/chat/completions = 200`，且 `content-type = text/event-stream`。
  - `scripts/ai-h1-classify-semantic-validate.ts --ids react-reference-docs` 在默认 Grok 源下恢复到 `1/1 accepted`。
  - `scripts/ai-h1-validate.ts` 在默认 Grok 源下通过 `test`、`classify`、`classify-batch`、`organize`、`apply/rollback`，并达到 `singleAccepted = 1/1`、`batchAccepted = 3/3`、`organizeAccepted = 3/3`。
  - `npm test`、`npx tsc --noEmit`、`npm run build` 通过。

## R6-AI-01 明确多待应用 organize plan 的共存与 apply 合同

- 目标：把多个 `preview` / `applied` organize plan 共存时的 apply 规则收口成“可 apply，但必须显式处理冲突”的明确产品合同，替代当前主要依赖 stale 拒绝的隐式实现。
- 范围：
  - 盘点并写明当前规则：仅在同模板且书签集合重叠时，由更新的 plan 使旧 plan stale；不能再靠阅读 `findNewerOverlappingPlanId()` 才知道行为。
  - 将最终合同明确为：同模板不重叠 plan 可直接 `apply`；跨模板 plan 可 `apply`，但必须继续按模板隔离写入；同模板重叠 plan 也可进入 `apply`，但冲突书签必须先经过显式 resolve / needs_review，而不是静默覆盖或简单拒绝。
  - 补齐 `pending` 列表、plan 详情、`apply` / `apply/resolve` 的可见信息，让操作者能看到 plan 作用范围、书签数量、模板、冲突或失效原因。
  - 覆盖相同 / 不同模板、重叠 / 不重叠书签集合、不同书签数量、交错 `apply` / `rollback` / `cancel` 的高风险组合。
- 非目标：
  - 不在本 issue 中重做 AI organize 主流程 UI。
  - 不在本 issue 中修改 AI provider、prompt 或分类语义策略。
- 依赖：`R3-AI-02`。
- 验收：
  - 多待应用 plan 的共存和 `apply` 合同有明确文字定义，不能再靠读源码判断。
  - 自动化至少覆盖“同模板重叠进入冲突解决”、“同模板不重叠直接 apply”、“跨模板 plan apply 隔离写入”三组场景。
  - 页面和 API 能明确说明冲突对象、可直接应用对象和需要人工 resolve 的对象，不再只返回笼统 stale。

## R6-UI-02 收口模板编辑弹窗长树溢出与操作条可达性

- 目标：修复自定义模板分类项持续增多时，模板编辑弹窗在小视口 / 低高度 / 软键盘场景下不断拉长、底部操作按钮被挤出可视区的问题，并建立可复跑 UI 验收。
- 范围：
  - 收口模板编辑弹窗的可视高度、内部滚动区、操作条定位和窄屏表现，保证长树编辑时保存 / 取消始终可达。
  - 覆盖新增一级分类、添加子分类、删除、重命名、大量分类滚动编辑后的可操作性和关闭确认。
  - 如有必要，补稳定选择器和浏览器 harness，验证长树场景下的 footer 可见性与等价操作路径。
- 非目标：
  - 不在本 issue 中重做模板系统的整体视觉设计。
  - 不在本 issue 中新增模板树拖拽排序能力。
- 依赖：`R3-UI-01`。
- 验收：
  - 模板分类树显著增长后，保存 / 取消按钮仍可直接看见或通过明确等价路径访问。
  - 模板编辑弹窗不会因内容过长失去关闭、保存或未保存确认能力。
  - 至少有 1 份浏览器级或可复跑 UI 验收覆盖长树模板编辑场景。

## R6-AI-03 固化模板编辑后的 AI 分类源为最新活动模板

- 目标：确保模板在增删改查并重新应用后，AI 默认分类入口统一基于“最新活动模板”而不是历史创建态、旧快照或陈旧候选分类；显式指定 `template_id` 的 cross-template organize 继续保留。
- 范围：
  - 核对并补齐单条 `classify`、`classify-batch` 默认 preview、`organize` 默认入口对活动模板的读取合同。
  - 覆盖模板编辑后新增分类、删除分类、重命名和层级调整，验证 AI 候选分类、plan target tree 和相关页面提示同步切到最新活动模板。
  - 若当前任何链路仍读取旧 snapshot / live categories / stale cache，则修正实现并补自动化证明。
  - 把“默认入口读最新活动模板、显式 `template_id` 读指定模板”的合同写入文档和测试。
- 非目标：
  - 不改变用户显式传 `template_id` 的 cross-template organize 行为。
  - 不在本 issue 中承诺真实 provider 的语义准确率提升。
- 依赖：`R5-AI-09`。
- 验收：
  - 模板编辑并重新应用后，AI 默认分类入口都基于最新活动模板。
  - 已删除或改名的旧分类不会继续出现在默认 AI 候选分类或 plan target tree 中。
  - 显式指定 `template_id` 的 organize 仍稳定使用对应模板，而不是被活动模板覆盖。

## R6-EXT-04 收口内置扩展 UI 信息层次与视觉体验

- 目标：围绕 `extension-new/` 的弹窗界面，收口当前基于 SingleFile 的内置扩展在信息密度、状态反馈、设置区和操作主次上的 UI 粗糙点，提升可读性、可操作性和视觉一致性。
- 范围：
  - 盘点 popup 的信息架构、主操作优先级、分类选择、设置折叠区、成功 / 失败 / loading 状态的可见性与层次。
  - 在不改变书签保存 / 快照保存核心合同的前提下，对 `popup.html` / `popup.css` / `popup.js` 做一轮 UI 美化和交互收口。
  - 为 popup 主要交互补浏览器级验收，覆盖设置展开、分类选择、主操作按钮、成功 / 失败反馈。
- 非目标：
  - 不在本 issue 中新增独立 options page。
  - 不在本 issue 中扩大浏览器权限或重写扩展架构。
- 依赖：`R5-EXT-03`。
- 验收：
  - popup 的主操作、设置区和状态反馈层次更清晰，成功 / 失败 / loading 态不再混杂。
  - 至少有 1 份真实 runtime 或 action popup 验收证明覆盖新的 popup UI 主链路。
  - UI 调整后不回退既有扩展保存 / 快照合同。

## R6-EXT-05 优化内置扩展 SingleFile 逻辑稳健性与资源开销

- 目标：收口内置扩展在 SingleFile 注入、目标页解析、超时、重复点击、失败恢复和大页面快照上的逻辑脆弱点，降低卡死、误报、重复提交和性能抖动。
- 范围：
  - 盘点并优化 `popup.js` / `content.js` 中的 SingleFile 注入、timeout、按钮 disable / restore、重复触发和错误提示路径。
  - 评估并减少不必要的重复注入、无效等待和多余请求，保证失败时不会残留不可恢复的 disabled 状态。
  - 补真实扩展 runtime 验收，至少覆盖注入失败、页面不可连接、重复点击、超时或大页面处理等关键失败场景。
- 非目标：
  - 不在本 issue 中升级或替换 SingleFile vendor 版本。
  - 不在本 issue 中改写服务器端快照存储合同。
- 依赖：`R6-EXT-04`。
- 验收：
  - 注入失败、页面不可连接、超时和重复点击都有稳定、可见且可恢复的用户反馈。
  - 成功 / 失败后按钮状态会正确恢复，不残留卡死 UI。
  - 至少有 1 份真实扩展 runtime 验收覆盖关键失败场景和恢复路径。

## R6-TPL-06 增补多套预置模板并建立切换基线

- 目标：补足当前预置模板种类偏少的问题，新增多套可直接启用的内置模板，降低用户必须从默认模板或长树自定义模板手工改起的成本，并把模板切换后的基础合同纳入回归。
- 范围：
  - 盘点当前预置模板覆盖缺口，新增多套面向不同使用场景的内置模板，例如开发学习、产品运营、内容资料、收藏归档等方向。
  - 确保模板元数据、分类树、默认命名和层级深度在 UI 与 AI 分类入口中都能正常显示、应用和切换。
  - 覆盖“创建预置模板 -> 应用模板 -> 首页分类导航 / 管理页分类树 / AI 默认候选分类同步更新”的基础链路。
  - 为新增预置模板补文档说明和最小自动化 / harness 留痕，避免后续模板集继续靠手工点验。
- 非目标：
  - 不在本 issue 中引入模板市场、模板导入分享或云端同步。
  - 不在本 issue 中重做模板编辑器的整体交互设计。
- 依赖：`R6-AI-03`。
- 验收：
  - 内置预置模板数量显著增加，且至少覆盖 3 种以上不同信息组织场景。
  - 新增预置模板可以在现有模板管理入口中直接创建和应用，不出现空树、坏层级或重复根节点。
  - 应用不同预置模板后，首页分类导航、分类管理页和 AI 默认分类入口都切到对应最新活动模板。
  - 至少有 1 份自动化或可复跑验收记录覆盖预置模板创建 / 应用 / 切换主链路。

## R7-AI-01 收口 AI organize assigning 单活锁与取消时序合同

- 目标：把 AI organize 在 `assigning` 阶段的真实并发 / 时序合同彻底说清并落到实现里，避免 `retry` 绕过单活锁、取消中的 in-flight provider 返回继续把旧 preview 写回数据库，或者接口把这些合同错误折叠成 `500`。
- 范围：
  - 把 `createPlan()` 和 `transitionStatus(..., 'assigning')` 收口到同一套 `assigning` 单活锁检查与超时回收逻辑。
  - 覆盖“已有 assigning plan 时再次 start / retry”返回 `409 + activePlanId` 的合同。
  - 收口 `cancel` 与 in-flight provider 返回交错时的行为，确保已取消 plan 不再继续写 `assignments`、`batches_done`、`source_snapshot` 或 `preview` 终态。
  - 为 `plan not found`、非法状态迁移等 organize 状态机错误补稳定错误码，而不是路由层统一吞成 `500`。
  - 新增定向自动化回归，覆盖 start / retry 单活锁、cancel 后 next plan、missing-plan cancel 等场景。
- 非目标：
  - 不在本 issue 中重写 `JobQueue` 为真并发执行器。
  - 不在本 issue 中扩大 organize 的 apply / rollback 合同范围。
- 依赖：`R6-AI-01`、`R6-AI-03`。
- 验收：
  - 已有 `assigning` plan 时，`/api/ai/organize` 与 `/api/ai/organize/:planId/retry` 都稳定返回 `409`，且响应中带 `activePlanId`。
  - 已取消的 in-flight plan 在 provider 返回后仍保持 `canceled`，不会再写回陈旧 preview 数据。
  - 取消旧 plan 后，新的 plan 可以成功创建并继续完成 preview，不再受旧 provider 回调污染。
  - `cancel` / `retry` 对 missing plan 或状态机冲突会返回明确 `404/409`，而不是统一 `500`。

## R7-AI-02 冻结 AI organize 的书签作用域快照

- 目标：把 `organize` 的“本次到底整理哪些书签”也冻结成 plan 级快照，避免 `all / uncategorized / category:N` 在排队等待、失败重试或长时间保留 failed plan 后重新读取 live scope，偷偷吸进新书签或丢掉原本应处理的对象。
- 范围：
  - 在 plan 创建时把当前作用域解析成冻结的 `bookmark_ids` 快照，并写入 `source_snapshot`。
  - `assignBookmarks()` 与 `retry` 统一只使用冻结后的作用域快照，而不是再次扫描 live scope。
  - 为旧 plan 在首次 retry 时补 scope freeze，避免历史 failed plan 继续受 live scope 漂移影响。
  - 新增定向回归，覆盖“failed plan retry 前新增书签，不应被吸入原计划”的合同。
- 非目标：
  - 不在本 issue 中改变 organize 对书签删除后的 apply / retry 处理策略。
  - 不在本 issue 中重做 job queue 或引入并发执行。
- 依赖：`R7-AI-01`、`R6-AI-01`、`R6-AI-03`。
- 验收：
  - 新创建的 organize plan 会显式冻结 `scope_bookmark_ids`，即使初始作用域为空也保持冻结状态。
  - failed plan 在 retry 前新增的书签不会被吸入原计划。
  - `assignBookmarks()` 的 prompt 和 job total 只反映冻结时的书签集合，而不是 retry 时的 live scope。
  - 至少有 1 份 unit + integration 验收覆盖作用域冻结合同。

## R7-AI-03 收口 AI organize retry 预检与旧失败产物清理

- 目标：把 failed plan `retry` 的入口收口成稳定合同，避免“AI 配置缺失却把 plan 推进到 `assigning` 但不入队”，以及 retry 期间旧失败产物短暂残留在 plan 上、UI 继续展示陈旧 assignments / diff 的问题。
- 范围：
  - `retry` 前置校验 AI 配置，缺配置时直接返回 `400`，不进入 `assigning`。
  - `transitionStatus(..., 'assigning')` 在 failed plan retry 时清理旧 `assignments`、`failed_batch_ids`、`needs_review_count`、批次计数和旧 `bookmark_states / live_target_categories`，但保留冻结后的 scope / template 快照。
  - 新增定向回归，覆盖“retry 缺配置不推进状态”和“retry assigning 期间不暴露旧 preview 数据”。
- 非目标：
  - 不在本 issue 中改变 `retry` 对模板树版本的语义。
  - 不在本 issue 中扩大 organize apply / rollback 的合同范围。
- 依赖：`R7-AI-01`、`R7-AI-02`。
- 验收：
  - failed plan 在缺少 AI 配置时 `retry` 直接返回 `400`，plan 保持 `failed` 且不创建新 job。
  - retry 后的 `assigning` plan 不再携带旧 `assignments` / `failed_batch_ids` / `diff`。
  - 定向 unit + integration 回归覆盖 retry preflight 和旧失败产物清理。

## R7-AI-04 收口 AI organize 冻结 scope 缺对象 stale 合同

- 目标：把 `organize` 在真正进入 worker 执行时的冻结 scope 合同补完整，避免 scope 里的书签已经缺失却仍静默缩小处理集合继续 preview；同时收口 assigning 阶段的致命异常，避免 job 已 failed 但 plan 仍卡在 `assigning`。
- 范围：
  - `assignBookmarks()` 在读取冻结后的 `scope_bookmark_ids` 时，若 live bookmarks 数量与冻结集合不一致，直接把 plan 标记为 stale `error`，而不是静默跳过缺失书签。
  - 该 stale 合同同时覆盖初次 `start` 与 failed plan `retry` 两条路径。
  - organize worker 的致命异常统一落到“plan -> error，job -> failed + 明确 message”，避免残留 `assigning` 假活跃状态。
  - 新增定向回归，覆盖“ids scope 缺对象 start”和“retry 前删除冻结 scope 书签”两类场景。
- 非目标：
  - 不在本 issue 中改变 apply / rollback 阶段对书签删除后的冲突策略。
  - 不在本 issue 中引入更细粒度的 per-bookmark retry 或自动修补缺失 scope。
- 依赖：`R7-AI-03`。
- 验收：
  - `start` / `retry` 在 worker 发现冻结 scope 缺对象时，会把 plan 明确落到 `error`，job 明确落到 `failed`。
  - stale-scope 场景下不会再发起 AI 请求，也不会静默生成只覆盖剩余对象的 preview。
  - organize worker 遇到致命异常后，不再留下 `assigning` plan 假活跃状态。

## R7-AI-05 收口 AI organize error phase 可见性与 retry 语义

- 目标：把 `R7-AI-04` 引入的 `error` plan 从“内部状态”收口成明确的产品合同，避免首页 modal 卡在 `assigning`、`/retry` 先报配置错误再报 plan 错误，或 `error` plan 既看不清原因也不知道能否重试。
- 范围：
  - 明确 `error -> assigning` 的 retry 语义，并把 `/api/ai/organize/:planId/retry` 的判定顺序收口为“先判 plan 是否存在 / 是否可重试，再判 AI 配置”。
  - 让 organize `active/detail` 响应带出当前 job message，便于前端直接展示 `error` 原因。
  - 收口首页 organize modal 和任务详情页的 `error` phase 展示，不再把 `error` 混同成未知状态或残留在 `assigning`。
  - 新增定向回归，覆盖“missing plan retry 的错误优先级”、“error plan retry 成功恢复”和“error detail message 可见”。
- 非目标：
  - 不在本 issue 中引入独立的 organize error 列表页或结构化错误码 taxonomy。
  - 不在本 issue 中扩大 apply / rollback 合同范围。
- 依赖：`R7-AI-04`。
- 验收：
  - missing plan 的 `retry` 在未配置 AI 时也稳定返回 `404`，而不是先报配置错误。
  - 可恢复的 `error` plan 能重新进入 `assigning` 并完成 preview。
  - 首页 organize modal 与任务页都能明确展示 `error` phase，不再卡在 `assigning` 或退回原始状态字符串。

## R7-AI-06 收口 AI organize error plan 放弃合同

- 目标：把 `error` plan 的“放弃/取消”路径也补成可用合同，避免首页 modal 显示了 `error` 与“放弃”按钮，但后端状态机不允许 `error -> canceled`，前端还把非 `2xx` 误报成取消成功。
- 范围：
  - 允许 `error -> canceled` 的显式状态迁移，使用户可主动丢弃已中断的 organize plan。
  - 修正首页 `cancelOrganize()` / `cancelAndRestart()` 对非 `2xx` 返回的处理，不再静默关闭 modal 或误报成功。
  - 新增定向回归，覆盖“error plan 可取消，且保留原 failed job message”的合同。
- 非目标：
  - 不在本 issue 中引入批量清理历史 error plans 的后台任务。
  - 不在本 issue 中改变 failed / error plan 的 retry 语义。
- 依赖：`R7-AI-05`。
- 验收：
  - `error` plan 可以稳定进入 `canceled`，不再返回 `409 invalid transition`。
  - 首页点击“放弃”时，只有真正成功取消才会关闭 modal；失败时会显示后端错误。
  - 取消 `error` plan 不会篡改原 failed job 的 message / status 留痕。

## R7-QA-07 补齐历史 issue 的 Playwright 浏览器复验矩阵

- 目标：把此前已经收口的历史 issue 中“有页面 / 浏览器宿主表面”的部分重新做一次 clean browser replay，不再只依赖零散验收记录、单条脚本或路由测试。
- 范围：
  - 新增独立的 release journey 浏览器脚本，复放 `R1-QA-01`、`R2-E2E-01`、`R2-REL-03` 的首页 / 设置 / 任务 / 快照 / 模板 / AI organize 入口主链路。
  - 新增 `AI organize` 浏览器 harness，补齐 `assigning cancel`、`failed retry`、`error cancel`、`preview apply` 的页面级验证，把 `R6-AI-01`、`R7-AI-01`、`R7-AI-05`、`R7-AI-06` 从“主要靠路由测试”推进到“真实浏览器可回放”。
  - 新增统一入口，串联历史分类导航、跨页面交互、设置页 AI 诊断、模板长树、预置模板、扩展 round-trip、真实 runtime 与 action popup 脚本。
  - 对齐扩展 popup 迭代后的文案漂移，修正旧 round-trip harness 中已过时的 `待配置 / 已完成收藏和存档` 断言。
- 非目标：
  - 不恢复仓库内 `e2e/` 和 `playwright.config.ts` 为主验证路径。
  - 不把当前没有 MCP server 可调用的会话包装成“真实 MCP 会话”；本 issue 记录的是独立 Playwright 浏览器 harness 的等价复验。
- 依赖：`R7-AI-06`、`R6-TPL-06`、`R6-EXT-05`。
- 验收：
  - `npx tsx scripts/playwright-issue-regression-validate.ts` 可以 clean run，并顺序覆盖 `R1/R2/R3/R4/R5/R6/R7` 的主要历史浏览器 issue。
  - `AI organize`、模板、设置页、分类交互和扩展宿主链路都具备可复跑浏览器证据，不再只停留在零散脚本或旧文档。
  - `npx tsc --noEmit`、`npm test`、`npm run build` 在本轮历史浏览器复验后继续通过。

## R8-QA-01 补齐备份还原与任务详情的浏览器级回放

- 目标：把备份创建 / 命名还原、任务详情实时刷新这两条仍偏“页面存在但缺独立浏览器回放证据”的高风险链路补齐，并继续保持 MCP 优先、独立 Playwright 兜底的口径。
- 范围：
  - 为首页备份弹窗与任务详情页补稳定 `data-testid`，避免新 harness 继续依赖易漂移的文案或布局结构。
  - 新增独立 Playwright 浏览器 harness，覆盖“打开备份弹窗 -> 立即备份 -> 备份列表刷新 -> 从命名备份还原 -> 页面刷新后书签数据恢复”整条链路。
  - 同一条 harness 内补齐任务详情页的实时刷新合同，证明运行中 job 的列表 / 详情会更新进度、消息与最终状态，不只停留在静态页面渲染。
  - 将新 harness 接入统一历史浏览器回放入口，继续作为“当前会话无 MCP server 时”的等价 browser replay；文档里明确这不是伪装成真实 MCP 会话。
- 非目标：
  - 不把 partial-restore 合同扩大到 `snapshots` 或其它业务表。
  - 不恢复仓库内 `e2e/` 为主 gate，也不在本 issue 中要求当前会话必须真的拿到 Playwright MCP server。
- 依赖：`R7-QA-07`、`R1-BE-03`、`R2-REL-03`。
- 验收：
  - 新 browser harness 可以 clean run，证明备份创建、命名还原、任务详情进度刷新三条页面合同成立。
  - `scripts/playwright-issue-regression-validate.ts` 已串入该 harness，历史浏览器回放入口继续可复跑。
  - `npx tsc --noEmit`、`npm test`、`npm run build` 在本轮通过。

## R8-QA-02 补齐任务列表清理与快照批量删除的浏览器级回放

- 目标：把任务列表和快照页里两类高风险 destructive action 补成独立浏览器回放，避免继续只靠路由合同和页面脚本“默认没坏”。
- 范围：
  - 为任务列表的 `清理已完成`、`清空全部` 和快照页的 `全选 / 批量删除 / 单条删除` 补稳定 `data-testid`。
  - 新增独立 Playwright 浏览器 harness，覆盖：
    - 任务列表 `clear-completed`
    - 任务列表 `clear-all`
    - 快照页 `select-all + batch-delete`
  - 验证 UI 侧的确认弹窗、结果刷新、统计数字与数据库 / 文件系统实际结果一致。
  - 将新 harness 接入统一历史浏览器回放入口，继续作为当前会话无 MCP server 时的等价 browser replay。
- 非目标：
  - 不在本 issue 中扩大快照功能范围，不补预览内容比对或下载文件校验。
  - 不恢复仓库内 `e2e/` 为主 gate，也不把当前会话包装成真实 MCP 会话。
- 依赖：`R8-QA-01`、`R7-QA-07`、`R1-BE-03`。
- 验收：
  - 新 browser harness 可以 clean run，证明任务列表清理按钮与快照批量删除在真实浏览器里可操作、可确认、结果正确。
  - `scripts/playwright-issue-regression-validate.ts` 已串入该 harness，历史浏览器回放入口继续可复跑。
  - `npx tsc --noEmit`、`npm test`、`npm run build` 在本轮通过。

## R8-QA-03 补齐导入启动/进度与导出下载的浏览器级回放

- 目标：把首页导入和导出两条仍缺页面级主线的高风险路径补成独立浏览器回放，避免继续只靠路由合同和页面脚本默认正确。
- 范围：
  - 为首页导入表单、导入进度弹层、导出弹层补稳定 `data-testid`。
  - 新增独立 Playwright 浏览器 harness，覆盖：
    - 上传导入文件并启动导入任务
    - 导入进度弹层可见、进度收口、首页书签与分类刷新
    - 导出弹层切换范围 / 格式并触发真实下载
    - 校验导出下载文件名、文件内容与当前数据范围一致
  - 将新 harness 接入统一历史浏览器回放入口，继续作为当前会话有无 MCP 都可复跑的独立 browser replay。
- 非目标：
  - 不在本 issue 中扩展到导出后再次导入的闭环数据比对。
  - 不在本 issue 中恢复仓库内 `e2e/` 为主 gate，也不把本轮回放伪装成真实 MCP gate。
- 依赖：`R8-QA-02`、`R1-BE-03`、`R2-E2E-01`。
- 验收：
  - 新 browser harness 可以 clean run，证明导入启动 / 进度收口与导出下载在真实浏览器里可操作、可确认、结果正确。
  - `scripts/playwright-issue-regression-validate.ts` 已串入该 harness，历史浏览器回放入口继续可复跑。
  - `npx tsc --noEmit`、`npm test`、`npm run build` 在本轮通过。

## R9-QA-01 补齐备份上传还原与备份删除的浏览器级回放

- 目标：把首页备份弹窗里仍缺 browser replay 的“上传 `.db` 还原”和“删除备份”两条高风险链路补齐，避免继续只靠 API 合同和页面壳体选择器判断功能稳定。
- 范围：
  - 为备份上传表单、文件选择、删除确认和列表刷新补齐稳定 `data-testid` 或等价可复跑定位。
  - 新增独立 Playwright 浏览器 harness，覆盖：
    - 上传 `.db` 备份文件并执行 restore
    - restore 成功后的页面刷新与书签 / 分类恢复
    - 删除手动备份并验证列表与磁盘文件同步消失
  - 将新 harness 接入统一历史浏览器回放入口，继续作为当前会话有无 MCP 都可复跑的独立 browser replay。
- 非目标：
  - 不把 partial-restore 合同扩大到 `snapshots`、`settings` 或其它业务表。
  - 不在本 issue 中补坏文件上传、非法文件名等纯 API 错误分支的浏览器化回放。
- 依赖：`R8-QA-01`、`R1-BE-03`。
- 验收：
  - 新 browser harness 可以 clean run，证明上传还原与备份删除在真实浏览器里可操作、可确认、结果正确。
  - `scripts/playwright-issue-regression-validate.ts` 已串入该 harness，历史浏览器回放入口继续可复跑。
  - `npx tsc --noEmit`、`npm test`、`npm run build` 在本轮通过。

## R9-QA-02 补齐快照查看/下载/单条删除与筛选的浏览器级回放

- 目标：把快照页仍缺页面级主线的“搜索 / 日期筛选 -> 查看 -> 下载 -> 单条删除”补成独立浏览器回放，避免继续只靠路由合同和批量删除脚本默认正确。
- 范围：
  - 为快照搜索框、日期筛选、清除筛选、查看 / 下载链接和单条删除确认补稳定 `data-testid` 或等价可复跑定位。
  - 新增独立 Playwright 浏览器 harness，覆盖：
    - 搜索与日期筛选后列表收敛
    - 打开快照查看页并校验页面内容来自目标快照
    - 触发真实下载并校验文件名 / 文件内容
    - 单条删除后的列表刷新、数据库记录与文件系统结果一致
  - 将新 harness 接入统一历史浏览器回放入口，继续作为当前会话有无 MCP 都可复跑的独立 browser replay。
- 非目标：
  - 不在本 issue 中引入像素级视觉比对或新增快照预览 UI。
  - 不把快照 HTML 内容安全治理、下载鉴权或大文件性能优化并入本轮。
- 依赖：`R8-QA-02`、`R1-BE-03`。
- 验收：
  - 新 browser harness 可以 clean run，证明快照查看、下载、筛选与单条删除在真实浏览器里可操作、可确认、结果正确。
  - `scripts/playwright-issue-regression-validate.ts` 已串入该 harness，历史浏览器回放入口继续可复跑。
  - `npx tsc --noEmit`、`npm test`、`npm run build` 在本轮通过。

## R9-QA-03 补齐导入取消、通用任务取消与失败明细分页的浏览器级回放

- 目标：把首页导入进度弹层、顶部当前任务提示和任务详情页里仍偏“接口有合同但缺页面级证据”的取消 / 失败明细链路补成独立浏览器回放，避免出现后端已取消但前端仍假成功、或失败分页只在 API 层正确的漂移。
- 范围：
  - 为当前任务提示、任务详情取消按钮、失败项分页控件和必要状态提示补稳定 `data-testid` 或等价可复跑定位。
  - 新增独立 Playwright 浏览器 harness，覆盖：
    - 首页导入进度弹层取消
    - 顶部当前任务或任务详情页的通用任务取消
    - 失败项分页 / 每页数量切换与内容刷新
  - 将新 harness 接入统一历史浏览器回放入口，继续作为当前会话有无 MCP 都可复跑的独立 browser replay。
- 非目标：
  - 不重复覆盖 AI organize 的 cancel / retry 浏览器合同；那部分已由 `R7-QA-07` 吸收。
  - 不在本 issue 中扩展任务列表 destructive action；`clear-completed` / `clear-all` 已由 `R8-QA-02` 覆盖。
- 依赖：`R8-QA-01`、`R8-QA-03`、`R7-QA-07`。
- 验收：
  - 新 browser harness 可以 clean run，证明导入取消、任务取消与失败明细分页在真实浏览器里可操作、可确认、结果正确。
  - `scripts/playwright-issue-regression-validate.ts` 已串入该 harness，历史浏览器回放入口继续可复跑。
  - `npx tsc --noEmit`、`npm test`、`npm run build` 在本轮通过。

## R10-QA-01 固化仓库内 Playwright 补充冒烟并收口选择器漂移

- 目标：把当前重新引入但仍处于半漂移状态的仓库内 Playwright 套件收口成“可复跑的补充冒烟”，避免它继续以失败噪声或过时选择器的形式干扰风险台账，同时保持 MCP 仍是主浏览器 gate。
- 范围：
  - 修正 `e2e/` 中已过时的 API 假设、文本定位和原生 `dialog` 依赖，对齐当前自定义 `AppDialog` 与页面 `data-testid`。
  - 为仓库内 Playwright 仍需依赖的首页搜索、编辑书签、分类管理等区域补最小稳定选择器。
  - 验证 `playwright.config.ts`、`e2e/auth.setup.ts` 和仓库内 Playwright 冒烟脚本能在临时环境 clean rerun。
- 非目标：
  - 不把仓库内 `e2e/` 恢复为 release gate，也不替代内置 Playwright MCP 历史回放矩阵。
  - 不在本 issue 中扩展新的端到端业务旅程，只收口现有仓库内 Playwright 资产的漂移。
- 依赖：`R9-QA-03`。
- 验收：
  - `npm run test:e2e` 在临时环境下可 clean run。
  - 仓库内 Playwright 的定位和行为合同与当前页面实现一致，不再依赖过时响应结构或原生浏览器确认框。
  - 文档明确该套件是补充冒烟而非主 gate，且本轮完成后 `npx tsc --noEmit`、`npm test`、`npm run build` 继续通过。

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
13. `R3-UI-01`
14. `R3-AI-02`
15. `R3-QA-03`
16. `R4-CLEAN-01`
17. `R4-QA-02`
18. `R5-AI-01`
19. `R5-EXT-02`
20. `R5-EXT-03`
21. `R5-UI-04`
22. `R5-AI-02`
23. `R5-AI-03`
24. `R5-AI-04`
25. `R5-AI-05`
26. `R5-AI-06`
27. `R5-AI-07`
28. `R5-AI-08`
29. `R5-AI-09`
30. `R6-AI-01`
31. `R6-UI-02`
32. `R6-AI-03`
33. `R6-EXT-04`
34. `R6-EXT-05`
35. `R6-TPL-06`
36. `R7-AI-01`
37. `R7-AI-02`
38. `R7-AI-03`
39. `R7-AI-04`
40. `R7-AI-05`
41. `R7-AI-06`
42. `R7-QA-07`
43. `R8-QA-01`
44. `R8-QA-02`
45. `R8-QA-03`
46. `R9-QA-01`
47. `R9-QA-02`
48. `R9-QA-03`
49. `R10-QA-01`
