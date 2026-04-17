# Bookmarks Manager

[English](README.md) | [中文](README.zh-CN.md)

一个功能完善的自托管书签管理器，基于 Fastify + TypeScript + Alpine.js + SQLite 构建。

## ✨ 功能特性

### 核心功能
- **书签管理**：添加、编辑、删除、移动书签
- **分类管理**：支持多级分类，批量移动
- **导入/导出**：支持浏览器书签 HTML、JSON、TXT 格式
- **URL 去重**：基于规范化 URL 自动去重

### 书签检查
- **批量检查**：检查书签链接有效性
- **高并发**：支持 30+ 并发检查（可配置）
- **智能重试**：失败自动重试，可配置次数和间隔
- **忽略检查**：可标记特定书签跳过检查
- **定期检查**：支持每周/每月自动检查（凌晨执行）

### AI 功能
- **AI 分类**：通过 OpenAI 兼容 API 对单个书签进行分类
- **AI 批量分类**：为选中的书签启动后台批量分类任务
- **AI 整理计划**：生成、复核、应用、重试与回滚分类分配计划

当前 AI 运行时配置统一在设置页填写：`Base URL`、`API Key`、`Model`。遗留的 `ai_simplify` 仅作为 backlog 保留，不属于当前发布范围。

### 安全特性
- **用户认证**：内置登录系统，支持密码修改
- **API Token**：支持生成多个 API Token，用于浏览器扩展和第三方应用
- **IP 锁定**：10次登录失败后锁定 IP 30分钟
- **Session 管理**：安全的会话管理

### 其他特性
- **浏览器扩展**：一键添加当前页面为书签
- **任务队列**：后台任务处理，支持取消
- **实时进度**：SSE 实时显示任务进度
- **自动备份**：定时备份数据库
- **响应式 UI**：现代化的 Web 界面

## 🚀 快速开始

### Docker 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/ZWXT01/bookmarks-manager.git
cd bookmarks-manager

# 启动服务
docker compose up -d --build

# 访问 http://localhost:8080
# 默认账号：admin / admin
```

### 本地开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 生产模式
npm start
```

### 发布验收

当前仓库的 release gate 以以下项目为准：

- `npm test`
- `npm run build`
- 基于 `scripts/playwright-mcp-smoke-env.ts` 启动本地临时服务的内置 Playwright MCP smoke
- `npx tsx scripts/extension-roundtrip-validate.ts` 扩展 popup round-trip 验收
- 记录在 `docs/planning/functional-hardening-and-ai-validation/10-ai-provider-h1-validation.md` 的真实 provider AI 验收

## ⚙️ 环境变量

### 基础配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `8080` |
| `DB_PATH` | SQLite 文件路径 | `./data/app.db` |
| `SESSION_SECRET` | Session 密钥 | 随机生成 |

### 认证配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AUTH_USERNAME` | 默认用户名 | `admin` |
| `AUTH_PASSWORD` | 默认密码 | `admin` |
| `API_TOKEN` | 静态 API Token（可选） | - |

### 检查配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CHECK_CONCURRENCY` | 检查并发数 | `30` |
| `CHECK_TIMEOUT_MS` | 检查超时(ms) | `5000` |
| `CHECK_RETRIES` | 失败重试次数 | `1` |
| `CHECK_RETRY_DELAY_MS` | 重试间隔(ms) | `500` |

### 定期检查配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PERIODIC_CHECK_ENABLED` | 启用定期检查 | `0` |
| `PERIODIC_CHECK_SCHEDULE` | 检查周期 (`weekly`/`monthly`) | `weekly` |
| `PERIODIC_CHECK_HOUR` | 执行时间 (2-5点) | `2` |

### 备份配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `BACKUP_ENABLED` | 启用自动备份 | `0` |
| `BACKUP_INTERVAL_MINUTES` | 备份间隔(分钟) | `1440` |
| `BACKUP_RETENTION` | 保留份数 | `10` |
| `BACKUP_DIR` | 备份目录 | `./data/backups` |

## 🔑 API Token

API Token 用于浏览器扩展或第三方应用访问 API，无需 Cookie 认证。

### 生成 Token

1. 登录 Web 管理界面
2. 进入「设置」页面
3. 在「API Tokens」部分点击「创建 Token」
4. 输入名称，选择有效期（可选）
5. **立即复制并保存 Token**（只显示一次）

### 使用 Token

在 API 请求中添加 Authorization 头：

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-domain.com/api/bookmarks
```

### Token 管理

- 支持创建多个 Token，分别用于不同应用
- 可设置有效期：7天 / 30天 / 90天 / 1年 / 永不过期
- 可随时删除不再使用的 Token
- 系统自动清理过期 Token

## 🔌 浏览器扩展

项目包含浏览器扩展，支持一键添加当前页面到书签管理器。

### 安装扩展

1. 打开浏览器扩展管理页面
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Firefox: `about:addons`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目中的 `extension-new` 文件夹

### 配置扩展

1. 点击扩展图标，展开「⚙️ 设置」
2. 输入服务器地址（如 `https://bookmarks.example.com`）
3. 输入 API Token（在 Web 设置页面生成）
4. 点击「保存设置」

### 使用扩展

1. 浏览任意网页
2. 点击扩展图标
3. 选择分类（可选）
4. 点击「保存书签」

## 📁 项目结构

```
bookmarks-manager/
├── src/                    # TypeScript 源码
│   ├── app.ts             # Fastify 应用工厂与路由注册
│   ├── index.ts           # 服务启动入口
│   ├── db.ts              # 数据库初始化与 schema 引导
│   ├── auth.ts            # 认证辅助
│   ├── checker.ts         # 书签检查器
│   ├── importer.ts        # 导入模块
│   ├── exporter.ts        # 导出模块
│   ├── jobs.ts            # 任务队列
│   ├── ai-organize.ts     # AI 分类分配执行器
│   ├── ai-organize-plan.ts # AI 整理计划生命周期
│   └── routes/            # 模块化路由处理器
├── views/                  # EJS 模板
├── public/                 # 静态资源
├── extension-new/          # 浏览器扩展
├── data/                   # 数据目录（Docker 挂载）
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 🔧 API 接口

所有 API 接口需要认证（Session 或 API Token）。

### 认证方式

```bash
# 方式1：API Token（推荐用于扩展和脚本）
curl -H "Authorization: Bearer YOUR_TOKEN" https://your-domain.com/api/bookmarks

# 方式2：Session Cookie（Web 界面使用）
```

### 书签管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bookmarks` | 获取书签列表（支持搜索筛选） |
| POST | `/api/bookmarks` | 添加书签 |
| POST | `/api/bookmarks/:id/update` | 更新书签 |
| POST | `/api/bookmarks/move` | 批量移动书签 |
| DELETE | `/api/bookmarks/:id` | 删除书签 |

### 分类管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories` | 获取分类列表 |
| POST | `/api/categories` | 添加分类 |
| PATCH | `/api/categories/:id` | 更新分类 |
| PATCH | `/api/categories/:id/move` | 移动分类 |
| POST | `/api/categories/reorder` | 重排同级分类 |
| DELETE | `/api/categories/:id` | 删除分类 |

### Token 管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tokens` | 获取 Token 列表 |
| POST | `/api/tokens` | 创建新 Token |
| DELETE | `/api/tokens/:id` | 删除 Token |

### 检查功能
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/check/start` | 开始批量检查 |
| POST | `/api/check/one/:id` | 检查单个书签 |

### AI 路由
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/test` | 测试设置页中的 AI 配置 |
| POST | `/api/ai/classify` | 对单个书签做 AI 分类 |
| POST | `/api/ai/classify-batch` | 为指定书签 ID 启动后台批量分类 |
| POST | `/api/ai/organize` | 按 scope 启动整理计划 |
| GET | `/api/ai/organize/active` | 获取当前 assigning 计划 |
| GET | `/api/ai/organize/pending` | 列出待处理的 preview 计划 |
| GET | `/api/ai/organize/:planId` | 获取计划详情与 diff |
| GET | `/api/ai/organize/:planId/assignments` | 分页获取 enriched assignments |
| POST | `/api/ai/organize/:planId/apply` | 应用计划并返回冲突/空分类信息 |
| POST | `/api/ai/organize/:planId/apply/resolve` | 解决冲突后完成应用 |
| POST | `/api/ai/organize/:planId/apply/confirm-empty` | 确认空分类处理决策 |
| POST | `/api/ai/organize/:planId/rollback` | 回滚已应用计划 |
| POST | `/api/ai/organize/:planId/cancel` | 取消待处理/执行中的计划 |
| POST | `/api/ai/organize/:planId/retry` | 重试失败计划 |

## 🔍 高级搜索

`GET /api/bookmarks` 支持以下查询参数：

| 参数 | 说明 | 示例 |
|------|------|------|
| `q` | 搜索关键词（空格分隔） | `github python` |
| `category` | 分类 ID 或 `uncategorized` | `1` |
| `status` | 检查状态 | `ok` / `fail` / `not_checked` |
| `skip_check` | 忽略检查 | `1` / `0` |
| `date_from` | 开始日期 | `2024-01-01` |
| `date_to` | 结束日期 | `2024-12-31` |
| `domain` | 域名筛选 | `github.com` |
| `sort` | 排序字段 | `id` / `title` / `created_at` |
| `order` | 排序方向 | `asc` / `desc` |
| `page` | 页码 | `1` |
| `pageSize` | 每页数量 | `50` |

## 🔒 安全建议

### 生产环境部署

1. **修改默认密码**：首次登录后立即修改
2. **使用 HTTPS**：通过 Nginx 反向代理配置 SSL
3. **限制访问**：配置 IP 白名单或 VPN
4. **定期备份**：启用自动备份功能
5. **Token 管理**：定期清理不用的 Token，设置合理有效期

### Nginx 反向代理配置

```nginx
server {
    listen 443 ssl http2;
    server_name bookmarks.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600;
    }
}
```

## 📦 数据备份与迁移

### 手动备份

```bash
# Docker 部署
docker compose exec app sqlite3 /data/app.db ".backup '/data/backup.db'"

# 或直接复制
cp ./data/app.db ./data/app.db.backup
```

### 内置还原范围

内置还原接口只会对 `categories` 和 `bookmarks` 做显式部分恢复。执行前会先创建 `pre_restore_*.db` 回滚点，不会覆盖设置、API Token、模板、快照等运维元数据。

### 数据迁移

```bash
# 在新服务器上
mkdir -p ./data
scp old-server:/path/to/data/app.db ./data/
docker compose up -d
```

## 🐛 常见问题

### 扩展显示「网络错误」

1. 检查服务器地址是否正确（包含 `https://`）
2. 确认 API Token 已正确配置
3. 检查服务器是否正常运行
4. 查看浏览器控制台错误信息

### SSE 进度不刷新

Nginx 缓冲导致，添加配置：
```nginx
proxy_buffering off;
```

### 检查失败率高

1. 增加超时：`CHECK_TIMEOUT_MS=10000`
2. 增加重试：`CHECK_RETRIES=2`
3. 降低并发：`CHECK_CONCURRENCY=10`

### AI 分类不工作

1. 检查 AI 配置（Base URL、API Key、Model）
2. 使用设置页面的「测试连接」功能
3. 确保 API 配额充足

## 📄 许可证

MIT License
