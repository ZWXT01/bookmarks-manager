# bookmarks-manager 执行路线图

更新时间：2026-03-28

配套文档：

- [对标分析](./01-reference-analysis.md)
- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 执行手册](./04-agent-runbook.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)
- [Playwright MCP Smoke 基线](./08-playwright-mcp-smoke-baseline.md)

## 1. 文档目标

本路线图用于把“现有项目功能要可靠、测试要闭环、AI 要可验收”落成可执行的交付计划，而不是泛泛的优化建议。

执行留痕约束：

- 若本路线图最终要交给 Code Agent 自动执行，应默认要求每完成一个 issue 至少提交 1 次 Git commit。
- 若当前目录尚未初始化为 Git 仓库，自动执行前必须先创建仓库。
- 当主 issue 队列之外需要逐一排查风险点时，Agent 应切换到风险排查执行模式，并按 [风险台账](./06-risk-log.md) 顺序处理。

## 2. 已确认前提

- 当前项目是单仓库 Fastify + TypeScript + EJS + SQLite 应用，后台任务以内存队列运行，浏览器扩展位于 `extension-new/`。
- 当前代码面已包含书签、分类、导入导出、链接检查、任务队列与 SSE、认证与 API Token、设置页、快照、备份、模板、AI 分类与 AI organize。
- 本地基线结果：
  - `npm test` 于 2026-03-28 通过，13 个测试文件、119 条测试全部通过。
  - `npm run build` 于 2026-03-28 通过。
  - 仓库内 `e2e/` 存在 11 条 Playwright 规格，但按当前约束，本规划不再将项目内 Playwright 作为主验证路径；后续 UI 回归改用内置 Playwright MCP。
- AI 相关自动化目前主要覆盖 `ai-organize-plan` 的状态机与日志，尚未覆盖 `/api/ai/test`、`/api/ai/classify`、`/api/ai/classify-batch`、`/api/ai/organize/*` 的真实 HTTP 合同。

### 2.1 G1 冻结决策

- `ai_simplify`
  - 按历史遗留 / backlog 处理，不纳入本轮 release gate，也不计入当前 API / UI / H1 验收范围。
  - 依据：当前活跃路由面只包含 `classify`、`classify-batch`、`test` 与 `organize`，`ai_simplify` 仅残留在 README、任务页文案、`pages.ts` 变量和 `JobType` 联合类型中。
  - 后续动作：由 `R1-DOC-04` 清理文档和页面遗留表述，必要时保留为显式 backlog，而不是继续假定为现成功能。
- 备份 / 还原合同
  - 本轮先冻结为“显式部分恢复”路线，而不是默认承诺“完整恢复”。
  - 当前保证恢复范围仅为 `categories` 与 `bookmarks`；`settings`、`api_tokens`、`jobs`、`templates`、`snapshots` 元数据和快照文件资产暂不计入保证恢复范围。
  - 依据：当前备份文件仍是整库 `.db`，但 restore 已明确为“校验通过后只事务性替换 `categories` 与 `bookmarks`”，并在变更前创建 `pre_restore_*.db` 回滚点。
  - 当前状态：`R1-BE-03` 已将代码、文档、临时副本演练和回滚路径对齐到显式部分恢复合同，具体施工说明见 [备份 / 还原与快照资产合同](./09-backup-restore-contract.md)。
- 浏览器扩展 release gate
  - `extension-new/` 纳入最终 `R2` release gate，但不作为 `R1` / `R1.5` 的阻塞项。
  - 依据：扩展是当前产品面的一部分，负责 token 配置、保存书签、保存快照和同时保存；若不纳入最终 gate，服务端 contract 无法闭环。
  - 后续动作：在 `R2-EXT-02` 建立 round-trip smoke，并在 `R2-REL-03` 作为正式交付清单的一部分验收。
- UI 验证主路径
  - 当前 UI 验证唯一主路径冻结为内置 Playwright MCP；仓库内 `e2e/` 和 `playwright.config.ts` 仅作为历史资产盘点，不作为 release gate。
  - 依据：当前仓库内存在 3 个 spec 文件、11 条 Playwright 用例，但规划与执行手册已明确后续 UI 验证切换到内置 Playwright MCP。
  - 后续动作：由 `R1-QA-01` 固化 MCP smoke checklist、登录策略、截图 / 断言留痕与清理规则。

## 3. 当前问题或机会

- 自动化测试分布不均衡：书签 / 分类 / 导入 / 检查 / 任务 / 鉴权覆盖较好，但 AI、模板、快照、备份、设置、扩展回路覆盖不足。
- 仓库内 E2E 资产与当前执行策略已经分离；如果继续保留，需要明确其是否只是历史资产，而不是当前 release gate。
- 备份 / 还原合同不清：当前备份是整库文件，但还原实现只回写 `categories` 和 `bookmarks`，快照文件和多张业务表不在明确恢复范围内。
- 快照资产不完整：`snapshots` 表在路由中懒初始化，HTML 快照文件在文件系统中，与数据库备份 / 还原合同分离。
- AI contract 漂移：设置页存在 `ai_batch_size`，但 AI 路由默认只认请求体，配置页与运行时语义不一致。
- 文档 / UI 漂移：README 仍声明 `ai_simplify` 和旧目录结构，`pages.ts` 也保留 simplify 遗留变量，容易误导验收口径。

## 4. 产品定位

`bookmarks-manager` 的合理定位不是“下一代知识平台”，而是：

- 一个单用户优先、自托管优先、可通过浏览器扩展快速收集内容的书签管理器。
- 一个带后台任务、链接检查、快照、模板和 AI 辅助分类能力的轻量运维型应用。
- 一个需要先完成“contract 明确 + 测试闭环 + 文档一致”再考虑扩展产品面的仓库。

## 5. 产品边界

本轮必须覆盖：

- 书签与分类 CRUD、搜索筛选、排序分页、批量移动 / 删除。
- 导入 / 导出、链接检查、任务队列与 SSE。
- 认证、API Token、设置页。
- 模板、AI classify、AI organize、apply / resolve / rollback。
- 快照、备份 / 还原、浏览器扩展保存链路。
- 文档一致性、自动化测试、H1 人工 AI 验收。

本轮明确不做：

- 多租户、团队协作权限、SSO、移动端。
- 向量检索、全文搜索、OCR、RSS、视频归档。
- 新框架重写、分布式任务队列、云产品能力。

## 6. 信息架构

- Web 管理端：
  - 首页书签列表与分类导航。
  - 任务页与任务详情页。
  - 设置页。
  - 快照页。
- API 面：
  - `/api/bookmarks*`
  - `/api/categories*`
  - `/api/check*`
  - `/api/jobs*`
  - `/api/templates*`
  - `/api/ai*`
  - `/api/snapshots*`
  - `/api/backups*`
  - `/api/auth*`、`/api/tokens*`
- 扩展面：
  - `extension-new/` 负责 token 配置、保存书签、保存快照、同时保存两者。
- 运维资产面：
  - SQLite 数据库。
  - `data/backups/` 备份文件。
  - `data/snapshots/` HTML 快照文件。

## 7. 技术架构

- 应用层：Fastify 路由 + EJS 视图 + `public/app.js` 前端交互。
- 领域层：`importer.ts`、`exporter.ts`、`checker.ts`、`category-service.ts`、`template-service.ts`、`ai-organize.ts`、`ai-organize-plan.ts`。
- 后台处理：`jobs.ts` 单进程串行队列 + SSE 广播。
- 持久层：SQLite，主表集中在 `src/db.ts`，但 `snapshots` 目前在路由层初始化，需收敛。
- 外部依赖：
  - OpenAI 兼容 API。
  - 内置 Playwright MCP 所依赖的浏览器自动化能力。
  - 浏览器扩展中的 SingleFile 依赖。

## 8. 数据模型方向

- 核心实体：
  - `bookmarks`
  - `categories`
  - `jobs`
  - `job_failures`
  - `settings`
  - `api_tokens`
- AI / 模板实体：
  - `ai_organize_plans`
  - `plan_state_logs`
  - `category_templates`
  - `template_snapshots`
- 资产实体：
  - `snapshots`
  - 文件系统中的 `snapshots/*.html`
  - 文件系统中的 `backups/*.db`

方向要求：

- 将 `snapshots` schema 收口到统一初始化路径，避免“先访问路由才有表”的隐式行为。
- 明确定义备份 / 还原合同，区分“数据库状态”“文件资产”“临时任务状态”。
- 为 AI 验证补充固定种子数据集和 fixture 响应，避免只靠线上模型输出。

## 9. API 范围

- 核心数据 API：
  - 书签、分类、模板。
- 运维 API：
  - 设置、备份、快照、任务、鉴权、Token。
- 验证 API：
  - 检查任务、任务取消、SSE 进度。
- AI API：
  - 配置测试。
  - 单条分类。
  - 批量分类。
  - organize 生命周期：启动、查询、分页 assignments、apply、resolve、confirm-empty、rollback、cancel、retry。

## 10. 阶段路线图

### G1

目标：冻结本轮真实交付范围和 gate，避免边做边改验收口径。

输出：

- 当前功能覆盖矩阵。
- AI / 备份 / 扩展 / 文档漂移的明确决策。
- [Issue 拆分](./03-issue-breakdown.md) 中 `G1-QA-01` 的完成记录。

通过条件：

- `ai_simplify` 已被冻结为历史遗留 / backlog，不纳入本轮 release gate。
- 备份 / 还原已被冻结为“显式部分恢复”路线。
- `extension-new/` 已被冻结为最终 `R2` release gate 的必验项。

### R1

目标：先把“非 AI 的基础质量面”补齐，包括内置 Playwright MCP 的 UI 验证基线、API 覆盖、备份 / 快照合同、文档一致性。

对应 issue：

- `R1-QA-01`
- `R1-API-02`
- `R1-BE-03`
- `R1-DOC-04`
- `R1-QA-05`

阶段完成标准：

- 基于内置 Playwright MCP 的最小 UI smoke checklist 可以被稳定执行。
- 设置、模板、快照、备份路径有自动化测试。
- 备份 / 还原与快照资产合同写清并落地到测试。
- README 与代码表述一致，不再承诺当前不存在的接口。
- 测试主骨架、辅助工具与冗余占位内容已收口，不再出现第二套并行但未纳管的测试基建。

当前基线补充：

- `R1-QA-01` 已将最小 UI smoke checklist 固化到 [Playwright MCP Smoke 基线](./08-playwright-mcp-smoke-baseline.md)。
- `R1-BE-03` 的备份 / 还原与快照资产施工合同固化到 [备份 / 还原与快照资产合同](./09-backup-restore-contract.md)。

### R1.5

目标：把 AI 路径从“能跑”提升到“可重复验证、可解释失败、可做真实 provider 验收”。

对应 issue：

- `R15-AI-01`
- `R15-AI-02`
- `R15-AI-03`
- `R15-H1-04`

阶段完成标准：

- AI 路由具备 mock/fixture 自动化，不依赖真实网络即可回归。
- AI organize 的 apply / rollback / cross-template 行为有明确合同和测试。
- 真实 provider 的 H1 验收脚本、数据集、记录模板可重复使用。
- `ai_batch_size` 等配置漂移问题被消除或显式下线。

### R2

目标：形成可交付的发布级回归包，包括基于内置 Playwright MCP 的 UI smoke、扩展 smoke、最终回归与交接文档。

对应 issue：

- `R2-E2E-01`
- `R2-EXT-02`
- `R2-REL-03`

阶段完成标准：

- 核心管理路径、运维路径、AI mock 路径进入内置 Playwright MCP smoke。
- 浏览器扩展保存书签 / 快照的回路有 smoke 验收。
- 发布说明、回归矩阵、风险台账均已更新。

## 11. 验收标准

- 构建：
  - `npm run build` 通过。
- 自动化：
  - `npm test` 通过。
  - 基于内置 Playwright MCP 的 UI smoke checklist 通过。
  - AI mock / fixture 套件通过。
- 人工：
  - 真实 AI provider 按 H1 清单完成验收并记录结果。
  - 扩展对临时环境的保存书签 / 快照 smoke 通过。
- 合同：
  - 备份 / 还原范围写清并被测试证明。
  - README、设置页、任务页、接口暴露面一致。
- 留痕：
  - 每个 issue 和风险修复都有独立提交记录。
  - 未解决风险写入 [风险台账](./06-risk-log.md)。

## 12. 风险控制

- 在进入 `R1-BE-03` 前，不对真实数据执行自动还原，默认只在临时副本验证。
- 在进入 `R15-H1-04` 前，不把真实 AI key、base URL、model 写入仓库或文档样例。
- 所有测试、调试和联调结束后，必须清理临时端口、临时进程、MCP 验证产生的临时截图 / 产物、临时数据库和快照文件。
- 任何未在本路线图中明确合同的能力，默认按 [风险台账](./06-risk-log.md) 记录为 `open`，不得以“后续优化”口头带过。
