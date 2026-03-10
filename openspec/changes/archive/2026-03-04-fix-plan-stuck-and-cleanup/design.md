## Decisions

### D1: Timeout mechanism uses created_at hard cutoff
- `PLAN_TIMEOUT_MS = 7_200_000` (2 hours) 硬编码常量
- 判定字段：`plan.created_at`，不引入 heartbeat/updated_at
- 仅 `designing` 和 `assigning` 状态受超时影响，`preview` 豁免
- 超时清理在 `createPlan()` 事务内执行，不引入后台定时任务
- 理由：50k 书签 ≈ 83 分钟 < 2h，覆盖绝大多数场景；单用户本地应用无需复杂心跳机制

### D2: PlanError 扩展携带 activePlanId
- `createPlan()` 抛出 409 时，`PlanError` 实例新增 `activePlanId` 属性
- 路由层 `POST /api/ai/organize` 的 catch 块读取 `e.activePlanId` 并写入响应体
- 不修改 `PlanError` 类签名，通过 `as any` 动态挂载（保持最小改动）

### D3: transitionStatus 增加 reason 参数
- `transitionStatus(db, planId, target, reason?)` 新增可选 `reason` 参数
- 默认值根据 target 推导：`canceled` → `user_cancel`，`applied` → `user_apply`，`rolled_back` → `user_rollback`，`assigning` → `tree_confirmed`，`preview` → `assignment_complete`，`failed`/`error` → `assignment_failed`
- 调用方可覆盖默认值（如超时清理传 `timeout`）

### D4: 日志写入与状态变更同事务
- `transitionStatus()` 内部已在 `db.transaction()` 中，日志 INSERT 加在状态 UPDATE 之后、return 之前
- `createPlan()` 内部已在 `db.transaction()` 中，超时清理的日志和新 plan 创建的日志都在同一事务

### D5: 前端 409 恢复用 Toast + 面板内按钮
- 不弹 modal，与现有 UI 风格一致
- 收到 409 → 调用 `/active` → 设置 `organizePlan` → 显示恢复面板
- "继续"按钮根据 plan.status 恢复到对应阶段
- "取消并重新开始"按钮调用 cancel → 重新调用 startOrganize()

### D6: GET /api/ai/organize/active 路由注册位置
- 注册在 `GET /api/ai/organize/:planId` 之前，避免 `active` 被当作 `:planId` 参数匹配
- 复用现有的 plan 详情序列化逻辑（JSON.parse target_tree/assignments，删除 backup_snapshot）

## File Changes

| File | Change |
|------|--------|
| `src/db.ts` | 新增 `plan_state_logs` 表 DDL + 索引 |
| `src/ai-organize-plan.ts` | `createPlan()` 超时清理 + 日志写入；`transitionStatus()` 增加 reason 参数 + 日志写入；新增 `getActivePlan()` 导出函数；新增 `PLAN_TIMEOUT_MS` 常量 |
| `src/routes/ai.ts` | 新增 `GET /api/ai/organize/active` 路由；`POST /api/ai/organize` 的 409 响应增加 `activePlanId` |
| `public/app.js` | `startOrganize()` 409 恢复逻辑；新增 `recoverActivePlan()` 方法；新增 `cancelAndRestart()` 方法 |
| `src/routes/types.ts` | 删除 5 个未使用的 helper 函数 |
| `dist/ai-classifier.js` 等 5 个 | 删除 |
| `tests/*.test.js` 等 6 个 | 删除 |
