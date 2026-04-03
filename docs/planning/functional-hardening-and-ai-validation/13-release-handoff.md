# bookmarks-manager 最终回归与交接说明

更新时间：2026-04-03

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)
- [功能覆盖矩阵](./07-functional-baseline-matrix.md)
- [真实 AI 提供方联调与人工验收](./10-ai-provider-h1-validation.md)
- [单条 classify H1 语义复验记录](./24-single-classify-h1-replay-validation.md)
- [单条 classify 超时降级验收记录](./25-single-classify-timeout-fallback-validation.md)
- [AI test 瞬时重试验收记录](./26-ai-test-retry-validation.md)
- [AI provider 直连诊断验收记录](./27-ai-provider-diagnostic-validation.md)
- [设置页 AI 诊断 UI 验收记录](./28-settings-ai-diagnostic-ui-validation.md)
- [Grok 默认 provider 验证与 SSE 兼容验收记录](./29-grok-provider-default-validation.md)
- [Playwright MCP 关键业务旅程验收](./11-playwright-mcp-release-journeys.md)
- [浏览器扩展 round-trip 验收](./12-extension-roundtrip-validation.md)
- [模板编辑后 AI 默认源验收记录](./32-ai-template-source-validation.md)
- [内置扩展 popup UI 验收记录](./33-extension-popup-ui-validation.md)
- [内置扩展 SingleFile 稳健性验收记录](./34-extension-singlefile-robustness-validation.md)
- [预置模板库扩容与切换验收记录](./35-preset-template-library-validation.md)
- [AI organize assigning 单活锁与取消时序验收记录](./36-ai-organize-assigning-lock-validation.md)
- [AI organize 作用域冻结验收记录](./37-ai-organize-scope-freeze-validation.md)
- [AI organize retry 预检与旧失败产物清理验收记录](./38-ai-organize-retry-preflight-validation.md)
- [AI organize 冻结 scope 缺对象 stale 验收记录](./39-ai-organize-frozen-scope-stale-validation.md)
- [AI organize error phase 与 retry 语义验收记录](./40-ai-organize-error-phase-validation.md)
- [AI organize error plan 放弃合同验收记录](./41-ai-organize-error-cancel-validation.md)
- [历史 issue Playwright 浏览器复验记录](./42-playwright-historical-issue-regression-validation.md)
- [备份还原与任务详情浏览器回放验收记录](./43-backup-job-browser-validation.md)
- [任务列表清理与快照批量删除浏览器回放验收记录](./44-jobs-snapshots-browser-validation.md)
- [导入启动与导出下载浏览器回放验收记录](./45-import-export-browser-validation.md)
- [导入取消、通用任务取消与失败明细分页浏览器回放验收记录](./48-job-cancel-failures-browser-validation.md)
- [R10-QA-01 仓库内 Playwright 补充冒烟稳定化验收记录](./49-repo-playwright-supplemental-smoke-validation.md)
- [R11-QA-01 交付前整体功能回归验收记录](./50-delivery-readiness-validation.md)

## 1. 执行信息

- 执行 issue：`R2-REL-03`
- 执行时间：`2026-03-29 16:30:00 +0800` 到 `2026-03-29 16:35:22 +0800`
- 当前发布口径：
  - `npm test`
  - `npm run build`
  - 内置 Playwright MCP UI gate
  - 历史 issue Playwright 浏览器复验矩阵
  - 仓库内 Playwright 补充 smoke（非主 gate）
  - 交付前整体功能回归 gate
  - 备份还原与任务详情浏览器回放
  - 任务列表清理与快照批量删除浏览器回放
  - 导入启动与导出下载浏览器回放
  - 导入取消、通用任务取消与失败明细分页浏览器回放
  - 扩展 popup round-trip harness
  - `H1` 真实 provider AI 验收与单条 classify focused replay

## 2. 最终回归结果

| 项目 | 证据 | 结果 |
|---|---|---|
| 自动化测试 | `npm test` 于 2026-04-03 再次通过，`22` 个测试文件、`192` 条测试全部通过。 | 通过 |
| 构建 | `npm run build` 于 2026-04-03 再次通过。 | 通过 |
| 交付前整体功能回归 gate | [50-delivery-readiness-validation.md](./50-delivery-readiness-validation.md) 已证明 `npm run validate:delivery` clean run 通过，并重新串跑 `tsc`、`npm test`、`build`、仓库内 Playwright `11 passed` 与历史浏览器矩阵 `16` 条脚本。 | 通过 |
| 仓库内 Playwright 补充 smoke | [49-repo-playwright-supplemental-smoke-validation.md](./49-repo-playwright-supplemental-smoke-validation.md) 已证明 `npm run test:e2e` 恢复到 `11 passed`，覆盖首页书签 CRUD、分类导航 / 分类管理，以及搜索 / 快捷键等仓库原生场景；但这套回放仍不作为主 release gate。 | 通过 |
| `R1-DOC-04` 浏览器补验收 | 本地临时环境 `http://127.0.0.1:45577` 通过内置 Playwright MCP 访问 `/login` 与 `/jobs`；标题分别为“登录 - 书签管理器”和“任务列表 - 书签管理器”，`warning/error` 计数为 `0`。 | 通过 |
| MCP 关键业务旅程 | [11-playwright-mcp-release-journeys.md](./11-playwright-mcp-release-journeys.md) 已覆盖登录、首页、设置、模板、快照、备份、任务 / SSE 与 mock AI UI 联动。 | 通过 |
| 历史 issue Playwright 浏览器复验 | [42-playwright-historical-issue-regression-validation.md](./42-playwright-historical-issue-regression-validation.md) + [43-backup-job-browser-validation.md](./43-backup-job-browser-validation.md) + [44-jobs-snapshots-browser-validation.md](./44-jobs-snapshots-browser-validation.md) + [45-import-export-browser-validation.md](./45-import-export-browser-validation.md) + [48-job-cancel-failures-browser-validation.md](./48-job-cancel-failures-browser-validation.md) 已把统一回放入口扩到 `16` 条浏览器脚本，补齐 `R1/R2/R3/R4/R5/R6/R7/R8/R9` 历史 issue 的统一浏览器回放入口。 | 通过 |
| 备份还原 / 任务详情浏览器回放 | [43-backup-job-browser-validation.md](./43-backup-job-browser-validation.md) 已证明“立即备份 -> 命名还原 -> 页面刷新恢复数据”和“任务详情运行中刷新 -> 终态完成”都能在真实浏览器里 clean rerun。 | 通过 |
| 任务列表清理 / 快照批量删除浏览器回放 | [44-jobs-snapshots-browser-validation.md](./44-jobs-snapshots-browser-validation.md) 已证明任务列表的 `清理已完成 / 清空全部` 与快照页 `全选 / 批量删除` 在真实浏览器里都可确认、可刷新、且数据库与文件系统结果一致。 | 通过 |
| 导入启动 / 导出下载浏览器回放 | [45-import-export-browser-validation.md](./45-import-export-browser-validation.md) 已证明首页上传导入、进度收口、首页刷新，以及 `all/html`、`uncategorized/json` 下载都能在真实浏览器里 clean rerun；同时还补了一轮 Playwright MCP 页面级复验。 | 通过 |
| 导入取消 / 通用任务取消 / 失败明细分页浏览器回放 | [48-job-cancel-failures-browser-validation.md](./48-job-cancel-failures-browser-validation.md) 已证明首页顶部当前任务取消、导入进度取消、任务详情取消，以及失败明细翻页 / 页大小切换都能在真实浏览器里 clean rerun；同轮还补了一轮 Playwright MCP 页面级复验。 | 通过 |
| 浏览器扩展 round-trip | [12-extension-roundtrip-validation.md](./12-extension-roundtrip-validation.md) 已 clean run，覆盖 token、保存书签、保存快照、同时保存与失败提示。 | 通过 |
| 内置扩展 popup UI | [33-extension-popup-ui-validation.md](./33-extension-popup-ui-validation.md) 已证明 popup 的主操作层级、设置区摘要、状态卡和真实运行时成功 / 失败反馈都已经收口，且不回退既有书签 / 快照主链路。 | 通过 |
| 内置扩展 SingleFile 稳健性 | [34-extension-singlefile-robustness-validation.md](./34-extension-singlefile-robustness-validation.md) 已证明不支持页面、目标页失效、timeout 恢复和重复 `save-all` 点击都能给出可恢复反馈，并避免重复数据或半成功状态。 | 通过 |
| `H1` 真实 provider AI 验收 | [10-ai-provider-h1-validation.md](./10-ai-provider-h1-validation.md) 已完成历史 `test`、`classify-batch`、`organize`、`apply/rollback`；[29-grok-provider-default-validation.md](./29-grok-provider-default-validation.md) 又证明默认 Grok 源下的 full H1 已恢复全绿。 | 通过 |
| `/api/ai/test` 瞬时重试与可操作诊断 | [26-ai-test-retry-validation.md](./26-ai-test-retry-validation.md) 已证明本地 timeout-retry 合同成立；[29-grok-provider-default-validation.md](./29-grok-provider-default-validation.md) 又证明默认 Grok 源下 `/api/ai/test` 已恢复 `200`。 | 通过 |
| provider 直连诊断 | [27-ai-provider-diagnostic-validation.md](./27-ai-provider-diagnostic-validation.md) 曾把问题收口到 chat completion 链路；[29-grok-provider-default-validation.md](./29-grok-provider-default-validation.md) 又证明修正后的默认 Grok 源在 `/models` 与 `/chat/completions` 上都返回 `200`，且 chat completion 为 `text/event-stream`。 | 通过 |
| 设置页 AI 诊断 UI | [28-settings-ai-diagnostic-ui-validation.md](./28-settings-ai-diagnostic-ui-validation.md) 已证明设置页在真实浏览器中能同时展示成功态和 `models_ok=true` 的 timeout 诊断态，操作员不必再只靠 toast 或 network 面板。 | 通过 |
| 多待应用 organize plan 合同 | [30-organize-apply-contract-validation.md](./30-organize-apply-contract-validation.md) 已证明同模板不重叠可直接 apply、同模板重叠进入显式冲突解决、跨模板继续按模板快照隔离 apply。 | 通过 |
| AI organize assigning 单活锁与取消时序 | [36-ai-organize-assigning-lock-validation.md](./36-ai-organize-assigning-lock-validation.md) 已证明 start / retry 现在共用 `assigning` 单活锁，canceled in-flight plan 不会在 provider 返回后继续写 stale preview，新 plan 也能在 cancel 后正常 preview。 | 通过 |
| AI organize 作用域冻结 | [37-ai-organize-scope-freeze-validation.md](./37-ai-organize-scope-freeze-validation.md) 已证明 organize plan 会冻结 `scope_bookmark_ids`，failed plan retry 前新增的书签不会被吸入原计划，prompt 和 job total 也只反映原始冻结集合。 | 通过 |
| AI organize retry 预检与旧失败产物清理 | [38-ai-organize-retry-preflight-validation.md](./38-ai-organize-retry-preflight-validation.md) 已证明 failed plan retry 会先校验 AI 配置，且在进入 `assigning` 时清掉旧失败 assignments / diff / 计数，不再暴露陈旧 preview 数据。 | 通过 |
| AI organize 冻结 scope 缺对象 stale 合同 | [39-ai-organize-frozen-scope-stale-validation.md](./39-ai-organize-frozen-scope-stale-validation.md) 已证明 worker 发现冻结 scope 缺对象时会直接把 plan 打成 stale `error`，不会静默缩水后继续 preview；assigning 阶段的致命异常也不再留下假活跃 plan。 | 通过 |
| AI organize error phase 与 retry 语义 | [40-ai-organize-error-phase-validation.md](./40-ai-organize-error-phase-validation.md) 已证明 missing plan 的 retry 会优先返回 `404`，recoverable `error` plan 可重新进入 `assigning`，且详情响应与首页 phase machine 都能正确展示 `error` message。 | 通过 |
| AI organize error plan 放弃合同 | [41-ai-organize-error-cancel-validation.md](./41-ai-organize-error-cancel-validation.md) 已证明 `error` plan 现在可以被显式取消，且首页 modal 不会再在非 `2xx` 时误报“已取消”；取消后 plan 进入 `canceled`，原 failed job 留痕保持不变。 | 通过 |
| 模板编辑弹窗长树可达性 | [31-template-editor-modal-validation.md](./31-template-editor-modal-validation.md) 已证明模板选择 / 编辑弹窗在小视口和长树场景下都保持显式视口边界，且滚到底部后保存 / 取消仍可直接点击。 | 通过 |
| 模板编辑后 AI 默认源 | [32-ai-template-source-validation.md](./32-ai-template-source-validation.md) 已证明默认单条 `classify`、`classify-batch` 与 `organize` 都跟随最新活动模板，显式 `template_id` 继续隔离，assigning 中途改模板会让旧 preview 明确 stale。 | 通过 |
| 预置模板库扩容与切换 | [35-preset-template-library-validation.md](./35-preset-template-library-validation.md) 已证明模板库里可以直接基于预置模板创建自定义副本或创建后立即应用，且首页导航、分类管理和 AI 默认候选分类会同步切换到最新活动模板。 | 通过 |
| 单条 classify 语义择优 | [22-single-classify-semantic-validation.md](./22-single-classify-semantic-validation.md) 已补齐本地语义 rerank、样本回归和 `description` 上下文。 | 通过 |
| 单条 classify 样本集 gate | [23-single-classify-sample-gate-validation.md](./23-single-classify-sample-gate-validation.md) 已固化固定样本集、复验脚本和 `npm test` 自动化入口。 | 通过 |
| 单条 classify focused H1 replay | [24-single-classify-h1-replay-validation.md](./24-single-classify-h1-replay-validation.md) 记录了旧 provider 的 timeout 基线；[25-single-classify-timeout-fallback-validation.md](./25-single-classify-timeout-fallback-validation.md) 证明过 timeout fallback；[29-grok-provider-default-validation.md](./29-grok-provider-default-validation.md) 则证明默认 Grok 源下 focused replay 已恢复到 `1/1`。 | 通过 |

## 3. 发布级结论

- 代码侧与离线 gate 仍然闭环，可交接给后续维护者继续在现有 taxonomy / semantic contract 上维护。
- `R11-QA-01` 已把当前 deterministic gate 串成 `npm run validate:delivery`，所以本轮交付结论不再只依赖“历史上各自跑过”的零散证据，而是有一条可直接复跑的交付前总入口。
- `R1-DOC-04` 的历史阻塞已解除，文档 / 页面漂移不再是发布阻塞项。
- 当前风险台账中已无 `open + blocked` 的遗留项，`RISK-001` 也已在默认 Grok provider 验证源下关闭。
- 2026-04-02 复盘后新增的 3 条浏览器合同残余 `R9-QA-01`、`R9-QA-02` 与 `R9-QA-03` 现已全部收口；当前风险台账中不再保留这批页面合同的未闭环项。
- 多待应用 organize plan 现在不再依赖“只有最新 plan 能应用”的隐式规则；同模板不重叠、同模板重叠、跨模板三类 apply 路径都已有明确合同和自动化证明。
- AI organize 的 `assigning` 阶段现在也不再存在“start 被拦住、retry 却能绕过单活锁”或“cancel 后旧 provider 响应把 preview 写回来”的时序裂缝；start / retry 共用单活锁，cancel 后旧 plan 只会停在 `canceled`。
- AI organize 的作用域现在也不再是 live 的：plan 创建时就会冻结 `scope_bookmark_ids`，所以 failed plan retry 不会再把后来新增到 `all / uncategorized / category:N` 的书签吸进原计划。
- AI organize 的 retry 入口现在也不会再制造“状态已经回到 `assigning`，但其实没配置 AI、什么都没跑”的假成功；retry 期间任务详情页也不会继续展示旧失败 preview。
- AI organize 的冻结 scope 现在也不会在执行时静默缩水了：如果 scope 里的书签在 worker 真正运行前已经缺失，plan 会明确落到 stale `error`，而不是只处理剩余对象继续给出 preview。
- AI organize 的 `error` phase 现在也有明确产品语义：missing plan / invalid status 的 retry 不会再被配置错误盖住，recoverable `error` plan 可以直接重试，首页 modal 和任务详情页也都能看见中断原因，不会再卡在 `assigning`。
- AI organize 的 `error` plan 现在也能真正“放弃”了：状态机允许 `error -> canceled`，首页 modal 的取消动作只会在后端确认成功时关闭，不再出现服务端拒绝但前端误报成功的假交互。
- 历史 issue 里有浏览器表面的主合同现在也不再散落在多份旧验收记录中；`scripts/playwright-issue-regression-validate.ts` 已把 release journeys、分类导航 / 交互、设置页 AI 诊断、模板长树、预置模板、AI organize UI、扩展 round-trip / runtime / action popup 串成统一 clean rerun 入口。
- 首页备份弹窗与任务详情页现在也不再只是“有页面、有路由测试”；`scripts/backup-job-browser-validate.ts` 已把备份创建 / 命名还原和任务详情运行中刷新收口成独立浏览器回放，并接回统一历史回放入口。
- 任务列表的 `清理已完成 / 清空全部` 与快照页的 `全选 / 批量删除` 现在也不再只是“后端接口有合同”；`scripts/jobs-snapshots-browser-validate.ts` 已把确认弹窗、页面刷新、数据库结果和快照文件清理收口成独立浏览器回放，并接回统一历史回放入口。
- 首页导入与导出现在也不再只是“表单和接口都在”；`scripts/import-export-browser-validate.ts` 已把上传导入、进度收口、首页刷新和导出下载收口成独立浏览器回放，并接回统一历史回放入口；同轮还用 Playwright MCP 补验了首页导入控件和导出弹层的页面可达性。
- 首页顶部当前任务、导入进度弹层和任务详情页的取消动作现在也不再只是“路由和壳体都在”；`scripts/job-cancel-failures-browser-validate.ts` 已把顶部当前任务取消、导入取消、任务详情取消和失败明细分页收口成独立浏览器回放，并接回统一历史回放入口；同轮还用 Playwright MCP 补验了取消请求与失败分页的真实页面收口。
- 仓库内 `e2e/` 与 `playwright.config.ts` 现在也不再是“有人加回来了但跑不通”的漂移资产；`R10-QA-01` 已把它们收口为可 clean rerun 的补充 smoke，首页搜索、书签编辑、分类管理和自定义 `AppDialog` 的当前合同都已有仓库原生 Playwright 证据，但这条链路仍不替代 MCP 主 gate。
- 模板选择 / 编辑弹窗现在不再依赖静态 Tailwind 产物里不稳定的任意值高度类名；长树和小视口下的保存 / 取消按钮都已有浏览器级可达性证明。
- 模板编辑后的默认 AI 入口也已和活动模板树统一：默认单条 `classify`、`classify-batch`、`organize` 不再读 live categories 漂移值；显式 `template_id` 保持隔离，assigning 中途改模板时旧 preview 会被明确判 stale。
- 预置模板库现在不再只有少数通用模板；内置模板已扩到 8 套，模板库里也可以直接创建自定义副本或创建并应用，首页导航、分类管理和 AI 默认候选分类会随活动模板一起切换。
- 内置扩展 popup 现在不再只是“功能能跑”的工程面板；主操作、设置区和状态反馈已经有明确层级，真实 runtime 已证明成功 / 失败 / loading 状态和按钮恢复都能稳定工作。
- 内置扩展的 SingleFile 主链路现在也不再依赖“失败了再看 lastError 猜原因”；不支持页面、目标页丢失、处理超时和重复点击都已经有明确错误提示、按钮恢复和去重保护，`save-all` 还会在保存书签前先拒绝必然失败的快照场景。
- 单条 `/api/ai/classify` 已从“只保证模板内输出”继续收口到“对常见文档 / 教程 / 示例 / 社区 host 场景也有本地 deterministic 语义择优”。
- 单条 `/api/ai/classify` 现在还具备固定语义样本集与 focused H1 replay 脚本；模板调整或 provider / model 切换后不再需要靠零散手工样本复测。
- 默认 provider 验证源现已固定为本地 `validation_grok_*`，且脚本默认走 `grok`；若要验证当前应用设置而不是默认 Grok，必须显式传 `--provider current`。
- Grok 当前以 `text/event-stream` 返回 completion；AI client、single classify 与 organize 现在都已兼容这类 SSE `delta.content` 响应，并会清理 `<think>...</think>` 噪音。
- 设置页仍会把 AI 诊断直接展示给操作员；当前主要注意事项已从“默认 provider 不稳定”切换为“若手工切 provider / endpoint，必须重新按当前源复验”。

## 4. 已收口风险

| risk_id | 状态 | 说明 |
|---|---|---|
| `RISK-001` | resolved | 默认 Grok provider 验证源已固定到 `validation_grok_*`，真实 direct diagnose、focused H1 和 full H1 都已恢复绿色；后续只需在手工切换 provider / endpoint 时显式传 `--provider current` 重新复验。 |
| `RISK-017` | resolved | organize apply 合同已明文化并进入自动化：同模板不重叠直接 apply，同模板重叠必须显式 resolve / needs_review，跨模板继续按模板快照隔离 apply。 |
| `RISK-018` | resolved | 模板选择 / 编辑弹窗已改成显式视口高度边界和固定头尾布局，并新增页面壳体与浏览器级长树可达性回归，不再出现“弹窗越长，保存 / 取消越看不见”的问题。 |
| `RISK-019` | resolved | 默认单条 `classify`、`classify-batch` 与 `organize` 现在都跟随最新活动模板；显式 `template_id` 继续隔离，assigning 中途改模板时旧 preview 会被判 stale，不再把旧模板结果伪装成新模板输出。 |
| `RISK-020` | resolved | 内置扩展 popup 已补齐主操作层级、设置区摘要、成功 / 失败 / loading 状态卡和按钮 busy / 恢复反馈；真实扩展 runtime 与 shell test 都已覆盖，不再停留在“能用但不好用”的工程态。 |
| `RISK-021` | resolved | 内置扩展快照链路现在会先检查目标页与 capture bridge，并显式处理不支持页面、目标页失效、timeout 恢复和重复点击；真实 runtime 已证明不会再轻易出现按钮卡死、重复提交或 save-all 半成功。 |
| `RISK-022` | resolved | 预置模板库已扩到 8 套，并补齐了模板库里的“创建副本 / 创建并应用”路径；真实浏览器已证明首页导航、分类管理和 AI 默认候选分类会跟随最新活动模板一起切换。 |
| `RISK-023` | resolved | AI organize 的 start / retry 现在共用 `assigning` 单活锁，cancel 后的 in-flight provider 响应也不会再把 stale preview 写回数据库；对应定向与全量回归已在 2026-03-31 clean run 通过。 |
| `RISK-024` | resolved | AI organize 现在会冻结 plan 的书签作用域，failed plan retry 不会再重新读取 live scope 把后来新增的书签吸进原计划；对应 unit、integration、全量回归和 build 已在 2026-03-31 clean run 通过。 |
| `RISK-025` | resolved | AI organize retry 现在会先做 AI 配置预检，并在进入 `assigning` 时清掉旧失败产物；不会再出现“缺配置假成功”或 retry 阶段继续暴露旧 preview 数据。 |
| `RISK-026` | resolved | AI organize worker 现在会在冻结 scope 缺对象时把 plan 显式打成 stale `error`，并同步把 job 标成 `failed`；不会再静默缩小处理集合，也不会在 assigning 致命异常后残留假活跃 plan。 |
| `RISK-027` | resolved | AI organize 的 `error` plan 现在具备明确的 retry 合同、错误优先级和前端 phase 展示；missing plan retry 不会再先报配置错误，首页 modal 也不会再在 `error` plan 上卡在 `assigning`。 |
| `RISK-028` | resolved | AI organize 的 `error` plan 现在可以被显式取消，首页 modal 的“放弃”动作不会再在服务端拒绝时误报成功；取消后 plan 进入 `canceled`，原 failed job 留痕保持不变。 |
| `RISK-029` | resolved | 历史 issue 的浏览器级主合同现在已有统一 clean rerun 入口；扩展 popup 文案漂移也已被浏览器矩阵吸收，不再需要靠零散旧脚本和旧文档拼接。 |
| `RISK-030` | resolved | 首页备份弹窗与任务详情页现在都已有独立浏览器回放，能直接证明“立即备份 -> 命名还原 -> 页面刷新恢复数据”和“运行中详情 -> 终态完成”的真实页面合同。 |
| `RISK-031` | resolved | 任务列表 `清理已完成 / 清空全部` 与快照页 `全选 / 批量删除` 现在都已有独立浏览器回放，能直接证明确认弹窗、页面刷新、数据库结果与文件删除保持一致。 |
| `RISK-032` | resolved | 首页导入与导出现在都已有独立浏览器回放，能直接证明上传导入、进度收口、首页刷新，以及 `all/html`、`uncategorized/json` 下载合同成立；同轮还补了 Playwright MCP 页面级复验。 |
| `RISK-033` | resolved | 首页备份弹窗现在已补齐上传 `.db` 还原与手动备份删除的独立浏览器回放，能直接证明 multipart 上传、成功提示、页面刷新恢复书签 / 分类，以及删除后的列表刷新与磁盘文件清理保持一致；同轮还补了 Playwright MCP 页面级复验。 |
| `RISK-034` | resolved | 快照页现在已补齐搜索 / 日期筛选、单条查看、真实下载和单条删除的独立浏览器回放，能直接证明筛选收敛、目标文件内容、下载链接合同，以及删除后的列表 / 数据库 / 文件系统结果保持一致；同轮还补了 Playwright MCP 页面级复验。 |
| `RISK-035` | resolved | 首页顶部当前任务取消、导入进度取消、任务详情取消和失败明细分页现在已补齐独立浏览器回放，能直接证明取消请求、状态收口、翻页与页大小切换在真实页面里保持一致；同轮还补了 Playwright MCP 页面级复验。 |
| `RISK-036` | resolved | 仓库内 `e2e/` 与 `playwright.config.ts` 现已收口为可 clean rerun 的补充 smoke；旧 API 响应结构、过时文本定位和原生 `dialog` 假设都已对齐到当前实现，`npm run test:e2e` 恢复为 `11 passed`，但主 UI gate 仍保持为内置 Playwright MCP。 |

## 5. 交接说明

- UI gate 仍以内置 Playwright MCP 为主；`R7-QA-07`、`R8-QA-01`、`R8-QA-02`、`R8-QA-03`、`R9-QA-01`、`R9-QA-02`、`R9-QA-03` 继续扩展的 `scripts/playwright-issue-regression-validate.ts`、`scripts/backup-job-browser-validate.ts`、`scripts/backup-upload-delete-browser-validate.ts`、`scripts/jobs-snapshots-browser-validate.ts`、`scripts/snapshot-browse-download-browser-validate.ts`、`scripts/import-export-browser-validate.ts`、`scripts/job-cancel-failures-browser-validate.ts` 是历史 issue 与高风险页面合同的补充 browser replay；`R10-QA-01` 又把仓库内 `e2e/` 和 `playwright.config.ts` 收口为补充 smoke，可用于仓库原生交互复跑，但两者都不等于恢复仓库内 Playwright 为主 gate。
- 当前 deterministic 交付前总入口是 `npm run validate:delivery`；若后续继续改用户可见页面、仓库内 Playwright 冒烟、历史浏览器 harness 或扩展 runtime，应优先复跑这条总入口，再按变更面补定向脚本。
- 截至 2026-04-02，这一轮补录的浏览器合同残余已全部收口；若后续继续改首页任务 banner、导入进度弹层、任务详情取消或失败分页脚本，应直接在 `scripts/job-cancel-failures-browser-validate.ts` 上继续追加场景，而不是再散落到新的临时脚本。
- AI 凭证继续只通过设置页写入本地环境；真实 `base_url`、`api_key`、`model` 不进入仓库、日志或文档样例。
- 备份还原继续维持 partial-restore 合同，只恢复 `categories` 与 `bookmarks`，并保留 `pre_restore_*.db` 回滚点。
- 扩展当前使用 `category_id` 提交分类，并以下拉完整路径展示分类；后续不要回退到按分类名提交。
- 扩展当前在 `save-all` 前会先校验快照环境；如果后续改动 `popup.js`、`content.js`、SingleFile vendor 或扩展权限，必须先复跑 `tests/extension-popup-shell.test.ts`、`scripts/extension-runtime-validate.ts`、`npm test` 与 `npm run build`。

## 6. 复跑入口

| 范围 | 入口 |
|---|---|
| 自动化回归 | `npm test` |
| 构建验证 | `npm run build` |
| 交付前整体功能回归 | `npm run validate:delivery` |
| 单条 classify 语义回归 | `npm test -- tests/ai-classify-guardrail.test.ts tests/integration/ai-routes.test.ts tests/integration/ai-harness.test.ts` |
| 单条 classify 样本集 gate | `npx tsx scripts/ai-classify-semantic-validate.ts` |
| 单条 classify H1 focused replay | `npx tsx scripts/ai-h1-classify-semantic-validate.ts --ids react-reference-docs`；默认走 Grok，若要验证当前应用设置可加 `--provider current`；若要隔离 `/api/ai/classify` 本身，可加 `--skip-test` |
| provider 直连诊断 | `npx tsx scripts/ai-provider-diagnose.ts --report /tmp/bookmarks-ai-provider-diagnose.json`；默认走 Grok，若要验证当前应用设置可加 `--provider current` |
| 真实 AI `H1` 全量 | `npx tsx scripts/ai-h1-validate.ts`；默认走 Grok，若要验证当前应用设置可加 `--provider current` |
| 设置页 AI 诊断 UI | `npx tsx scripts/settings-ai-diagnostic-validate.ts` |
| MCP UI gate | `npx tsx scripts/playwright-mcp-smoke-env.ts` 启动临时服务，再按 [08](./08-playwright-mcp-smoke-baseline.md) 与 [11](./11-playwright-mcp-release-journeys.md) 用内置 Playwright MCP 复跑 |
| 历史 issue 浏览器复验 | `npx playwright install chromium` 后执行 `npx tsx scripts/playwright-issue-regression-validate.ts` |
| 仓库内 Playwright 补充 smoke | `npm run test:e2e` |
| 备份还原 / 任务详情浏览器回放 | `npx tsx scripts/backup-job-browser-validate.ts` |
| 备份上传还原 / 备份删除浏览器回放 | `npx tsx scripts/backup-upload-delete-browser-validate.ts` |
| 任务列表清理 / 快照批量删除浏览器回放 | `npx tsx scripts/jobs-snapshots-browser-validate.ts` |
| 快照查看 / 下载 / 单条删除浏览器回放 | `npx tsx scripts/snapshot-browse-download-browser-validate.ts` |
| 导入启动 / 导出下载浏览器回放 | `npx tsx scripts/import-export-browser-validate.ts` |
| 导入取消 / 通用任务取消 / 失败明细分页浏览器回放 | `npx tsx scripts/job-cancel-failures-browser-validate.ts` |
| 扩展 round-trip | `npx tsx scripts/extension-roundtrip-validate.ts` |
| 真实 AI `H1` | 按 [10](./10-ai-provider-h1-validation.md) 的步骤，用人工提供的临时凭证复跑，结束后清理临时环境 |

## 7. 清理结论

- 本次 `R1-DOC-04` 本地 MCP 补验收使用的临时目录 `/tmp/bookmarks-mcp-smoke-Ni4Vb8` 已确认删除。
- 本次 `R5-AI-04` focused H1 replay 使用的临时目录已在报告中确认 `tempDirCleaned = true`，未遗留临时 DB 或后台验证进程。
- 本次 `R5-AI-05` focused H1 replay fallback 验收同样确认 `tempDirCleaned = true`，未遗留临时 DB 或后台验证进程。
- 本次 `R5-AI-06` 验证中曾遇到根分区 `ENOSPC`，已清理用户本地生成的 `~/.npm` 缓存和仓库内可重建的 `dist/` 后恢复执行；focused H1 replay 结束后未遗留临时 DB 或后台验证进程。
- 本次 `R5-AI-07` direct diagnose 只写出脱敏 JSON 报告，不创建临时 DB；focused H1 replay 同样确认 `tempDirCleaned = true`。
- 本次 `R5-AI-08` 设置页浏览器 harness 使用 `createTestApp()` 临时环境和 headless Chrome，退出后已清理临时目录与会话环境。
- 本次 `R5-AI-09` 的默认 Grok direct diagnose、focused H1 和 full H1 都在报告中确认 `tempDirCleaned = true` 或无临时 DB；未遗留后台验证进程。
- 本次 `R7-QA-07` 历史 issue 浏览器复验使用的 `createTestApp()` 临时环境、扩展 popup-harness / runtime 临时目录和 action popup fixture 环境都已在各脚本输出中确认清理；唯一新增前置是 Playwright Chromium 二进制缓存 `/home/human/.cache/ms-playwright/chromium-1208`，它属于后续复跑所需依赖，不是脏测试产物。
- 本次 `R8-QA-01` 备份还原 / 任务详情浏览器回放同样基于 `createTestApp()` 临时环境，定向脚本与统一历史浏览器回放都已在退出时清理临时目录与测试数据。
- 本次 `R8-QA-02` 任务列表清理 / 快照批量删除浏览器回放同样基于 `createTestApp()` 临时环境；定向脚本与统一历史浏览器回放都已在退出时清理临时目录、测试数据和快照文件。
- 本次 `R8-QA-03` 导入启动 / 导出下载浏览器回放同样基于 `createTestApp()` 临时环境；定向脚本、统一历史浏览器回放与额外的 Playwright MCP smoke 环境都已在退出时清理临时目录、测试数据与后台进程。
- `R2-REL-03` 本轮未遗留额外测试服务、端口、临时二进制或测试数据。
