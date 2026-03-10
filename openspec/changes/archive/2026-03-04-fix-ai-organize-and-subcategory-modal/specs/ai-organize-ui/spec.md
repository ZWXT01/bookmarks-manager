## MODIFIED Requirements

### Requirement: Organize entry point
前端 SHALL 提供统一的"AI 整理"入口，替换现有的"AI 分类"和"AI 精简"两个独立入口。

#### Scenario: User starts organize with AI success
- **WHEN** 用户点击"AI 整理"按钮，后端返回 `treeReady: true`
- **THEN** 前端设置 `organizePlan`，调用 `loadOrganizePlan()`，进入 editing 阶段

#### Scenario: User starts organize with AI failure
- **WHEN** 用户点击"AI 整理"按钮，后端返回 `treeReady: false` 和 `message`
- **THEN** 前端 toast 提示 `data.message || data.error`，仍进入 editing 阶段（允许手动编辑空树），用户明确知道 AI 未生效
