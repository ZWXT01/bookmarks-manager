# Tests Layout

当前仓库只保留一套正式的 Vitest 主路径：

- `tests/*.test.ts`
  纯函数、服务层或小范围回归测试。优先使用 `tests/helpers/db.ts` 构造临时数据库，不直接引入整站 app。
- `tests/integration/*.test.ts`
  HTTP 合同、鉴权、任务队列和运维面接口测试。统一使用 `tests/helpers/app.ts`、`tests/helpers/auth.ts` 和 `tests/helpers/factories.ts`。
- `tests/helpers/globals.ts`
  由 `vitest.config.ts` 自动加载，用于在每个用例前后重置鉴权状态、任务运行时和临时目录。

约束：

- 新的 app 级测试不要再复制 `.env`、登录、临时目录或 job queue 清理逻辑，统一走 `createTestApp()`。
- 新的夹具、种子数据和通用断言优先放到 `tests/helpers/`，不要在单个 spec 内再复制一份。
- 已被 `tests/integration/` 覆盖的旧轻量 route spec 应删除，而不是继续并行维护。
- UI 验证当前统一走内置 Playwright MCP 和 `scripts/*validate.ts` 浏览器回放脚本，不再维护仓库内独立 Playwright 套件。
