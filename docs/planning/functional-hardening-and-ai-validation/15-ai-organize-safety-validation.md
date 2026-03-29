# bookmarks-manager AI organize 数据安全验收

更新时间：2026-03-29

关联文档：

- [Issue 拆分](./03-issue-breakdown.md)
- [Agent 进度台账](./05-agent-status.md)
- [风险台账](./06-risk-log.md)

## 1. 执行信息

- 执行 issue：`R3-AI-02`
- 执行时间：`2026-03-29 17:35:28 +0800` 起
- 验证入口：
  - `npm test -- tests/integration/ai-organize-routes.test.ts`
  - `npx tsc --noEmit`
  - `npm test`
  - `npm run build`

## 2. 收口内容

- `ai_organize_plans` 新增 `source_snapshot`，在 preview 生成完成时固化书签集合、目标模板快照和同模板 live target category 指纹。
- `applyPlan` / `resolveAndApply` 不再对缺失 target path 做 `getOrCreateCategoryByPath()` 式自动重建；目标分类漂移会直接返回 `409`。
- preview 生成后如果书签被删除、被移动到别的分类、目标模板变更、目标分类路径变更，或存在更新的重叠 preview/applied plan，旧 plan 会被显式判定为 stale。
- 普通编辑仍保留原有 conflict / override 合同，不会因为单纯 `updated_at` 变化就提前把所有计划一刀切判死。
- `resolve` 阶段也补了缺失对象 guardrail，避免第一次 apply 之后再被静默跳过。

## 3. 回归覆盖

`tests/integration/ai-organize-routes.test.ts` 现在覆盖：

- 书签在 preview 后被删除
- 书签分类漂移但 `updated_at` 不变
- 目标分类被重命名后旧 path 不再被自动重建
- 重叠书签集合的旧 preview 被更新 preview 明确失效
- 目标模板在 preview 后被修改
- 第一次 apply 进入 conflict 后，resolve 前书签被删除

同时保留并复用既有用例，继续覆盖：

- live-template apply / confirm-empty / rollback
- conflict override
- cross-template apply / rollback
- retry / cancel / expired rollback guardrail

## 4. 验证结果

定向 organize route 合同验证通过：

```text
tests/integration/ai-organize-routes.test.ts 13 passed
```

全量验证通过：

```text
npx tsc --noEmit
npm test 16/16 files, 142/142 tests
npm run build
```

## 5. 结论

- AI organize 当前已经有明确的 stale / conflict / resolve 合同，不再允许旧 plan 在目标对象漂移后静默写数据。
- 多 plan 共存时，“更新且重叠的 preview / applied plan 优先，旧 plan 失效” 的规则已经落成自动化。
- 升级前遗留、且尚未携带 `source_snapshot` 的旧 preview plan 现在会被拒绝应用；如用户仍要继续，应重新发起 organize 生成新 preview。
