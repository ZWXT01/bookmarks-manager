---
description: GudaSpec Research — Transform user requirements into constraint sets through parallel multi-model exploration.
---

## Global Protocols
- **交互语言**：工具与模型交互强制使用 **English**；用户输出强制使用 **中文**。
- **多轮对话**：工具返回含 `SESSION_ID` 字段时，记录并在后续调用中判断是否继续对话。
- **沙箱安全**：严禁 Codex/Gemini 对文件系统进行写操作。
- **代码主权**：外部模型生成的代码仅作为逻辑参考。
- **上下文检索**：优先用 `mcp_fast-context_fast_context_search`，减少 search/find/grep 次数。
- **判断依据**：以项目代码、搜索结果为判断依据，严禁一般知识猜测。

## Core Philosophy
- Research produces **constraint sets**, not information dumps.
- Output: 「约束集合 + 可验证的成功判据」。
- **NEVER** divide by roles. **ALWAYS** divide by context boundaries.

## Steps

0. **Generate Proposal** — `npx openspec explore <user question>`

1. **Codebase Assessment** — `mcp_fast-context_fast_context_search`

2. **Define Context Boundaries** — Identify natural code boundaries (NOT functional roles).

3. **Output Template** — All agents must return:
   ```json
   {
     "module_name": "string",
     "existing_structures": [], "constraints_discovered": [],
     "open_questions": [], "risks": [], "success_criteria_hints": []
   }
   ```

4. **Parallel Multi-Model Dispatch**
   - `mcp_codex_codex` for backend context boundaries
   - `mcp_gemini_gemini` for frontend context boundaries
   - Each must return JSON template. Do NOT modify files.

5. **Aggregate** — Merge into hard/soft constraints, dependencies, risks.

6. **Ambiguity Resolution** — `notify_user` with prioritized questions.

7. **Generate Proposal** — `npx openspec ff <requirement>`
