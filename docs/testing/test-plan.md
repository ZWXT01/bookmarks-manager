# 测试方案（Bookmarks Manager）

本文档目标：给出一套可落地的全量测试方案，分为**机器测试**（自动化）与**人工测试**（补足自动化盲区），并显式考虑“功能时序/并发/数据状态”对结果的影响。

> 现状确认（2026-03-01）：`npm test`（Vitest）与 `npm run build`（tsc）在本仓库本地执行通过。

---

## 1. 测试范围与功能清单

系统形态：Fastify + TypeScript + SQLite（better-sqlite3）+ EJS/静态资源 + 浏览器扩展（`extension-new/`）。

### 1.1 功能模块（面向用户）
- 认证与安全：登录/登出、修改密码、API Token 管理、Token 换 Session、IP 锁定策略（10 次失败锁 30 分钟）、Session 管理。
- 书签：新增/编辑/删除、批量删除、批量移动、删除全部、搜索与筛选、URL 规范化去重、检查状态维护。
- 分类：树/平铺查询、新增、重命名、移动、删除、批量删除、图标/颜色样式。
- 导入/导出：导入（HTML/JSON/TXT）、导出（HTML/JSON，支持分类/未分类/多分类范围）。
- 链接检查：按范围启动检查、跳过检查、重试策略、取消任务、失败项记录。
- 任务系统：任务队列串行执行、任务列表/详情、SSE 实时进度、失败项分页、清理任务记录。
- 备份与还原：自动/手动备份、列表/下载/删除、从备份或上传文件还原。
- 快照：保存网页快照（HTML）、列表/查看/删除/批量删除、与书签关联。
- AI：单条分类建议、AI 配置测试、AI 整理（Plan 生命周期：创建/预览/确认分配/应用/回滚/冲突解决/取消/重试）。
- 设置：检查/备份/定期检查/AI 参数等设置保存与读取、重置、`.env` 写入。
- 浏览器扩展：拉取分类、保存书签、保存快照、保存二合一、连接状态/失败提示。

### 1.2 关键时序/状态（需覆盖）
- **数据状态**：空库/有数据/大量数据、存在重复 URL、存在深层分类、存在被删除引用（分类/书签/快照/任务）。
- **任务时序**：导入→检查→导出；检查进行中→取消；AI 整理 Plan 生成→编辑树→确认→分配→应用/回滚；备份→还原→再次操作。
- **并发与竞争**：多个任务排队/取消；AI 预览阶段用户手动删除/移动书签或分类（冲突解决路径）；导入与检查同时发起（队列串行）。
- **鉴权状态**：未登录、Session 登录、API Token、Token 过期、IP 锁定中。

---

## 2. 机器测试（自动化）

### 2.1 已有测试框架与现状
- 测试框架：Vitest（`vitest.config.ts`）
- 现有用例覆盖（`tests/`）：URL 规范化、导入解析、导出 HTML 构建、分类服务、任务队列、部分书签路由。
- DB 测试工具：`tests/helpers/db.ts`（临时 SQLite 文件，调用 `openDb()` 对齐生产 schema）

### 2.2 建议新增/增强的自动化能力（可选）
> 下面是“测试方案”建议项，不要求一次性全引入；可按优先级渐进落地。

1) 覆盖率（同框架扩展）
- 建议引入：`@vitest/coverage-v8`
- 目的：生成覆盖率报告，建立最低门槛（例如 statements/branches/functions/lines ≥ 70%，逐步提升）。

2) E2E（端到端 UI 与扩展）
- 建议引入：Playwright（`@playwright/test`）
- 目的：覆盖“页面渲染 + 前端交互 + 后端接口 + DB 状态”整链路，减少纯人工回归成本。

3) HTTP/AI Mock 策略（在 Vitest 内完成）
- `checker.ts` 使用全局 `fetch`：建议在测试中用 `vi.stubGlobal('fetch', ...)` 提供可控响应（避免真实联网）。
- `openai` SDK：建议 `vi.mock('openai')`，构造假 `OpenAI` 类返回可控 completion（避免真实调用与泄露密钥）。

### 2.3 自动化测试分层与建议用例集

#### A. 单元测试（Unit）
目标：纯函数/轻依赖逻辑，快且稳定。
- `canonicalizeUrl()`：已覆盖，补充边界（国际化域名、极长 query、异常输入）。
- `safeRedirectTarget()`/`escapeLikePattern()`/`validateStringLength()` 等 helper：补齐边界与安全性。
- `auth.ts`：
  - `validateCredentials()`：成功/失败提示文案、10 次失败锁定、锁定到期后恢复。
  - `createApiToken()`：名称校验、过期时间计算。
  - `validateApiToken()`：有效/无效/过期/last_used_at 更新。
- `checker.ts`：
  - `checkUrl()`：HEAD/GET fallback、超时、无协议输入。

#### B. 服务/DB 集成测试（Integration）
目标：对 SQLite schema、事务与数据一致性做强校验。
- `category-service.ts`：已覆盖，补充“移动分类后全路径更新”“删除父分类级联/书签归类”。
- `importer.ts`：`runImportJob()`（含去重、overrideCategory/defaultCategoryId、分类创建）。
- `checker.ts`：`runCheckJob()`（skip_check 计数、失败项写入 job_failures、job 状态流转）。
- `backups.ts`：还原逻辑的数据一致性（分类/书签/字段完整性）。
- `snapshots.ts`：插入快照记录、与书签关联策略（url/canonical_url 命中）。

#### C. API/路由集成测试（Fastify inject）
目标：覆盖路由输入校验、鉴权、状态码、返回结构、与 DB 的联动。
建议按模块补齐（`app.inject()`，DB 用 `createTestDb()`，必要时注册 `@fastify/formbody`/`@fastify/multipart`/`@fastify/session`）：
- `authRoutes`：`/login`、`/logout`、`/api/change-password`、`/api/tokens` CRUD、`/api/auth/session`。
- `bookmarkRoutes`：新增、更新、删除、移动、批量删除、delete-all、skip-check/status。
- `categoryRoutes`：tree/flat、创建（path/sub/top）、rename/move/style、删除与批量删除。
- `importRoutes`：无文件/无可解析项/正常导入（JSON Accept 返回 jobId）。
- `checkRoutes`：start（不同 scope 解析）、cancel。
- `jobsRoutes`：current、job/failures、cancel、clear-completed/clear-all。
- `settingsRoutes`：`/api/settings`、`/api/settings/reset`、`POST /settings`（Accept json 分支）。
- `backupRoutes`：列表、run、delete、restore（命名备份与 upload 两种分支，文件名校验）。
- `snapshotRoutes`：保存、列表、查看、删除、批量删除、文件名穿越防护。
- `pagesRoutes`：`/jobs/:id`（404/正常）。
- `index.ts`：`GET /api/bookmarks`（筛选/分页/排序）、`GET /export`（format/scope/categoryIds）。

#### D. E2E（推荐补齐 UI/扩展的核心流程）
目标：覆盖 UI 交互、前端状态机（Alpine.js）、SSE 渲染、表单上传、下载文件等。
建议优先 6 条“冒烟+主链路”：
1. 登录成功→进入首页→新增分类→新增书签→列表可见
2. 搜索/筛选→分页跳转→编辑书签→状态重置为 not_checked
3. 导入（小样本 HTML/JSON/TXT）→跳转任务页→任务完成→数据入库
4. 导出 HTML/JSON（全量/未分类/指定分类/多分类）→下载内容可解析
5. 启动检查→在任务页观察 SSE 进度→取消→状态为 canceled（或完成）
6. 备份 run→列表出现→restore→数据回滚验证

### 2.4 自动化覆盖矩阵（建议）

| 模块 | 机器测试优先级 | 主要手段 | 备注 |
|---|---:|---|---|
| 认证/Token/IP 锁定 | P0 | Unit + Route inject | 无需 UI 也可覆盖核心逻辑 |
| 书签/分类 CRUD | P0 | Route inject + Service | 已有部分覆盖，补齐批量与样式 |
| 导入/导出 | P0 | Integration + Route inject | 导入建议走 `/import` 的 JSON 分支验证 |
| 检查/取消/失败项 | P0 | Integration + fetch stub | 禁止真实联网，固定响应 |
| 任务/SSE | P1 | Route inject（SSE 可做基本 header/首包验证） | 复杂渲染交给 E2E/人工 |
| 备份/还原 | P1 | Route inject + 临时目录 | 重点测文件名校验与数据完整性 |
| 快照 | P1 | Route inject + 临时目录 | 覆盖文件名安全与批量删除 |
| 设置/.env 写入 | P1 | Route inject（mock 写文件） | `.env` 写入失败分支也要测 |
| AI classify/test | P1 | Route inject + mock openai | 仅验证输入/输出/截断逻辑 |
| AI organize（Plan） | P2 | 混合（mock 模块 + E2E/人工） | 状态机复杂，先人工保证 |
| 扩展 | P2 | E2E（浏览器）+ 人工 | 自动化成本高，先人工为主 |

### 2.5 推荐的自动化执行顺序（回归时序）
1. `npm test`（Unit/Integration/API）
2. `npm run build`（类型检查/编译）
3. （可选）E2E：起服务（独立 `DB_PATH`）→跑 Playwright

---

## 3. 人工测试（补足自动化盲区）

人工测试重点覆盖：
- UI/交互（Alpine 状态、弹窗/表单、列表更新、下载文件）
- SSE 实时刷新体验（断线/重连）
- 浏览器扩展（权限、跨域、保存书签/快照、错误提示）
- 定时类功能（自动备份、定期检查）与“重启后生效”
- 大数据量/长耗时任务的可用性与性能体验
- 兼容性（Chrome/Edge/Firefox）、移动端响应式

详细测试用例请见：`docs/testing/manual-test-cases.md`。

---

## 4. 问题反馈与缺陷管理

统一缺陷反馈模板请见：`docs/testing/bug-report-template.md`。

建议约定：
- P0：数据丢失/安全问题/无法登录/核心链路不可用
- P1：主要功能错误/导入导出错误/检查任务错误
- P2：一般功能问题/交互瑕疵
- P3：文案/样式/轻微体验

