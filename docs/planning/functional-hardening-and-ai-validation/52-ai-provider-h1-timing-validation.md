# R12-H1-01 真实 AI provider 时序复验记录

更新时间：2026-04-03

关联 issue：

- `R12-H1-01`

## 1. 目标

- 用真实凭证重跑 `H1` provider 验证，而不是沿用 `R15` / `R5` 的历史结论。
- 把 `/api/ai/test`、单条 `classify`、`classify-batch`、`organize` 的时序留痕收成可复跑报告。
- 在不把真实密钥写入仓库的前提下，对 `grok` 与 `current` 两套本地配置同时留证。

## 2. 新增入口

- `scripts/ai-h1-timing-validate.ts`
- `npm run validate:ai-h1-timing`

执行原则：

1. 读取本地 `data/app.db` 中的 `validation_grok_*` 与当前 `ai_*` 设置，不向仓库回写任何真实凭证。
2. 顺序执行 `grok -> current`，不并发发起 AI 请求，避免把 provider 排队 / 限流噪声混入时序结果。
3. 对每个 provider 固定执行：
   - `3x` 直连 `/models`
   - `3x` 直连 `/chat/completions`
   - `3x` `/api/ai/test`
   - `3x` 单条 `/api/ai/classify` for `3` 条 H1 样本
   - `1x` `/api/ai/classify-batch`
   - `1x` `/api/ai/organize` + `apply/rollback`
4. `organize` 在请求返回后以 `100ms` 间隔轮询 `/api/ai/organize/active`、`/api/ai/organize/pending` 与 `/api/ai/organize/:planId`。
5. `active` 只作为 best-effort 瞬态观测；`pending`、`preview` 与 `job = done` 才是必须命中的稳定收口条件。

## 3. 本轮结果

### 3.1 总体结果

- 执行窗口：`2026-04-03 10:43:46 +0800` 到 `2026-04-03 10:53:07 +0800`
- `npm run validate:ai-h1-timing` clean run 通过
- `skippedProviders = 0`
- `failures = 0`
- 本轮本地报告仅写入脱敏 JSON 到 `/tmp`，未纳入仓库：
  - `/tmp/bookmarks-ai-h1-timing-report-20260403_104254.json`
  - `/tmp/bookmarks-ai-provider-diagnose-grok-20260403_104254.json`
  - `/tmp/bookmarks-ai-provider-diagnose-current-20260403_104254.json`
  - `/tmp/bookmarks-ai-h1-grok-20260403_104254.json`
  - `/tmp/bookmarks-ai-h1-current-20260403_104254.json`
  - `/tmp/bookmarks-ai-h1-semantic-grok-20260403_104254.json`
  - `/tmp/bookmarks-ai-h1-semantic-current-20260403_104254.json`

### 3.2 时序摘要

| provider | source | 直连 `/models` | 直连 `/chat/completions` | `3x /api/ai/test` | `3x3 classify` | `classify-batch` | `organize` |
|---|---|---|---|---|---|---|---|
| `grok` | `validation_grok_db` | `44ms` 到 `1020ms`，均值 `454ms` | `1511ms` 到 `4093ms`，均值 `2412ms` | `1301ms` 到 `1497ms`，均值 `1400ms`，全 `200` | `9/9 accepted`；`react-docs` 固定为 `学习资源/文档`，`mdn-web-docs` 在 `学习资源/文档` / `技术开发/前端` 间波动但都在允许集合内，`chatgpt` 固定为 `工具软件/AI` | 请求返回 `60ms`；`preview` 与 `job=done` 同时出现在 `3940ms` | 请求返回 `41ms`；`active=32ms`，`pending/preview/job=done=3862ms`；`apply=200`，`rollback=200` |
| `current` | `settings_db` | `12ms` 到 `23ms`，均值 `16ms` | `1264ms` 到 `2398ms`，均值 `1785ms` | `1260ms` 到 `1358ms`，均值 `1295ms`，全 `200` | `9/9 accepted`；`react-docs` 固定为 `学习资源/文档`，`mdn-web-docs` 在 `技术开发/前端` / `学习资源/文档` 间波动但都在允许集合内，`chatgpt` 固定为 `工具软件/AI` | 请求返回 `15ms`；`preview` 与 `job=done` 同时出现在 `4748ms` | 请求返回 `17ms`；`active=12ms`，`pending/preview/job=done=4144ms`；`apply=200`，`rollback=200` |

### 3.3 基线对照

| 脚本 | `grok` | `current` |
|---|---|---|
| `scripts/ai-provider-diagnose.ts` | `/models = 200`，`modelFound = true`；`/chat/completions = 200` | `/models = 200`，`modelFound = true`；`/chat/completions = 200` |
| `scripts/ai-h1-validate.ts` | `/api/ai/test = 200`；单条 `react-docs -> 学习资源/文档`；`classify-batch = 3/3 accepted`；`organize = 3/3 accepted`；`apply/rollback = 200` | `/api/ai/test = 200`；单条 `react-docs -> 学习资源/文档`；`classify-batch = 3/3 accepted`；`organize = 3/3 accepted`；`apply/rollback = 200` |
| `scripts/ai-h1-classify-semantic-validate.ts` | `9/9 accepted` | `9/9 accepted` |

### 3.4 时序观察

- 两套 provider 都成功观测到瞬态 `active`，分别是 `grok = 32ms`、`current = 12ms`。脚本仍把 `active` 视为 best-effort 信号，不把“未抓到瞬态”直接当成失败条件。
- 两套 provider 都在稳定窗口内命中了 `/pending`、`plan = preview` 和 `job = done`，且 `preview` 没有晚于 `job = done`，因此没有发现 “请求成功但预览状态漂移” 的时序问题。
- `classify-batch` 与 `organize` 的 HTTP 请求本身返回很快，但真实工作发生在后台 job，所以本轮把结论建立在 plan/job 时间线上，而不是只看请求耗时。
- 单条 `/api/ai/classify` 在本轮 `18` 次真实请求中没有出现任何不被接受的分类；唯一观察到的波动是 `mdn-web-docs` 在两个允许分类间切换，属于可接受语义漂移，不构成合同破坏。
- timing 版、旧版 full H1、直连 diagnose 与 `9` 条语义样本集的结论一致，因此本轮没有出现“新脚本假绿”或“只在某一套脚本里通过”的迹象。

## 4. 结论

- `R12-H1-01` 通过。
- `RISK-039` 可以关闭。
- 截至 `2026-04-03`，真实 provider 的 `H1` gate 不再只是历史单次联调，而是已经具备：
  - timing-aware 的可复跑入口
  - `grok/current` 双配置证据
  - 直连 diagnose、full H1 与语义样本的交叉对照
- 后续若切换 `base_url`、`model`、`api_key` 或当前 `ai_*` 设置，必须先复跑：
  - `npm run validate:ai-h1-timing`
  - `npx tsx scripts/ai-h1-classify-semantic-validate.ts --provider current` 或目标 provider

## 5. 清理结论

- timing 脚本、旧版 full H1 与语义样本脚本的临时目录都已在报告中确认 `tempDirCleaned = true`。
- 本轮没有向仓库写入真实凭证、临时 `.env` 或持久测试数据。
- 本轮只留下本地 `/tmp` 下的脱敏 JSON 报告，供后续人工复核使用。
