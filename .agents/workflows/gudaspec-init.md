---
description: GudaSpec Init — Initialize OpenSpec environment and validate MCP tools for the current project.
---

## Global Protocols
- **交互语言**：工具与模型交互强制使用 **English**；用户输出强制使用 **中文**。
- **多轮对话**：工具返回含 `SESSION_ID` 字段时，记录并在后续调用中判断是否继续对话。
- **沙箱安全**：严禁 Codex/Gemini 对文件系统进行写操作。
- **代码主权**：外部模型生成的代码仅作为逻辑参考，最终代码必须经过重构。
- **上下文检索**：调用 `mcp_fast-context_fast_context_search` 时，减少 search/find/grep 次数。

## Steps

1. **Detect OS** — `run_command`: `uname -s`

2. **Install OpenSpec**
   - Check: `npx openspec --version`
   - Install: `npm install @fission-ai/openspec@latest`

3. **Initialize Project** — `npx openspec init --tools claude`

4. **Validate MCP Tools**
   - `mcp_codex_codex` — simple call to verify
   - `mcp_gemini_gemini` — simple call to verify
   - `mcp_fast-context_fast_context_search` — simple call to verify

5. **Summary** — `notify_user` with status table
