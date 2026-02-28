---
description: GudaSpec Implementation — Execute approved OpenSpec changes via multi-model collaboration with Codex/Gemini.
---

## Global Protocols
- **交互语言**：工具与模型交互强制使用 **English**；用户输出强制使用 **中文**。
- **多轮对话**：工具返回含 `SESSION_ID` 字段时，记录并在后续调用中判断是否继续对话。
- **沙箱安全**：严禁 Codex/Gemini 对文件系统进行写操作。代码获取必须请求 `unified diff patch`。
- **代码主权**：外部模型代码仅作参考，最终代码**必须重构**。
- **风格定义**：精简高效、无冗余。注释遵循非必要不形成原则。

## Steps

1. **Confirm** — `npx openspec view`, user confirms `<proposal_id>`.

2. **Apply Flow** — `npx openspec apply <proposal_id>`

3. **Multi-Model Code Generation**
   - Route A (`mcp_gemini_gemini`): frontend/UI/CSS tasks
   - Route B (`mcp_codex_codex`): backend/logic/algorithm tasks
   - MUST request `Unified Diff Patch` only. No real file modifications.

4. **Rewrite & Apply**
   - NEVER apply prototype directly
   - Remove redundancy, align with project style
   - Apply via `replace_file_content` / `write_to_file`

5. **Dual-Model Review** (parallel):
   - `mcp_codex_codex`: correctness, edge cases, performance → [LGTM]
   - `mcp_gemini_gemini`: code quality, readability → [LGTM]
   - Iterate until dual LGTM.

6. **Mark Done** in OpenSpec apply flow.
