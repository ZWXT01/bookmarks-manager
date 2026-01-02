# Bookmarks Manager

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
- **AI 分类**：使用 OpenAI 兼容 API 自动分类书签
- **AI 精简**：智能合并相似分类，简化分类结构
- **批量处理**：支持批量 AI 分类

### 安全特性
- **用户认证**：内置登录系统，支持密码修改
- **IP 锁定**：10次登录失败后锁定 IP 30分钟
- **Session 管理**：安全的会话管理

### 其他特性
- **任务队列**：后台任务处理，支持取消
- **实时进度**：SSE 实时显示任务进度
- **自动备份**：定时备份数据库
- **响应式 UI**：现代化的 Web 界面

## 🚀 快速开始

### Docker 部署（推荐）

```bash
# 克隆项目
git clone <repository-url>
cd bookmarks_manager

# 启动服务
docker compose up -d --build

# 访问
# http://localhost:8080
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

## ⚙️ 环境变量

### 基础配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `8080` |
| `DB_PATH` | SQLite 文件路径 | `/data/app.db` |
| `SESSION_SECRET` | Session 密钥 | 随机生成 |

### 认证配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AUTH_USERNAME` | 默认用户名 | `admin` |
| `AUTH_PASSWORD` | 默认密码 | `admin` |

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
| `BACKUP_DIR` | 备份目录 | `./backups` |

## 📁 项目结构

```
bookmarks_manager/
├── src/                    # TypeScript 源码
│   ├── index.ts           # 主入口，路由定义
│   ├── db.ts              # 数据库初始化
│   ├── auth.ts            # 认证模块
│   ├── checker.ts         # 书签检查器
│   ├── importer.ts        # 导入模块
│   ├── exporter.ts        # 导出模块
│   ├── jobs.ts            # 任务队列
│   ├── ai-classifier.ts   # AI 分类器
│   ├── ai-classify-job.ts # AI 分类任务
│   └── ai-simplify-job.ts # AI 精简任务
├── views/                  # EJS 模板
├── public/                 # 静态资源
├── data/                   # 数据目录（Docker 挂载）
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 🔌 浏览器扩展

项目包含一个浏览器扩展，支持一键添加当前页面到书签管理器。

### 安装扩展

1. 打开浏览器扩展管理页面（`chrome://extensions/` 或 `edge://extensions/`）
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `extension` 文件夹

### 生成图标

```bash
cd extension
chmod +x generate-icons.sh
./generate-icons.sh
```

### 配置扩展

1. 点击扩展图标
2. 展开"⚙️ 设置"
3. 输入服务器地址（如 `http://localhost:8080`）
4. 可选：输入 API Token

详细说明请参考 `extension/README.md`

## 🔍 高级搜索

书签列表支持多种搜索和筛选方式：

### 搜索功能
- **多关键词搜索**：空格分隔多个关键词，同时匹配标题和 URL
- **检查状态筛选**：全部/未检查/正常/访问失败
- **忽略检查筛选**：全部/已忽略/未忽略
- **日期范围筛选**：按创建时间筛选
- **域名筛选**：按域名过滤书签
- **排序选项**：按 ID/标题/创建时间/检查时间 升序/降序

### API 参数

`GET /api/bookmarks` 支持以下查询参数：

| 参数 | 说明 | 示例 |
|------|------|------|
| `q` | 搜索关键词（空格分隔） | `github python` |
| `category` | 分类 ID 或 `uncategorized` | `1` |
| `status` | 检查状态 | `ok`/`fail`/`not_checked` |
| `skip_check` | 忽略检查 | `1`/`0` |
| `date_from` | 开始日期 | `2024-01-01` |
| `date_to` | 结束日期 | `2024-12-31` |
| `domain` | 域名筛选 | `github.com` |
| `sort` | 排序字段 | `id`/`title`/`created_at`/`last_checked_at` |
| `order` | 排序方向 | `asc`/`desc` |
| `page` | 页码 | `1` |
| `pageSize` | 每页数量 | `50` |

## 🔧 API 接口

### 书签管理
- `GET /api/bookmarks` - 获取书签列表（支持高级搜索）
- `POST /api/bookmarks` - 添加书签
- `PUT /api/bookmarks/:id` - 更新书签
- `DELETE /api/bookmarks/:id` - 删除书签
- `PATCH /api/bookmarks/:id/status` - 更新检查状态
- `PATCH /api/bookmarks/:id/skip-check` - 切换忽略检查

### 分类管理
- `GET /api/categories` - 获取分类列表
- `POST /api/categories` - 添加分类
- `PUT /api/categories/:id` - 更新分类
- `DELETE /api/categories/:id` - 删除分类

### 检查功能
- `POST /api/check/start` - 开始批量检查
- `POST /api/check/one/:id` - 检查单个书签

### AI 功能
- `POST /api/ai/classify` - AI 分类
- `POST /api/ai/simplify` - AI 精简分类
- `POST /api/ai/apply-simplify` - 应用精简建议

### 任务管理
- `GET /api/jobs` - 获取任务列表
- `GET /api/jobs/:id` - 获取任务详情
- `DELETE /api/jobs/:id` - 删除任务
- `POST /api/jobs/clear` - 清理已完成任务

## 🔒 安全建议

### 生产环境部署
1. **修改默认密码**：首次登录后立即修改默认密码
2. **使用 HTTPS**：通过 Nginx 反向代理配置 SSL
3. **限制访问**：配置 IP 白名单或 VPN 访问
4. **定期备份**：启用自动备份功能

### Nginx 反向代理配置

```nginx
server {
    listen 443 ssl;
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
# 停止容器
docker compose down

# 复制数据库文件
cp ./data/app.db ./backup/app.db.$(date +%Y%m%d)

# 重新启动
docker compose up -d
```

### 数据迁移
```bash
# 在新服务器上
mkdir -p ./data
cp /path/to/backup/app.db ./data/app.db
docker compose up -d
```

## 🐛 常见问题

### SSE 进度不刷新
如果任务进度页面不实时更新，通常是 Nginx 缓冲导致：
- 添加 `proxy_buffering off;`
- 添加 `X-Accel-Buffering: no` 响应头（程序已设置）

### 检查失败率高
1. 增加超时时间：`CHECK_TIMEOUT_MS=10000`
2. 增加重试次数：`CHECK_RETRIES=2`
3. 降低并发数：`CHECK_CONCURRENCY=10`
4. 对特定书签设置"忽略检查"

### AI 分类不工作
1. 检查 AI 配置（Base URL、API Key、Model）
2. 使用设置页面的"测试连接"功能
3. 确保 API 配额充足

## 📄 许可证

MIT License
