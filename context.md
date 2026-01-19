# Project Context

## 1. Project Overview (项目概览)
* **Name**: Bookmarks Manager
* **Description**: 自托管书签管理器，支持书签/分类管理、导入导出、批量检查、AI 分类、网页快照、浏览器扩展
* **Status**: Production
* **Version**: 2.1.1 (2026-01-13)

## 2. Tech Stack (技术栈)
* **Core Framework**: Fastify
* **Language**: TypeScript
* **Frontend**: Alpine.js + EJS templates
* **Styling**: 原生 CSS + TailwindCSS
* **Database**: SQLite (better-sqlite3)
* **Auth**: 内置 Session + API Token 认证
* **Build Tool**: esbuild
* **Snapshot**: SingleFile 集成

## 3. Directory Structure (项目结构)
```
src/                    # TypeScript 源码
├── index.ts           # 主入口，路由定义
├── db.ts              # 数据库初始化
├── auth.ts            # 认证模块（Session + API Token）
├── checker.ts         # 书签检查器
├── importer.ts        # 导入模块
├── exporter.ts        # 导出模块
├── jobs.ts            # 任务队列
├── ai-classifier.ts   # AI 分类器
├── ai-classify-job.ts # AI 分类任务
└── ai-simplify-job.ts # AI 精简任务
views/                  # EJS 模板
├── index.ejs          # 主页（书签管理）
├── settings.ejs       # 设置页
├── snapshots.ejs      # 快照管理页
├── login.ejs          # 登录页
├── jobs.ejs           # 任务列表
└── job.ejs            # 任务详情
public/                 # 静态资源
├── app.js             # Alpine.js 应用逻辑
├── app.css            # 全局样式（含暗黑模式）
└── lib/               # 本地化 JS 库
extension-new/          # 浏览器扩展 (v2.0)
├── popup.*            # 弹窗 UI
├── content.js         # 内容脚本
└── lib/single-file.js # SingleFile 核心库
data/                   # 数据目录
├── app.db             # SQLite 数据库
├── snapshots/         # 网页快照文件
└── backups/           # 数据库备份
```

## 4. Development Setup (启动方式)
```bash
# Environment
Node version: >= 18.x
Package Manager: npm

# Commands
npm install     # Install dependencies
npm run dev     # Start development server
npm run build   # Build for production
npm start       # Start production server

# Docker 部署
docker compose up -d --build
# 访问 http://localhost:8080
# 默认账号：admin / admin
```

## 5. Key Features (核心功能)
* **书签管理**: 添加、编辑、删除、移动、去重、描述
* **分类管理**: 多级分类、图标/颜色自定义、批量移动
* **导入导出**: HTML/JSON/TXT 格式
* **批量检查**: 30+ 并发、智能重试、定期检查
* **AI 功能**: OpenAI 兼容 API 自动分类/精简、Token 预估
* **网页快照**: SingleFile 集成、快照管理页面
* **UI/UX**: 暗黑模式、键盘快捷键、表格/卡片视图
* **安全**: 登录认证、记住密码、多 API Token、IP 锁定

## 6. Change Log (变更日志)

### 2026-01-13 - Bug 修复 & UI 统一 & 问题调查

> [!CAUTION]
> **数据丢失事件**：categories 表被清空，所有书签 category_id 变为 NULL

> [!WARNING]
> **快照页 EJS 语法问题（反复出现）**
> 
> `views/snapshots.ejs` 中的 `<%- JSON.stringify(snapshots) %>` 会变回 `<% - JSON.stringify(...) %>`（多了空格），导致列表不显示。
> 
> **原因**：编辑工具可能在保存时自动格式化 EJS 标签
> 
> **修复方法**：必须使用 `sed` 命令修复，然后 Docker 重建
> ```bash
> sed -i 's/<% - JSON.stringify(snapshots) %>/<%- JSON.stringify(snapshots) %>/g' views/snapshots.ejs
> docker compose up -d --build
> ```

#### Bug 修复
| Bug | 修复 |
|-----|------|
| **快照页 EJS 语法** | `<% -` 改为 `<%-`（使用 sed 命令修复） |
| **快照路由正则** | `/snapshots/:filename` 改用路径穿越检查，支持中文文件名 |

#### UI 风格统一
| 页面 | 更新 |
|------|------|
| **快照页** | ✅ glass-header + 渐变标题 + .card + btn-secondary/btn-primary |
| **任务列表页** | ✅ glass-header + 渐变标题 + .card + btn-secondary/btn-danger |
| **任务详情页** | ✅ glass-header + 渐变标题 + .card + btn-secondary |
| **设置页** | ✅ 之前已统一 |

#### 新功能
| 功能 | 详情 |
|------|------|
| **全选分类** | 分类列表添加"全选分类"复选框 |

#### 已知问题
| 问题 | 状态 | 详情 |
|------|------|------|
| **分类数据丢失** | ⚠️ 未恢复 | categories 表为空，备份(01-11)有24个分类+4783书签关联 |
| **checkJobDone 未定义** | 🔴 待修复 | Alpine.js 报错（index.ejs 引用了不存在的变量）|

#### 文件变更
| 文件 | 变更 |
|------|------|
| `views/snapshots.ejs` | Header + 卡片 + 按钮统一风格，修复 EJS 语法 |
| `views/jobs.ejs` | Header + 卡片 + 按钮统一风格 |
| `views/job.ejs` | Header + 卡片 + 按钮统一风格 |
| `src/routes/snapshots.ts` | filename 路由改用路径穿越检查 |
| `views/index.ejs` | 添加全选分类 UI |
| `public/app.js` | 添加 `getAllCategoryIds()`、`toggleSelectAllCategories()` 方法 |

---

### 2026-01-11 - 搜索去抖 & 分类树缩进优化

#### 优化项
| 优化 | 详情 |
|------|------|
| **搜索去抖** | 输入后 300ms 自动触发搜索，无需手动点击按钮 |
| **分类树缩进** | 二级分类左侧添加连接线，增强层级辨识度 |
| **路由模块拆分** | 创建 `src/routes/`，index.ts 从 3508 行减少到 2819 行 (**-20%**) |

#### 路由模块 (已整合到 index.ts)
| 模块 | 说明 |
|------|------|
| `bookmarks.ts` | 书签 API |
| `categories.ts` | 分类 API |
| `snapshots.ts` | 快照管理 |
| `backups.ts` | 备份管理 |

---

### 2026-01-11 - 导入分类选择 & 分类批量删除 UI

#### 新功能
| 功能 | 详情 |
|------|------|
| **导入分类选择** | 导入表单新增"忽略原有分类"勾选框，勾选后可选择统一导入到指定分类 |
| **分类批量删除 UI** | 分类列表每项添加复选框，选中后显示"删除选中"按钮 |
| **二级分类显示优化** | 二级分类只显示分类名称（如"产品运营"），不再显示完整路径（如"书签栏/产品运营"） |

#### 文件变更
| 文件 | 变更 |
|------|------|
| `views/index.ejs` | 导入表单使用勾选框控制分类选择、二级分类使用 `displayName` |
| `public/app.js` | 添加 `importOverrideCategory` 状态变量 |
| `src/index.ts` | 导入 API 添加 `overrideCategory` 参数解析 |
| `src/importer.ts` | 添加 `overrideCategory` 选项，修改分类逻辑 |

---

### 2026-01-11 - 项目清理

#### 删除内容
| 类别 | 删除项 |
|------|------|
| **备份目录** | `public_backup/`, `src_backup/`, `views_backup/` |
| **冗余源码** | `singlefile-source/`, `src/index_backup.ts`, `dist/index.js.working` |
| **测试文件** | `*.html` 书签文件, `ai_categorize_my_bookmarks.py`, `test_ai.js` |

**节省空间**: ~3.0 MB

---

### 2026-01-11 - 主页模板恢复

> [!CAUTION]
> `views/index.ejs` 被意外删除导致登录后 500 错误

#### 问题诊断
| 症状 | 原因 |
|------|------|
| 登录后返回 500 错误 | `ENOENT: no such file or directory, open '/app/views/index.ejs'` |
| Git 状态显示 `D views/index.ejs` | 文件被删除但未提交 |
| 仅能恢复初始版本 | Git 只有首次提交包含此文件 |

#### 修复方案
- **完全重建** `views/index.ejs`（44KB，600+ 行）
- 根据 `app.js`（2002 行，114 个函数）逆向重建所有 UI 组件

#### 恢复的功能
| 功能 | 实现 |
|------|------|
| **暗黑模式** | 主题初始化脚本、`data-theme`、切换按钮 |
| **本地化 JS** | 使用 `/public/lib/tailwind.js` 和 `alpine.min.js` |
| **分类树状结构** | 一级/二级分类折叠展开、`categoryTree` 渲染 |
| **Alpine.js 集成** | `x-data="bookmarkApp()"`、响应式数据绑定 |
| **表格/卡片视图** | `viewMode` 切换、双视图 UI |
| **批量操作** | 移动、检查、AI 分类、删除 |
| **模态框** | 编辑书签、移动书签、分类样式、检查、AI 分类、AI 精简、导入进度、备份、导出 |
| **添加书签** | 表单 + AI 建议分类 |
| **当前任务进度** | Header 内联显示 + 取消按钮 |

---

### 2026-01-10 - AI 分类数据隔离修复 & 功能改进

> [!IMPORTANT]
> 修复 AI 分类任务间数据隔离失效的严重 Bug

#### AI 分类数据隔离（关键修复）
| 变更 | 详情 |
|------|------|
| **全局删除移除** | 移除创建新任务时的 `DELETE FROM ai_classification_suggestions`（无 WHERE 条件） |
| **取消任务修复** | `DELETE` 改为 `WHERE job_id = ?` 只删除当前任务建议 |
| **任务详情页** | `/jobs/:id` 查询建议时添加 `WHERE job_id = ?` 过滤 |
| **API 过滤** | `/api/ai/suggestions` 强制要求 `job_id` 参数 |
| **应用状态隔离** | `/api/ai/apply-suggestion` 按 `job_id + bookmark_id` 更新 applied 状态 |
| **前端传参** | job.ejs、app.js 所有 API 调用传递 `job_id` 参数 |

#### 功能改进
| 变更 | 详情 |
|------|------|
| **登录页简化** | 移除登录页主题切换按钮 |
| **导入表单** | 移除"按文件夹创建分类"和"导入后检查"选项 |
| **去重导入** | 新增"跳过重复书签"选项（基于 URL 检查） |
| **备份还原** | 新增 `POST /api/backups/restore` 端点，支持从现有备份或上传文件还原 |
| **分类名称显示** | AI 精简建议中 `oldCategoryName` 只显示路径最后一部分 |

#### 文件变更
| 文件 | 变更 |
|------|------|
| `src/index.ts` | AI 分类 API 添加 job_id 过滤、备份还原端点 |
| `src/importer.ts` | ImportOptions 改为 skipDuplicates，自动创建分类 |
| `views/job.ejs` | loadSuggestions 传递 job_id、应用按钮传递 job_id |
| `views/index.ejs` | 导入表单更新、备份还原 UI |
| `views/login.ejs` | 移除主题切换 |
| `public/app.js` | loadAISuggestions/applySuggestion 传递 job_id |

---

### 2026-01-09 Session 2 - AI 任务数据隔离 & Bug 修复

#### 分类建议数据隔离
| 变更 | 详情 |
|------|------|
| **表结构** | `ai_classification_suggestions` 添加 `job_id TEXT` 列 |
| **迁移** | `db.ts` 自动迁移添加 `job_id` 列和索引 |
| **保存** | `saveBatchSuggestions` 接受 `jobId` 参数 |
| **删除** | 改为 `DELETE WHERE job_id = ?` 替代 `DELETE ALL` |

#### AI 精简优化
| 变更 | 详情 |
|------|------|
| **Token估算** | AI Simplify 任务计算并保存 Token 估算 |
| **apply-all修复** | `markAppliedStmt` 添加 `job_id` 过滤，一键应用只影响当前任务 |
| **层级路径** | SQL 查询构建完整分类路径（`p.name || '/' || c.name`），AI 能正确识别层级 |
| **CategoryMapping** | 接口新增 `jobId` 字段，确保标记应用时按任务过滤 |

#### Bug 修复
| 变更 | 详情 |
|------|------|
| **快照页EJS** | 修复 `<% -` 语法错误为 `<%-`（使用 sed 命令确保生效） |
| **Token显示** | 移除费用显示，只保留预估 Token 数量 |

---

### 2026-01-09 - UI 和 AI 优化

#### 暗黑模式
| 变更 | 详情 |
|------|------|
| **全局切换** | 所有页面添加主题切换按钮：snapshots、settings、jobs、job、login |
| **样式统一** | 使用 `app.css` 和 `localStorage` 持久化主题选择 |

#### 快照页面
| 变更 | 详情 |
|------|------|
| **动态更新** | 删除快照后存储空间实时更新，无需刷新页面 |
| **统计ID** | 添加 `stats-size` ID 便于 JS 操作 |

#### 任务进度 UI
| 变更 | 详情 |
|------|------|
| **紧凑布局** | 首页任务进度改为一行内联显示：图标+进度+进度条+状态 |

#### AI 分类优化
| 变更 | 详情 |
|------|------|
| **提示词改进** | 明确分类判断优先级（域名→类型→标题），强调JSON格式 |
| **Fallback兜底** | AI失败时使用 `fallbackClassification()` 关键词匹配 |
| **Token估算** | 任务创建时计算并保存Token估算到 `jobs.extra` |
| **费用显示** | job.ejs 显示预估Token和费用（CNY） |

#### AI 精简优化
| 变更 | 详情 |
|------|------|
| **层级分类** | 支持路径格式如 `技术/编程`，递归创建层级 |
| **空分类清理** | 删除空分类时递归检查并清理空父分类 |

#### 数据库迁移
| 变更 | 详情 |
|------|------|
| **jobs.extra** | 新增 `extra TEXT` 列存储 Token 估算等扩展信息 |

---

### 2026-01-08 Session 2 - 快照和扩展优化

#### 快照功能修复
| 变更 | 详情 |
|------|------|
| **路径一致性** | `snapshotsDir` 改为根据 `DB_PATH` 动态计算，解决容器内路径不匹配问题 |
| **ID查询** | 查看/下载路由改为通过数据库ID查找文件名，而非信任URL参数 |
| **下载端点** | 新增 `GET /api/snapshots/:id/download`，设置 Content-Disposition |
| **页面刷新** | 添加🔄刷新按钮到筛选栏，使用 `location.reload()` |
| **实时搜索** | 搜索和日期过滤改为AJAX实时过滤，无需刷新页面 |
| **EJS语法** | 修复 `<%- JSON.stringify() %>` 语法问题 |

#### 扩展优化
| 变更 | 详情 |
|------|------|
| **按钮重命名** | 保存书签→收藏、快照→存档、全部→收藏+存档 |
| **移除功能** | 移除"检查链接"功能 |
| **乐观UI** | 缓存连接状态5分钟，再次打开扩展立即显示已连接 |
| **后台验证** | 使用缓存时后台静默验证Token有效性 |

#### CORS 支持
| 变更 | 详情 |
|------|------|
| **新增依赖** | `@fastify/cors` 支持跨域请求 |
| **Session Cookie** | `sameSite: 'lax'`, `secure: 'auto'` 自动检测HTTPS |
| **认证端点** | 新增 `POST /api/auth/session`（预留，当前未使用） |

#### 暗黑模式修复
| 变更 | 详情 |
|------|------|
| **首页闪烁** | 添加主题初始化脚本到 `index.ejs` head，防止导航闪烁 |

---

### 2026-01-08 v2.0.0 重大更新

#### 浏览器扩展优化
| 变更 | 详情 |
|------|------|
| **快照文件名** | 从 `timestamp_random.html` 改为 `标题_时间戳.html`，便于识别 |
| **代码清理** | 移除所有调试 `console.log`，简化代码结构 |
| **旧扩展删除** | 删除 `extension/` 目录，仅保留 `extension-new/` |
| **UI 重设计** | 全新暗色现代风格，紧凑布局，320px 宽度即可显示全部内容 |
| **README** | 新增扩展安装和使用文档 |
| **文件**: `extension-new/popup.html`, `popup.css`, `popup.js`, `content.js`, `README.md` |

#### 登录增强
| 变更 | 详情 |
|------|------|
| **记住密码** | 新增"记住我（7天内免登录）"复选框 |
| **实现方式** | 勾选后设置 `maxAge: 7 * 24 * 60 * 60 * 1000` |
| **文件**: `views/login.ejs`, `src/index.ts` |

#### 暗黑模式
| 变更 | 详情 |
|------|------|
| **CSS 变量** | 定义 `--bg-primary`, `--text-primary` 等变量，支持 light/dark 主题 |
| **主题切换** | 页面右上角 🌙/☀️ 按钮，localStorage 持久化 |
| **系统偏好** | 支持 `prefers-color-scheme` 媒体查询自动跟随系统 |
| **文件**: `public/app.css`, `public/app.js`, `views/index.ejs` |

#### 键盘快捷键
| 快捷键 | 功能 |
|--------|------|
| `/` | 聚焦搜索框 |
| `N` | 打开新建书签对话框（非输入框状态） |
| `ESC` | 关闭所有弹窗和下拉菜单 |
| **文件**: `public/app.js` (`initKeyboardShortcuts` 函数) |

#### 书签描述编辑
| 变更 | 详情 |
|------|------|
| **UI 入口** | 书签操作下拉菜单添加"添加描述"按钮 |
| **模态框** | 显示书签标题，textarea 编辑描述 |
| **API** | 调用 `PATCH /api/bookmarks/:id/description` |
| **文件**: `views/index.ejs`, `public/app.js` |

#### 分类图标/颜色 UI
| 变更 | 详情 |
|------|------|
| **图标显示** | 分类列表每项前显示图标（默认 📁） |
| **颜色显示** | 分类名称支持自定义颜色 |
| **编辑入口** | 悬停分类项显示 🎨 按钮 |
| **模态框** | 16 个预设图标 + 9 种预设颜色选择 |
| **API** | 调用 `PATCH /api/categories/:id/style` |
| **文件**: `views/index.ejs`, `public/app.js` |

#### 书签卡片视图
| 变更 | 详情 |
|------|------|
| **视图切换** | 书签列表标题旁 📋 表格/🗂️ 卡片切换按钮 |
| **卡片布局** | 响应式网格：1/2/3 列（移动端/平板/桌面） |
| **卡片内容** | 标题（2行）、URL、分类标签、状态、描述（2行） |
| **持久化** | localStorage 保存视图模式偏好 |
| **文件**: `views/index.ejs`, `public/app.js` |

#### 快照管理页面
| 变更 | 详情 |
|------|------|
| **新页面** | `/snapshots` 快照管理页面 |
| **API** | `GET /api/snapshots` 列表、`GET /snapshots/:filename` 下载、`DELETE /api/snapshots/:id` 删除 |
| **统计** | 显示快照总数和总存储空间 |
| **导航** | 页面头部添加"快照"链接 |
| **文件**: `views/snapshots.ejs`, `src/index.ts` |

---

### 2026-01-07 v1.x 更新

#### 设置页模板化
- **问题**: `index.ts` 包含约 600 行内嵌 HTML 设置页，难以维护
- **方案**: 使用 Python 脚本提取 HTML 到 `views/settings.ejs`
- **效果**: `index.ts` 从 3591 行减少到 2999 行（-592 行）

#### CDN 本地化
- **问题**: TailwindCSS 和 AlpineJS 从外部 CDN 加载，离线不可用
- **方案**: 下载固定版本到 `public/lib/`
- **文件**: `public/lib/alpine.min.js` (44KB), `public/lib/tailwind.js` (407KB)

#### 分类图标/颜色 API
- **新增**: `icon`/`color` 字段数据库迁移
- **新增**: `PATCH /api/categories/:id/style` API

#### SingleFile 快照集成
- **实现**: 扩展添加"📸 保存快照"按钮
- **后端**: 新增 `POST /api/snapshots` API
- **存储**: 快照保存到 `data/snapshots/` 目录

#### 书签字段扩展
- **新增**: `description` 描述字段、`is_starred` 收藏字段
- **新增**: `PATCH /api/bookmarks/:id/star` 和 `/description` API

#### Token/费用预估
- **新增**: `POST /api/ai/estimate` API
- **功能**: AI 分类前预估 Token 消耗和费用

#### AI Prompt 优化
- **效果**: Token 消耗减少 60-70%
- **变更**: 分类层级限制从 3 级改为 2 级

#### 代码架构优化
- **提取**: 8 个通用函数到 `utils/helpers.ts`
- **清理**: 删除旧版 `index-new.ejs`/`app-new.js` 文件

### 2026-01-09 Session 3 - 分类树状结构重构

> [!IMPORTANT]
> 将分类从伪层级（基于名称路径）改为真正的树状结构（基于 parent_id）

#### 架构决策
| 决策 | 原因 |
|------|------|
| **邻接表模型** | 固定 2 级深度，无需递归查询 |
| **强制 2 级** | 一级分类 / 二级分类，简化 UI 和逻辑 |
| **删除行为** | 删除分类时书签移到未分类 |

#### 新增文件
| 文件 | 职责 |
|------|------|
| `src/category-service.ts` | 分类树状结构服务模块，统一管理所有分类 CRUD 操作 |

#### 数据库变更 (`db.ts`)
| 变更 | 详情 |
|------|------|
| `sort_order` | 添加分类排序字段 |
| `idx_categories_parent_id` | 添加 parent_id 索引优化树状查询 |

#### API 变更 (`index.ts`)
| 端点 | 变更 |
|------|------|
| `GET /api/categories` | 新增 `?tree=true` 返回树状结构 |
| `POST /api/categories` | 支持 `parent_id` 创建子分类 |
| `PATCH /api/categories/:id` | 新增重命名端点 |
| `PATCH /api/categories/:id/move` | 新增移动分类端点 |
| `DELETE /api/categories/:id` | 新增删除端点（书签移到未分类）|

#### 前端变更 (`app.js`, `index.ejs`)
| 变更 | 详情 |
|------|------|
| **树状 UI** | 分类侧边栏改为折叠/展开树状结构 |
| **新状态** | `categoryTree`, `expandedCategories` |
| **新方法** | `toggleCategoryExpand()`, `createSubCategory()`, `deleteCategory()` |

#### 导入导出兼容 (`importer.ts`, `exporter.ts`)
| 模块 | 变更 |
|------|------|
| `importer.ts` | 使用 `getOrCreateCategoryByPath` 创建层级分类 |
| `exporter.ts` | 通过 parent_id JOIN 构建完整路径导出 |

#### AI 模块更新
| 模块 | 变更 |
|------|------|
| `ai-classifier.ts` | `getOrCreateCategoryId` 改用 `category-service` |
| `ai-simplify-job.ts` | `getOrCreateHierarchicalCategory` 改用 `category-service` |