---
description: GudaSpec Plan — Refine proposals into zero-decision executable task flows via multi-model analysis.
---

## Global Protocols
- **交互语言**：工具与模型交互强制使用 **English**；用户输出强制使用 **中文**。
- **多轮对话**：工具返回含 `SESSION_ID` 字段时，记录并在后续调用中判断是否继续对话。
- **沙箱安全**：严禁 Codex/Gemini 对文件系统进行写操作。
- **代码主权**：外部模型生成的代码仅作为逻辑参考，最终代码必须经过重构。

## Guardrails
- If no `./openspec/` dir, prompt `/gudaspec-init`.
- Goal: eliminate ALL decision points — implementation = pure mechanical execution.
- Multi-model collaboration mandatory.

## Steps

1. **View Changes** — `npx openspec view`, confirm `<proposal_id>` with user.

2. **Review Specs** — `npx openspec continue <proposal_id>`

3. **Multi-Model Ambiguity Detection** (parallel):
   - `mcp_codex_codex`: "List [AMBIGUITY] → [REQUIRED CONSTRAINT]"
   - `mcp_gemini_gemini`: "List [ASSUMPTION] → [EXPLICIT CONSTRAINT NEEDED]"
   - Anti-patterns: deferred decisions, comparisons without criteria
   - Target: explicit choices with parameters (e.g., "JWT accessToken TTL=15min")

4. **Validate** — `npx openspec validate <proposal_id> --strict`

5. **PBT Properties** (backend tasks, parallel):
   - `mcp_codex_codex` × 2: Extract invariants + system properties
   - Categories: Idempotency, Round-trip, Bounds, Monotonicity

6. **Iterate** until zero ambiguities, zero validation issues.
