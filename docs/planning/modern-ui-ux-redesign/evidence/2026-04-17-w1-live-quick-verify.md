# 2026-04-17 W1 in_testing issue 快速验证索引

- 执行日期：`2026-04-17`
- 验证环境：`https://bookmarks.1018666.xyz`
- 覆盖 issue：`UIR-DEV-010`、`UIR-DEV-020`、`UIR-DEV-030`、`UIR-DEV-040`、`UIR-DEV-050`
- 验证目标：收口 W1 处于 `in_testing` 的 UI/UX 改造任务，确认真实站点已切到新页面壳体且关键选择器合同仍然有效。

## 1. 验证说明

- 本轮未改 `Dockerfile`、`docker-compose.yml`、`package.json`、`package-lock.json`，因此未把重型镜像构建作为关闭 W1 UI issue 的阻塞 gate。
- Racknerd 验证前已同步：
  - `views/`
  - `public/`
  - 修正后的 `dist/routes/settings.js`
- 真实站点认证验证通过“临时 API token 换 Session”完成；验证后临时 API token 已删除。
- 为覆盖任务详情页，验证时临时插入 1 条 synthetic failed job；验证后 synthetic job 与 `job_failures` 记录均已删除。

## 2. HTML / selector 快速检查

- `/login`
  - `data-testid="login-page"`：通过
  - `auth-showcase__title`：通过
  - 错误凭据返回 `login-error` 横幅：通过
- `/settings`
  - `data-testid="settings-overview-card"`：通过
  - `data-testid="settings-form-shell"`：通过
  - `data-testid="ai-batch-size-input"`：通过
- `/jobs`
  - `data-testid="jobs-overview-card"`：通过
  - `data-testid="jobs-table"`：通过
  - synthetic row 的 `jobs-row-status-badge` / `jobs-row-progress-bar`：通过
- `/jobs/:id`
  - `data-testid="job-detail-page"`：通过
  - `data-testid="job-summary-grid"`：通过
  - `data-testid="job-progress-percent"`：通过
  - failure table：通过
- `/snapshots`
  - `data-testid="snapshot-filter-bar"`：通过
  - `data-testid="snapshot-stats-card"`：通过
  - `data-testid="snapshot-list"`：通过

## 3. Playwright MCP 留证

- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-login-desktop.png`
- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-settings-desktop.png`
- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-settings-mobile.png`
- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-settings-dark-desktop.png`
- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-jobs-desktop.png`
- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-jobs-mobile.png`
- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-job-detail-desktop.png`
- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-snapshots-desktop.png`
- `.playwright-mcp/modern-ui-ux-redesign/2026-04-17/live-snapshots-mobile.png`

## 4. 结论

- `UIR-DEV-010`：通过
- `UIR-DEV-020`：通过
- `UIR-DEV-030`：通过
- `UIR-DEV-040`：通过
- `UIR-DEV-050`：通过

结论：W1 当前所有 `in_testing` issue 已完成 Racknerd 真实站点快速验证，可进入 `done / passed` 状态。
