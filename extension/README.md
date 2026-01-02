# Bookmarks Manager 浏览器扩展

一键添加当前页面到 Bookmarks Manager。

## 安装步骤

### Chrome / Edge / Brave

1. 打开浏览器，进入扩展管理页面：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`

2. 开启右上角的"开发者模式"

3. 点击"加载已解压的扩展程序"

4. 选择 `extension` 文件夹

5. 扩展图标会出现在工具栏中

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`

2. 点击"临时载入附加组件"

3. 选择 `extension/manifest.json` 文件

## 使用说明

### 首次配置

1. 点击扩展图标打开弹出窗口

2. 点击"⚙️ 设置"展开设置区域

3. 输入服务器地址（如 `http://localhost:8080`）

4. 如果使用 API Token 认证，输入 Token

5. 点击"保存设置"

### 添加书签

1. 在要保存的网页上点击扩展图标

2. 标题和网址会自动填充

3. 选择分类（可选）

4. 点击"保存书签"

### 其他功能

- **打开管理器**：在新标签页打开 Bookmarks Manager
- **检查连接**：测试与服务器的连接状态

## 图标文件

扩展需要以下图标文件（放在 `icons/` 目录下）：

- `icon16.png` (16x16)
- `icon32.png` (32x32)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

可以使用 `icon.svg` 生成这些 PNG 文件：

```bash
# 使用 ImageMagick 转换
convert -background none -resize 16x16 icons/icon.svg icons/icon16.png
convert -background none -resize 32x32 icons/icon.svg icons/icon32.png
convert -background none -resize 48x48 icons/icon.svg icons/icon48.png
convert -background none -resize 128x128 icons/icon.svg icons/icon128.png
```

或使用在线工具如 https://cloudconvert.com/svg-to-png

## 认证方式

扩展支持两种认证方式：

### 1. Cookie 认证（推荐）

如果浏览器已登录 Bookmarks Manager，扩展会自动使用登录的 Cookie。

### 2. API Token 认证

在设置中输入 API Token，扩展会在请求头中携带 Token。

## 故障排除

### 连接失败

1. 检查服务器地址是否正确
2. 确保服务器正在运行
3. 检查是否有 CORS 限制

### 需要登录

1. 在浏览器中打开 Bookmarks Manager 并登录
2. 或使用 API Token 认证

### 书签已存在

书签基于规范化 URL 去重，如果提示已存在，说明该链接已保存过。
