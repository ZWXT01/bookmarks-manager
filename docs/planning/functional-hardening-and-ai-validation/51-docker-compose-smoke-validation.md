# R11-REL-02 docker compose 真实部署形态 smoke 验收记录

更新时间：2026-04-03

关联 issue：

- `R11-REL-02`

## 1. 目标

- 证明当前 Docker 交付物可以在真实容器形态下完成最小发布闭环，而不是只在 `createTestApp()` 临时环境里通过。
- 在不污染仓库默认 `data/` 的前提下，验证容器 build、启动、登录、写入与重启后的最小持久化。

## 2. 新增入口

- `scripts/docker-compose-smoke-validate.ts`
- `npm run validate:compose-smoke`

执行方式：

- 生成临时 compose 文件
- 使用随机 `127.0.0.1` 端口
- 使用临时数据目录 `/tmp/bookmarks-compose-smoke-*`
- 使用独立 project name
- 结束后自动：
  - `docker compose down --remove-orphans --rmi local`
  - 删除临时 compose 文件与临时数据目录

## 3. 本轮结果

### 3.1 容器 smoke 结果

- `npm run validate:compose-smoke` clean run 通过。
- 本轮临时 project：`bookmarks-delivery-smoke-1775180333628`
- 本轮临时容器：`bookmarks-delivery-smoke-1775180333628-app`
- 本轮临时访问地址：`http://127.0.0.1:37037`
- 本轮临时数据目录：`/tmp/bookmarks-compose-smoke-uVUUHA/data`

### 3.2 验证项

| 项目 | 结果 |
|---|---|
| Docker 镜像 build | 通过 |
| 容器启动 | 通过 |
| 登录页静态资源合同 | 通过，仍只引用 `/public/tailwind.generated.css` |
| 登录 | 通过 |
| 首页新增书签 | 通过，新增标题 `Compose Smoke Bookmark 1775180492179` |
| 设置页访问 | 通过 |
| 任务页访问 | 通过 |
| 快照页访问 | 通过 |
| 容器重启后首页数据保持 | 通过 |
| 本地数据文件写入 | 通过，`app.db` 大小 `4096` bytes |

### 3.3 结构化输出

```json
{
  "projectName": "bookmarks-delivery-smoke-1775180333628",
  "containerName": "bookmarks-delivery-smoke-1775180333628-app",
  "baseUrl": "http://127.0.0.1:37037",
  "dataDir": "/tmp/bookmarks-compose-smoke-uVUUHA/data",
  "createdBookmarkTitle": "Compose Smoke Bookmark 1775180492179",
  "dbPath": "/tmp/bookmarks-compose-smoke-uVUUHA/data/app.db",
  "dbSizeBytes": 4096,
  "checkedPages": [
    "login",
    "settings",
    "jobs",
    "snapshots",
    "post-restart-home"
  ],
  "restartVerified": true
}
```

## 4. 交付结论

- 当前 Docker 交付物已经具备最小真实部署形态的 smoke 证据。
- 这条 smoke 证明了：
  - 镜像可以基于当前仓库完整 build
  - 容器可以启动并提供登录页
  - 会话登录正常
  - 数据目录可写
  - 最小业务写入在容器重启后仍能保留
- 这条 smoke 不覆盖：
  - 反向代理
  - TLS
  - 公网暴露
  - 多节点部署
  - 真实 AI provider
  - 扩展 runtime

## 5. 清理结论

- 临时 stack 已自动 `down`。
- 临时本地镜像已通过 `--rmi local` 删除。
- 临时 compose 文件和临时数据目录已删除。
- 本轮未写入仓库默认 `data/` 目录。
