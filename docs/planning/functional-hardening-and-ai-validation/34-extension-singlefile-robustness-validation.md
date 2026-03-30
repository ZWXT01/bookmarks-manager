# 内置扩展 SingleFile 稳健性验收记录

更新时间：2026-03-30

## 1. 执行信息

- 执行 issue：`R6-EXT-05`
- 执行时间：`2026-03-30 22:38:15 +0800` 到 `2026-03-30 23:03:17 +0800`
- 代码范围：
  - `extension-new/popup.js`
  - `extension-new/content.js`
  - `scripts/extension-runtime-validate.ts`
  - `tests/extension-popup-shell.test.ts`

## 2. 收口目标

- 降低扩展在 SingleFile 快照链路上的脆弱点，避免重复注入、误报成功、按钮卡死和重复提交。
- 让 `save-all` 在明显无法完成快照的场景下先拒绝，而不是先保存书签再留下半成功状态。
- 为不支持页面、目标页失效、timeout 恢复和重复点击建立真实扩展 runtime gate。

## 3. 实现摘要

- `popup.js` 现在会先 ping 现有 capture bridge，只在 bridge 缺失时再注入脚本，避免每次快照都无条件重复注入。
- `save-all()` 现在会在保存书签前先校验目标页与快照 bridge；遇到不支持的页面时会直接拒绝，不再留下“书签已写入、快照必失败”的半成功状态。
- popup 新增了 action lock、目标页支持性判断和更明确的错误归一化，重复点击不会再触发重复提交。
- `content.js` 现在新增了 `pingCapture`、in-flight guard 和 capture timeout；同一页面已有快照任务在执行时会显式拒绝第二次请求。
- `scripts/extension-runtime-validate.ts` 已扩展为真实扩展宿主下的稳健性验收，新增：
  - 不支持页面拒绝
  - 目标页失效
  - timeout 恢复
  - 重复 `save-all` 点击去重

## 4. 验证结果

- `npx tsc --noEmit`
  - 通过
- `npx vitest run tests/extension-popup-shell.test.ts --reporter=verbose`
  - 通过，`1/1` 文件，`4/4` 用例
- `npx tsx scripts/extension-runtime-validate.ts`
  - 通过
  - 关键结果：
    - `unsupportedPageRejected = true`
    - `missingTargetRejected = true`
    - `timeoutRecovered = true`
    - `repeatedSaveAllDeduped = true`
    - `bookmarkCount = 3`
    - `snapshotCount = 3`
    - `tempRootCleaned = true`
- `npm test`
  - 通过，`22/22` 文件，`171/171` 用例
- `npm run build`
  - 通过

## 5. 结论

- 内置扩展的 SingleFile 主链路现在已经具备明确的失败前置校验、超时恢复和重复提交保护，不再依赖模糊的 `lastError` 或手工刷新页面猜状态。
- `save-all` 现在能在明显无法生成快照的场景下先拒绝，不再制造部分成功数据。
- 这轮之后，扩展侧当前没有主要功能合同盲区；后续若升级 SingleFile vendor、改扩展权限或调整注入策略，必须复跑真实 runtime gate。
