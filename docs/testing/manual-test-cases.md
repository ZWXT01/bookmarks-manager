# 人工测试用例（全功能覆盖）

本文档定位：**人工测试用例库**，用于覆盖自动化（Vitest）暂未覆盖或不适合覆盖的部分（UI、扩展、SSE 体验、定时任务、长耗时任务、兼容性等），并显式包含“时序/并发/数据状态”用例。

---

## 0. 测试准备

### 0.1 环境与账号
- 运行方式：Docker 或本地 `npm run dev`
- 默认账号（首次启动/空库）：`admin / admin`
- 建议使用**独立测试库**，避免污染开发数据：
  - 启动时指定 `DB_PATH=./data/manual_test.db`
- 浏览器：Chrome/Edge（P0），Firefox（P1）

### 0.2 数据重置（推荐）
优先级从高到低（越靠上越“干净”）：
1. 停止服务 → 删除测试 DB 文件（例如 `./data/manual_test.db`）→ 重启服务
2. 在首页/接口清理数据：
   - `POST /api/bookmarks/delete-all`（清空书签）
   - 删除分类：选中分类批量删除（或逐个删除）
   - `POST /api/jobs/clear-all`（清空任务/失败项）
   - `POST /api/settings/reset`（还原默认设置）

### 0.3 测试数据（建议集）
分类：
- `技术/编程`
- `学习资源`
- `生活服务`

书签：
- `https://example.com`（应 OK）
- `https://httpstat.us/404`（应 FAIL：HTTP 404）
- `example.com/path?utm_source=a&utm_medium=b`（用于验证规范化与去重）

> 说明：链接检查依赖外网时，可替换为本机自建临时 HTTP 服务（如 `python -m http.server 18081`）来构造 200/404/503 响应。

---

## 1. 推荐执行顺序（时序回归）

### S0 冒烟（10~15 分钟，P0）
1. 登录成功 → 进入首页
2. 新建分类 → 新增书签 → 列表可见
3. 导出 HTML/JSON 任意一种 → 文件可下载
4. 导入小文件（任意格式）→ 跳转任务页 → 任务完成
5. 启动检查 → 任务页能看到进度（或完成/失败）→ 可取消
6. 设置页可打开 → 可创建 API Token

### S1 全链路（30~60 分钟，P0/P1）
按“分类→书签→导入→检查→AI→备份/还原→快照→扩展”的顺序执行，确保状态累积不会破坏后续功能（尤其是：去重、任务队列、还原覆盖数据、AI Plan 冲突）。

---

## 2. 详细用例

> 用例格式约定：每条用例包含【前置条件 / 步骤 / 预期结果】。优先级：P0 必测、P1 常规回归、P2 低频抽测。

### A. 认证与安全（AUTH）

#### TC-AUTH-001 登录成功（P0）
**前置条件**
- 服务已启动，存在用户 `admin`
**步骤**
1. 打开 `/login`
2. 输入正确用户名/密码（默认 `admin/admin`）
3. 点击登录
**预期结果**
- 跳转到 `/`
- 后续访问任意需要登录的页面不再被重定向到 `/login`

#### TC-AUTH-002 登录失败提示与剩余次数（P0）
**前置条件**
- 使用一个固定 IP（同一浏览器同一网络即可）
**步骤**
1. 打开 `/login`
2. 输入正确用户名 + 错误密码，提交
3. 重复 2~3 次
**预期结果**
- 页面提示“密码错误，还剩 X 次尝试机会”（X 递减）
- 不应登录成功

#### TC-AUTH-003 IP 锁定（10 次失败）（P0）
**前置条件**
- 同一 IP 持续失败
**步骤**
1. 连续 10 次用错误密码提交登录
2. 第 11 次再次尝试登录（即使输入正确密码也尝试一次）
**预期结果**
- 出现“该IP登录尝试次数过多…/锁定30分钟”相关提示
- 在锁定期内无法登录

#### TC-AUTH-004 Remember me（P1）
**前置条件**
- 浏览器允许 Cookie
**步骤**
1. `/login` 勾选“remember”（若页面有）并登录成功
2. 关闭浏览器（或清理非持久会话）
3. 再次访问 `/`
**预期结果**
- 在有效期内仍保持登录（或至少符合产品设计的会话策略）

#### TC-AUTH-005 登出（P0）
**步骤**
1. 登录后触发 `/logout`（UI 按钮或直接提交表单）
2. 再访问 `/`
**预期结果**
- 跳转到 `/login`

#### TC-AUTH-006 修改密码成功（P0）
**前置条件**
- 已登录
**步骤**
1. 在设置页或通过 API 调用 `POST /api/change-password`
2. 旧密码填当前密码，新密码填长度 ≥ 6，确认密码一致
3. 登出后用新密码登录
**预期结果**
- API 返回 success
- 新密码可登录，旧密码不可登录

#### TC-AUTH-007 修改密码失败：两次不一致/过短（P1）
**前置条件**
- 已登录
**步骤**
1. `POST /api/change-password` 提交 `new_password != confirm_password`
2. 再提交 `new_password` 长度 < 6
**预期结果**
- 返回 400，并给出明确错误信息

#### TC-AUTH-008 API 未登录访问：返回 401（P0）
**前置条件**
- 未登录（或登出后）
**步骤**
1. 直接访问 `/api/categories`（或任意 `/api/*`）
**预期结果**
- 返回 401 `Authentication required`（而不是 302 到登录页）

#### TC-AUTH-009 创建 API Token（P0）
**前置条件**
- 已登录
**步骤**
1. 打开 `/settings`
2. 在 API Tokens 区域创建 Token（填写名称、可选有效期）
**预期结果**
- 创建成功，显示 token（仅一次）
- `GET /api/tokens` 能看到 token 列表（不包含明文 token）

#### TC-AUTH-010 使用 API Token 访问 API（P0）
**前置条件**
- 已创建 Token
**步骤**
1. 用 curl / Postman 调用：
   - Header：`Authorization: Bearer <token>`
   - 请求：`GET /api/categories`
**预期结果**
- 返回 200 且有数据结构（tree 或 categories）

#### TC-AUTH-011 API Token 过期（P1）
**前置条件**
- 创建一个很短有效期 token（如 1 天），或通过调整系统时间/直接改库模拟过期
**步骤**
1. 用过期 token 请求任意 `/api/*`
**预期结果**
- 返回 401，错误为 `API token has expired`

#### TC-AUTH-012 Token 换 Session（扩展依赖）（P0）
**前置条件**
- 有可用 API Token（静态或动态）
**步骤**
1. `POST /api/auth/session`，Header：`Authorization: Bearer <token>`
2. 取响应/Set-Cookie
3. 用该 Cookie 访问 `/` 或其他页面
**预期结果**
- 接口返回 `success: true` 与 `expiresAt`
- Cookie 生效，可访问页面

#### TC-AUTH-013 删除 API Token（P1）
**前置条件**
- 已创建多个 token
**步骤**
1. `DELETE /api/tokens/:id`
2. 用被删除 token 请求 `/api/categories`
**预期结果**
- 删除成功
- 被删除 token 返回 401 `Invalid API token`

---

### B. 分类（CAT）

#### TC-CAT-001 获取分类：tree 模式含计数（P0）
**前置条件**
- 至少存在 1 个分类与 1 条书签（含未分类）
**步骤**
1. `GET /api/categories?tree=true`
**预期结果**
- 返回 `tree`
- 返回 `totalCount` 与 `uncategorizedCount` 且数值正确

#### TC-CAT-002 新建一级分类（P0）
**步骤**
1. 在首页新建分类（或 `POST /api/categories` 只传 `name`）
**预期结果**
- 创建成功，分类出现在列表

#### TC-CAT-003 新建二级分类（路径写法）（P0）
**步骤**
1. `POST /api/categories`，`name=技术/编程`
**预期结果**
- 创建成功
- 再次创建同名返回 409 `分类已存在`

#### TC-CAT-004 更新分类样式 icon/color（P1）
**前置条件**
- 存在分类
**步骤**
1. `PATCH /api/categories/:id/style`，只更新 icon
2. 再只更新 color
3. 再同时更新 icon+color
**预期结果**
- 每次返回 success
- 分类的 icon/color 字段被更新并可在 UI 中展示（若 UI 支持）

#### TC-CAT-005 重命名分类（P0）
**前置条件**
- 存在分类 `学习资源`
**步骤**
1. `PATCH /api/categories/:id`，name 改为 `学习资料`
**预期结果**
- 返回 success
- 分类名称更新；若存在子分类/路径，路径更新符合设计（重点回归）

#### TC-CAT-006 移动分类（P1）
**前置条件**
- 存在父分类 A 与子分类 B
**步骤**
1. `PATCH /api/categories/:id/move`，将 B 移动到新父分类
**预期结果**
- 返回 success
- B 的 fullPath 变更正确

#### TC-CAT-007 删除分类：书签归为未分类（P0）
**前置条件**
- 分类下有书签
**步骤**
1. `DELETE /api/categories/:id`
**预期结果**
- 返回 `movedBookmarks` 数量正确
- 原分类删除
- 原分类下书签变为未分类（`category_id = null`）

#### TC-CAT-008 批量删除分类（含上限）（P1）
**前置条件**
- 准备 3+ 分类
**步骤**
1. `POST /categories/batch-delete` 提交 2 个 id
2. 尝试提交 101 个 id
**预期结果**
- (1) 删除成功、返回 movedBookmarks
- (2) 返回 400 `一次最多删除100个分类`

---

### C. 书签（BM）

#### TC-BM-001 新增书签（P0）
**步骤**
1. 首页输入 URL + 标题（可空）+ 选择分类（可选）
2. 提交新增
**预期结果**
- 新增成功，列表出现该书签
- 标题为空时自动用规范化 URL 填充

#### TC-BM-002 URL 自动补全协议与规范化（P0）
**步骤**
1. 新增 `example.com/path?utm_source=a&id=1`
2. 再新增 `https://example.com/path?id=1`
**预期结果**
- 第 1 条保存为 `https://example.com/...`，并去除 `utm_*`
- 第 2 次新增提示重复（按 canonical_url 去重）

#### TC-BM-003 新增重复 URL（P0）
**前置条件**
- 已存在 `https://example.com`
**步骤**
1. 再次新增 `https://example.com/`（或等价 URL）
**预期结果**
- 返回 409 或 UI 提示“书签已存在/按规范化URL去重”

#### TC-BM-004 编辑书签：更新后重置检查状态（P0）
**前置条件**
- 书签曾被检查为 ok/fail
**步骤**
1. 编辑该书签 URL 或标题并保存
**预期结果**
- `check_status` 重置为 `not_checked`
- `last_checked_at/check_http_code/check_error` 清空

#### TC-BM-005 删除书签（P0）
**步骤**
1. 删除一条书签
**预期结果**
- 删除成功，列表消失
- 再次删除同 id 返回“不存在”提示

#### TC-BM-006 批量删除书签（P0）
**前置条件**
- 至少 3 条书签
**步骤**
1. 多选 2 条 → 批量删除
**预期结果**
- 返回 deleted=2
- DB 中剩余数量正确

#### TC-BM-007 批量移动书签到分类/未分类（P0）
**前置条件**
- 至少 2 条书签、2 个分类
**步骤**
1. 选中 2 条 → 移动到分类 A
2. 再移动到 `uncategorized`
**预期结果**
- moved updated 数量正确
- 分类筛选下可见性符合预期

#### TC-BM-008 删除全部书签（P1）
**步骤**
1. 调用 `POST /api/bookmarks/delete-all`
**预期结果**
- deleted 数量正确
- 首页/分类计数同步为 0（或刷新后为 0）

#### TC-BM-009 搜索：关键词与分类组合（P0）
**前置条件**
- 标题/URL 中包含可检索关键字（如 “Dev”）
**步骤**
1. 在“全部”中搜索关键字
2. 切换到某分类再搜索
**预期结果**
- 结果与筛选条件一致（分类 + 关键字同时生效）

#### TC-BM-010 API 列表筛选（多关键词/状态/域名/日期/排序/分页）（P1）
**步骤**
1. `GET /api/bookmarks?q=one%20two`（多关键词空格分隔）
2. `GET /api/bookmarks?status=ok|fail|not_checked`
3. `GET /api/bookmarks?domain=example.com`
4. `GET /api/bookmarks?date_from=2026-01-01&date_to=2026-12-31`
5. `GET /api/bookmarks?sort=created_at&order=asc&page=2&pageSize=10`
**预期结果**
- 每种筛选都生效且 total/page/totalPages 合理

#### TC-BM-011 标记跳过检查（skip_check）（P1）
**前置条件**
- 存在书签
**步骤**
1. `PATCH /api/bookmarks/:id/skip-check`，`skip_check=1`
2. 再置回 `0`
**预期结果**
- 返回 success 且字段切换正确
- 后续启动检查时被跳过（见检查用例）

#### TC-BM-012 手动修改检查状态（P2）
**步骤**
1. `PATCH /api/bookmarks/:id/status` 设置 ok/fail/not_checked
**预期结果**
- 状态更新成功；非法值返回 400

#### TC-BM-013 收藏与描述（API 能力）（P2）
**步骤**
1. `PATCH /api/bookmarks/:id/star` 设置 `is_starred=1/0`
2. `PATCH /api/bookmarks/:id/description` 设置描述（≤2000）
3. 提交超长描述
**预期结果**
- (1)(2) 更新成功
- (3) 返回错误（长度校验生效）

---

### D. 导入/导出（IO）

#### TC-IO-001 导入 HTML（Netscape）（P0）
**前置条件**
- 准备一个小型书签 HTML 文件（含文件夹层级）
**步骤**
1. 在首页/导入入口选择 HTML 文件
2. 勾选/不勾选“跳过重复”（如果 UI 有）
3. 提交导入
**预期结果**
- 创建导入任务并跳转到 `/jobs/:id`
- 任务完成后：分类与书签写入，重复项按选项处理

#### TC-IO-002 导入 JSON（含 category 字段）（P0）
**步骤**
1. 导入 JSON（数组形式，元素包含 `url/title/category`）
**预期结果**
- category 字段映射为分类路径（符合实现）
- 任务完成后数据正确

#### TC-IO-003 导入 TXT（纯文本 URL）（P1）
**步骤**
1. 导入 TXT，每行一个 URL
**预期结果**
- URL 被解析入库

#### TC-IO-004 导入失败：空文件/无法识别格式（P0）
**步骤**
1. 上传空文件或随机文本
**预期结果**
- 返回明确错误提示“未识别到可导入的书签…”

#### TC-IO-005 导入选项：overrideCategory/defaultCategoryId（P1）
**前置条件**
- 存在分类 A
- 导入文件内含自带分类的书签
**步骤**
1. 设置 defaultCategoryId=A，并开启 overrideCategory
2. 执行导入
**预期结果**
- 全部导入的书签最终落在分类 A（覆盖原分类）

#### TC-IO-006 导出 HTML（全量/分类/未分类/多分类）（P0）
**步骤**
1. `GET /export`（全量）
2. `GET /export?category=<id>`
3. `GET /export?category=uncategorized`
4. `GET /export?scope=categories&categoryIds=id1,id2`
**预期结果**
- 返回下载文件（Content-Disposition）
- HTML 能被浏览器导入（结构正确）

#### TC-IO-007 导出 JSON（P0）
**步骤**
1. `GET /export?format=json`
**预期结果**
- 下载 JSON 数组
- JSON 可被解析，字段 `url/title/category_name/created_at` 合理

---

### E. 链接检查（CHECK）

#### TC-CHECK-001 启动检查：all/not_checked/failed（P0）
**前置条件**
- 存在 3 条书签：至少 1 条可访问、1 条 404、1 条异常
**步骤**
1. 在 UI 选择“检查全部/仅未检查/仅失败重试”（或调用 `POST /api/check/start`）
2. 跳转到任务页观察进度
**预期结果**
- 任务状态 queued→running→done（或失败）
- 书签状态写入 ok/fail，失败有 `check_error/http_code`

#### TC-CHECK-002 检查范围：分类/多分类/选中（P1）
**步骤**
1. `POST /api/check/start`，scope=category + category=某分类
2. scope=categories + category_ids[]=...
3. scope=selected + bookmark_ids[]=...
**预期结果**
- 实际被检查的书签集合与 scope 一致

#### TC-CHECK-003 skip_check 生效且计入 skipped（P0）
**前置条件**
- 将其中 1 条书签设为 skip_check=1
**步骤**
1. 启动检查 all
**预期结果**
- 该书签不被请求
- 任务统计 `skipped` 增加

#### TC-CHECK-004 取消检查任务（P0）
**前置条件**
- 准备足够多书签或低超时，使任务运行一段时间
**步骤**
1. 启动检查后立刻点击取消（或 `POST /api/check/cancel`）
**预期结果**
- 任务状态变为 `canceled`
- 已处理的书签保留结果，未处理的不应被标记为 ok

#### TC-CHECK-005 重试参数（P2）
**步骤**
1. 在启动检查时设置 retries/retry_delay_ms 为非默认值
**预期结果**
- 失败 URL 会按重试策略再次尝试（可通过日志/失败次数现象侧证）

#### TC-CHECK-006 定期检查（Periodic Check）（P2）
**前置条件**
- 设置页启用“定期检查”，并配置 schedule（weekly/monthly）与 hour（2~5）
- 环境允许等待/调整时间
**步骤**
1. 在 `/settings` 启用 periodic check，保存
2. 将系统时间调整到设定的触发小时附近（2~5 点），或在该时间段运行服务
3. 观察服务端日志与 `/jobs` 列表
**预期结果**
- 到达触发条件后自动创建 check 任务并入队
- 任务执行完成后书签状态被更新

---

### F. 任务系统与 SSE（JOB）

#### TC-JOB-001 任务列表页面（P1）
**步骤**
1. 打开 `/jobs`
**预期结果**
- 列表显示最近任务
- 分页参数有效

#### TC-JOB-002 任务详情页与失败项分页（P1）
**前置条件**
- 有一个包含失败项的任务（如检查 404）
**步骤**
1. 打开 `/jobs/:id`
2. 切换失败项分页参数 `fail_page/fail_page_size`
**预期结果**
- 失败项列表分页正确

#### TC-JOB-003 SSE 连接与实时更新（P1）
**步骤**
1. 打开 `/jobs/:id`，观察任务进度是否实时变化
2. 在 Network 中查看 `/jobs/:id/events` 是否持续推送
**预期结果**
- SSE 持续输出 data
- 任务状态/processed 随执行变化

#### TC-JOB-004 取消任务（通用）（P1）
**步骤**
1. 对导入任务调用 `POST /api/jobs/:id/cancel`
**预期结果**
- queued/running 的任务可被标记 canceled（或至少 queued 可取消）

#### TC-JOB-005 清理任务记录（P2）
**步骤**
1. `POST /api/jobs/clear-completed`
2. `POST /api/jobs/clear-all`
**预期结果**
- 删除数量与实际相符
- job_failures 被同步清理

---

### G. 备份与还原（BACKUP）

#### TC-BACKUP-001 手动备份（P1）
**前置条件**
- 至少有 1 条书签
**步骤**
1. `POST /api/backups/run`
2. `GET /api/backups`
**预期结果**
- run 返回 success 且生成备份文件名
- 列表出现该备份，size/created_at 合理

#### TC-BACKUP-002 下载与删除备份（P1）
**前置条件**
- 存在备份文件
**步骤**
1. `GET /backups/:name` 下载
2. `DELETE /api/backups/:name`
**预期结果**
- 下载得到 `.db`
- 删除后列表不再包含该文件

#### TC-BACKUP-003 还原：按备份名称（P0）
**前置条件**
- 备份 A（含数据）
- 随后对数据做明显修改（新增/删除多条书签与分类）
**步骤**
1. `POST /api/backups/restore`，body `{name: "<backupA>"}`（或 UI 操作）
2. 回到首页查看数据
**预期结果**
- 数据回到备份 A 的状态（分类/书签一致）

#### TC-BACKUP-004 还原：上传 db 文件（P1）
**前置条件**
- 本地有一个合法 `.db` 备份文件
**步骤**
1. 以 multipart 上传到 `POST /api/backups/restore`
**预期结果**
- 还原成功
- 临时文件不会残留（可选检查）

#### TC-BACKUP-005 文件名校验安全（P0）
**步骤**
1. 尝试下载 `/backups/../../etc/passwd`
2. 尝试删除 `DELETE /api/backups/evil.db`
**预期结果**
- 返回 400 `无效的文件名`

#### TC-BACKUP-006 自动备份定时任务（P2）
**前置条件**
- 存在至少 1 条书签
**步骤**
1. 在 `/settings` 启用备份（backup_enabled=on），将间隔设置为 1 分钟、保留份数=2，保存
2. 等待 2~3 个间隔周期
3. `GET /api/backups` 查看备份数量与最新时间
**预期结果**
- 自动生成 `backup_*.db` 文件
- 超出保留份数后旧备份被清理（保留份数生效）

---

### H. 快照（SNAP）

#### TC-SNAP-001 保存快照（P0）
**前置条件**
- 有可用 API Token（扩展或手工请求）
**步骤**
1. `POST /api/snapshots`，提交 `{url,title,content:"<html>...</html>"}`
2. 打开 `/snapshots`
**预期结果**
- 返回 success，包含 snapshot id/filename
- 页面列表出现该快照，file_size 合理

#### TC-SNAP-002 查看快照文件（P1）
**步骤**
1. 打开 `/snapshots/:filename`
**预期结果**
- 返回 text/html
- 内容与上传一致

#### TC-SNAP-003 删除与批量删除（P1）
**步骤**
1. `DELETE /api/snapshots/:id`
2. `POST /api/snapshots/batch-delete` ids=[...]
**预期结果**
- DB 记录删除
- 对应 html 文件从磁盘删除

#### TC-SNAP-004 文件名穿越防护（P0）
**步骤**
1. 访问 `/snapshots/../x.html` 或包含 `/`、`\\`
**预期结果**
- 返回 400 `无效的文件名`

---

### I. 设置（SET）

#### TC-SET-001 设置页可打开且显示当前值（P0）
**步骤**
1. 打开 `/settings`
**预期结果**
- 页面渲染成功
- 检查/备份/定期检查/AI 配置字段有默认值或当前值

#### TC-SET-002 保存设置（P1）
**步骤**
1. 修改检查重试次数、重试间隔
2. 修改备份开关/间隔/保留数
3. 修改定期检查开关/weekly|monthly/小时（2~5）
4. 保存
**预期结果**
- 保存成功
- 刷新页面仍保留新值

#### TC-SET-003 API 获取设置（敏感信息遮蔽）（P1）
**前置条件**
- 已设置 ai_api_key
**步骤**
1. `GET /api/settings`
**预期结果**
- 返回的 `ai_api_key` 为 `******`（不泄露明文）

#### TC-SET-004 重置设置（P1）
**步骤**
1. `POST /api/settings/reset`
2. 刷新 `/settings`
**预期结果**
- 值回到默认（或 env fallback）

---

### J. AI（AI）

#### TC-AI-001 AI 配置测试（P1）
**前置条件**
- 有可用 OpenAI 兼容服务（或使用内部测试环境）
**步骤**
1. 在设置页填写 base_url/api_key/model
2. 调用 `POST /api/ai/test`
**预期结果**
- success true（或失败时给出明确 error）

#### TC-AI-002 单条分类建议（P1）
**前置条件**
- AI 配置完成
- 已存在一些一级分类（用于 hint）
**步骤**
1. `POST /api/ai/classify` 提交 title/url
**预期结果**
- 返回 `category` 字符串
- 分类最多 2 级（含 `/` 最多一次），超出会被截断

#### TC-AI-003 AI 整理：启动 Plan（P1）
**前置条件**
- AI 配置完成，库中有一定数量书签与分类
**步骤**
1. `POST /api/ai/organize`（scope=all 或 category）
2. `GET /api/ai/organize/:planId`
**预期结果**
- 返回 planId
- plan 可查询到，包含状态与（可能的）target_tree

#### TC-AI-004 编辑分类树并确认开始分配（P1）
**前置条件**
- 已有 planId
**步骤**
1. `PUT /api/ai/organize/:planId/tree`，提交 `tree` 数组，confirm=false
2. 再次提交 confirm=true
**预期结果**
- 第一次保存成功但不启动分配（按设计）
- confirm=true 后 plan 进入 assigning/相关状态并产生 job（若实现如此）

#### TC-AI-005 应用/回滚/取消/重试（P2）
**步骤**
1. `POST /api/ai/organize/:planId/apply`
2. `POST /api/ai/organize/:planId/rollback`
3. `POST /api/ai/organize/:planId/cancel`
4. `POST /api/ai/organize/:planId/retry`
**预期结果**
- 每个接口返回 success 或明确 error
- DB 分类/书签变化与预期一致（重点人工核对）

#### TC-AI-006 冲突场景（时序/竞争）（P0）
**前置条件**
- plan 已生成并处于 preview/可应用阶段
**步骤**
1. 在另一个窗口手动删除某些书签/分类（或移动书签）
2. 回到 AI plan，执行 apply
3. 如出现冲突，按接口提示调用 `/apply/resolve`
**预期结果**
- 系统能检测并给出可操作的冲突信息（或至少不崩溃）
- 最终应用结果可解释且数据不丢失（必要时可回滚）

---

### K. 浏览器扩展（EXT）

#### TC-EXT-001 安装与配置（P0）
**步骤**
1. 浏览器打开扩展管理页，加载 `extension-new/` 为“已解压扩展”
2. 打开扩展 popup，配置 serverUrl 与 apiToken
3. 保存设置
**预期结果**
- 连接状态变为“已连接”
- 分类下拉框能加载分类列表

#### TC-EXT-002 保存书签（P0）
**步骤**
1. 打开任意网页
2. 扩展中选择分类（可选）→ 点击保存书签
3. 打开服务端首页确认
**预期结果**
- 服务端新增该书签
- 分类选择生效（若不生效，记录为缺陷并附请求 body/服务端日志）

#### TC-EXT-003 保存快照（P1）
**步骤**
1. 打开任意网页
2. 扩展点击“保存快照”
3. 打开 `/snapshots` 查看
**预期结果**
- 生成快照记录与文件
- 可打开快照 HTML

#### TC-EXT-004 Save All（书签+快照）（P1）
**步骤**
1. 扩展点击“保存全部”
**预期结果**
- 同时新增书签与快照

#### TC-EXT-005 异常处理：无 token/错误 token/离线（P0）
**步骤**
1. 清空 token → 打开扩展
2. 配置错误 token → 尝试保存
3. serverUrl 指向不可达地址 → 尝试连接
**预期结果**
- 给出明确提示（请配置 Token/未连接/401 等）

---

### L. 组合与时序（FLOW）

#### TC-FLOW-001 导入→检查→导出（P0）
**步骤**
1. 导入一批书签（含重复与无分类）
2. 对“未检查”启动检查并等待完成
3. 导出 HTML 与 JSON
**预期结果**
- 去重生效；检查状态写入；导出包含正确分类与字段

#### TC-FLOW-002 任务队列时序：导入与检查排队（P0）
**前置条件**
- 导入任务会运行一段时间（可用较大文件）
**步骤**
1. 启动导入任务（进入 queued/running）
2. 立即启动检查任务
3. 在 `/jobs` 观察任务状态顺序
**预期结果**
- 任务队列串行：检查任务应排队等待（或按实现规则执行）
- 取消排队中的任务应生效

#### TC-FLOW-003 备份→还原→继续操作（P1）
**步骤**
1. 生成手动备份
2. 做一轮明显变更（新增/删除/导入）
3. 还原备份
4. 再新增一个分类与书签
**预期结果**
- 还原后数据回退正确
- 还原后系统仍可正常写入新数据

#### TC-FLOW-004 快照与书签关联时序（P2）
**步骤**
1. 先对一个 URL 保存快照（当该 URL 还不是书签）
2. 再新增同 URL 书签
3. 查看 `/snapshots` 的 bookmark_id/关联展示（如有）
**预期结果**
- 快照仍可查看与删除
- 关联策略符合设计（可记录为产品确认点）

---

### M. 安全与协议细节（SEC）

#### TC-SEC-001 redirect 参数不允许外跳（Open Redirect 防护）（P0）
**前置条件**
- 已登录（避免被登录跳转干扰）
**步骤**
1. 对表单路由提交带 `redirect=https://example.org`（如 `POST /bookmarks` 或 `POST /categories`）
2. 观察响应 Location
**预期结果**
- 重定向目标被钳制到站内路径（例如 `/`），不会跳转到外部域名

#### TC-SEC-002 CORS 预检（OPTIONS）（P2）
**步骤**
1. 发送 `OPTIONS /api/categories`，携带 `Origin` 与 `Access-Control-Request-*` 头
**预期结果**
- 返回 204
- 返回允许的 CORS header（Allow-Origin/Allow-Headers/Allow-Methods/Allow-Credentials）
