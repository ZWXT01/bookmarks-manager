# Win11 书签文件有效性检查管理工具

脚本位置：`scripts/bookmark_file_checker_gui.py`

## 运行环境

- Windows 11
- Python 3.10+（建议使用 python.org 官方安装包，默认包含 Tkinter）
- 无第三方依赖

运行：

```powershell
cd <项目目录>
python .\scripts\bookmark_file_checker_gui.py
```

也可以在资源管理器中双击该 `.py` 文件运行（前提是 `.py` 已关联到 Python）。

## 支持的书签文件

- Chrome / Edge / Firefox 导出的 Netscape HTML 书签文件（`.html` / `.htm`）
- 本项目导出的 JSON 书签数组（`.json`）
- 普通文本 URL 列表（`.txt` / `.csv` / `.md` 等，每行一个链接或包含一个链接）

## 检查逻辑

脚本参考 `src/checker.ts`：

1. URL 没有 `http://` 或 `https://` 时，先尝试 `https://`，失败后再尝试 `http://`。
2. 对每个 URL 先发 `HEAD` 请求。
3. 如果 `HEAD` 返回 `405 / 501 / 403 / 503 / 429`，再改用 `GET` 请求。
4. HTTP `200-399` 视为可用，其它状态码视为失效。
5. 默认参数：超时 `5000ms`、重试 `1` 次、重试延迟 `500ms`、并发 `30`。

## 删除失效书签

检查完成后，界面默认只显示失效书签：

1. 点击第一列“勾选”或使用“全选当前失效”。
2. 点击“删除勾选失效书签”。
3. 脚本会先在同目录生成备份：`原文件名.bak-YYYYMMDD-HHMMSS`。
4. 然后覆盖原文件并重新载入。

## 注意事项

- 部分网站会拦截自动化请求或禁止 `HEAD`，脚本已按项目逻辑对常见状态码回退到 `GET`，但仍可能存在误判。
- Netscape HTML 删除后会重新生成标准书签 HTML；书签层级会保留，但浏览器导出中的部分非标准属性或空文件夹可能不会完全原样保留。
- JSON 删除按解析到的对象路径删除；如果是非常规 JSON 结构，建议先备份并检查输出。
