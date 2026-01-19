# 路由模块整合指南

## 已创建的模块

路径: `src/routes/`

| 文件 | 功能 | 对应原 index.ts 行号 |
|------|------|---------------------|
| `types.ts` | 公共类型 | 58-79, 其他辅助函数 |
| `bookmarks.ts` | 书签 CRUD | 1642-1685, 2842-2874, 3199-3294 |
| `categories.ts` | 分类管理 | 1826-2066 |
| `settings.ts` | 设置页面 | 583-764, 785-808 |
| `snapshots.ts` | 快照管理 | 628-665, 2876-2970 |
| `backups.ts` | 备份管理 | 1623-1826 |

## 整合步骤

### 1. 添加导入

在 `src/index.ts` 顶部添加：

```typescript
import { 
  bookmarkRoutes, 
  categoryRoutes, 
  settingsRoutes, 
  snapshotRoutes, 
  backupRoutes 
} from './routes';
```

### 2. 注册路由插件

在 `app.register(fastifyStatic, ...)` 之后添加：

```typescript
// 注册路由模块
await app.register(bookmarkRoutes, { db });
await app.register(categoryRoutes, { db });
await app.register(snapshotRoutes, { db, snapshotsDir });
await app.register(backupRoutes, { db, backupDir, runBackupNow });
await app.register(settingsRoutes, { 
  db, envFilePath, dbPath, backupDir,
  checkRetries, checkRetryDelayMs, backupEnabled, backupIntervalMinutes, backupRetention,
  periodicCheckEnabled, periodicCheckSchedule, periodicCheckHour,
  getSetting, setSetting, getIntSetting, getBoolSetting,
  effectiveCheckRetries, effectiveCheckRetryDelayMs, effectiveBackupEnabled,
  effectiveBackupIntervalMinutes, effectiveBackupRetention,
  effectivePeriodicCheckSchedule, effectivePeriodicCheckHour,
  writeDotEnvFile,
});
```

### 3. 删除原有重复路由

搜索并删除以下路由定义（已在模块中实现）：
- `/api/bookmarks` 相关
- `/api/categories` 相关  
- `/settings` 相关
- `/api/backups` 相关
- `/snapshots` 相关

### 4. 验证

```bash
npm run build
npm run dev
# 测试各 API 端点
```

## 风险提示

> [!WARNING]
> index.ts 有 3500 行代码，建议分批替换：
> 1. 先注册一个模块，测试通过后删除对应原代码
> 2. 逐个模块替换，每次验证功能正常
> 3. 保留 Git 提交点以便回滚
