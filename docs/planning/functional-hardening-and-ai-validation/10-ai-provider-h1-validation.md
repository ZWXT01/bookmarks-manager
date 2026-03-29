# 真实 AI Provider H1 验收记录

更新时间：2026-03-29

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 执行手册](./04-agent-runbook.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 执行信息

- 执行 issue：`R15-H1-04`
- 执行时间：`2026-03-29 02:01:56 +0800` 到 `2026-03-29 02:02:21 +0800`
- 验证脚本：`scripts/ai-h1-validate.ts`
- 固定样本：`docs/planning/functional-hardening-and-ai-validation/fixtures/ai-h1-samples.json`
- provider 来源：本地 `data/app.db` 设置项，未向仓库回写任何真实密钥
- provider 脱敏信息：
  - `base_url`: `https://2c***ce/...`
  - `model`: `deepse***hat`
  - `ai_batch_size`: `30`
  - `timeout_cap_ms`: `20000`
- 清理结果：脚本运行结束后临时工作目录已自动清理，报告中 `tempDirCleaned = true`

## 2. 样本集

- `React 官方文档` `https://react.dev/`
  期望可接受分类：`技术开发/前端` 或 `学习资源/文档`
- `MDN Web Docs` `https://developer.mozilla.org/en-US/`
  期望可接受分类：`学习资源/文档` 或 `技术开发/前端`
- `ChatGPT` `https://chatgpt.com/`
  期望可接受分类：`工具软件/AI`

## 3. 验收结果

- `/api/ai/test`
  - `200`
  - 返回 `success: true`
- `/api/ai/classify`
  - `React 官方文档` 返回 `学习资源/React`
  - 结果不在固定模板允许范围内，判定为“不稳定，需人工复核”
- `/api/ai/classify-batch`
  - `200`
  - plan `preview`，job `done`
  - `assigned = 3`，`needs_review = 0`
  - 输出：
    - `React 官方文档 -> 技术开发/前端`
    - `MDN Web Docs -> 学习资源/文档`
    - `ChatGPT -> 工具软件/AI`
- `/api/ai/organize`
  - `200`
  - plan `preview`，job `done`
  - `assigned = 3`，`needs_review = 0`
  - 预览输出：
    - `React 官方文档 -> 技术开发/前端`
    - `MDN Web Docs -> 学习资源/文档`
    - `ChatGPT -> 工具软件/AI`
- `/api/ai/organize/:planId/apply`
  - `200`
  - `needs_confirm = false`
  - `applied_count = 3`
- `/api/ai/organize/:planId/rollback`
  - `200`
  - `restored_categories = 9`
  - `restored_bookmarks = 3`
  - 回滚后全部样本重新回到未分类状态

## 4. 结论

- 本次真实 provider 联调结论为“可接受、可解释、可回退”。
- `classify-batch` 与 `organize` 在固定 3 条样本上均达到 `3/3` 可接受分类，且 `apply/rollback` 链路完整可演练。
- 单条 `/api/ai/classify` 仍不具备 deterministic contract，本次返回了模板外层级 `学习资源/React`。因此该入口只能视为“辅助建议”，不能把输出直接当成强合同结果。
- 本 issue 验收通过，但单条 classify 的 taxonomy 漂移保留为残余风险，已同步回写到 [风险台账](./06-risk-log.md)。
