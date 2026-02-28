#!/usr/bin/env bash
# GudaSpec for Antigravity IDE — Full Setup Script
# Installs workflow files + checks/installs all MCP dependencies
#
# Usage:
#   ./install-gudaspec.sh [OPTIONS]
#
# Options:
#   --project, -p    Install workflows to ./.agents/workflows/ (default)
#   --user, -u       Install workflows to ~/.agents/workflows/
#   --deps-only      Only check/install dependencies, skip workflow files
#   --workflows-only Only install workflow files, skip dependency checks
#   --help, -h       Show this help

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

# ── Parse arguments ──────────────────────────────────────────────
TARGET_MODE="project"
INSTALL_DEPS=true
INSTALL_WORKFLOWS=true

for arg in "$@"; do
  case "$arg" in
    --user|-u)           TARGET_MODE="user" ;;
    --project|-p)        TARGET_MODE="project" ;;
    --deps-only)         INSTALL_WORKFLOWS=false ;;
    --workflows-only)    INSTALL_DEPS=false ;;
    --help|-h)
      sed -n '2,/^$/s/^# //p' "$0"
      exit 0 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   GudaSpec for Antigravity IDE Setup     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Phase 1: Dependency Detection & Installation ─────────────────
if $INSTALL_DEPS; then
  echo "Phase 1: Checking dependencies..."
  echo ""
  MISSING=0

  # 1.1 Node.js
  if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
      ok "Node.js $NODE_VER"
    else
      warn "Node.js $NODE_VER (需要 >= 18)"
      MISSING=$((MISSING+1))
    fi
  else
    fail "Node.js 未安装"
    info "安装: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    info "  或: nvm install 20"
    MISSING=$((MISSING+1))
  fi

  # 1.2 npm
  if command -v npm &>/dev/null; then
    ok "npm $(npm --version)"
  else
    fail "npm 未安装 (通常随 Node.js 一起安装)"
    MISSING=$((MISSING+1))
  fi

  # 1.3 uv (Python package manager, for uvx)
  if command -v uv &>/dev/null; then
    ok "uv $(uv --version 2>/dev/null | head -1)"
  else
    fail "uv 未安装"
    info "安装: curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo ""
    read -rp "  是否现在自动安装 uv？[Y/n] " ans
    if [[ -z "$ans" || "$ans" =~ ^[Yy]$ ]]; then
      curl -LsSf https://astral.sh/uv/install.sh | sh
      export PATH="$HOME/.local/bin:$PATH"
      if command -v uv &>/dev/null; then
        ok "uv 安装成功: $(uv --version 2>/dev/null | head -1)"
      else
        fail "uv 安装失败，请手动安装"
        MISSING=$((MISSING+1))
      fi
    else
      MISSING=$((MISSING+1))
    fi
  fi

  # 1.4 Codex CLI
  if command -v codex &>/dev/null; then
    ok "Codex CLI $(codex --version 2>/dev/null | head -1)"
  else
    fail "Codex CLI 未安装"
    info "安装: npm install -g @openai/codex"
    echo ""
    read -rp "  是否现在自动安装 Codex CLI？[Y/n] " ans
    if [[ -z "$ans" || "$ans" =~ ^[Yy]$ ]]; then
      npm install -g @openai/codex
      if command -v codex &>/dev/null; then
        ok "Codex CLI 安装成功"
      else
        fail "Codex CLI 安装失败"
        MISSING=$((MISSING+1))
      fi
    else
      MISSING=$((MISSING+1))
    fi
  fi

  # 1.5 Gemini CLI
  if command -v gemini &>/dev/null; then
    ok "Gemini CLI $(gemini --version 2>/dev/null | head -1)"
  else
    fail "Gemini CLI 未安装"
    info "安装: npm install -g @google/gemini-cli"
    echo ""
    read -rp "  是否现在自动安装 Gemini CLI？[Y/n] " ans
    if [[ -z "$ans" || "$ans" =~ ^[Yy]$ ]]; then
      npm install -g @google/gemini-cli
      if command -v gemini &>/dev/null; then
        ok "Gemini CLI 安装成功"
      else
        fail "Gemini CLI 安装失败"
        MISSING=$((MISSING+1))
      fi
    else
      MISSING=$((MISSING+1))
    fi
  fi

  echo ""
  if [ $MISSING -gt 0 ]; then
    warn "有 $MISSING 项依赖缺失，工作流可能无法正常运行"
  else
    ok "所有依赖就绪"
  fi

  # 1.6 Generate MCP config for Antigravity
  echo ""
  MCP_DIR="$HOME/.gemini/antigravity"
  MCP_FILE="$MCP_DIR/mcp_config.json"

  # Auto-detect WINDSURF_API_KEY from existing sources
  WS_KEY=""
  if [ -f "$MCP_FILE" ]; then
    WS_KEY=$(grep -o '"WINDSURF_API_KEY"[[:space:]]*:[[:space:]]*"[^"]*"' "$MCP_FILE" 2>/dev/null \
      | head -1 | sed 's/.*: *"//;s/"$//')
  fi
  if [ -z "$WS_KEY" ] && [ -f "$HOME/.claude.json" ]; then
    WS_KEY=$(grep -o '"WINDSURF_API_KEY"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.claude.json" 2>/dev/null \
      | head -1 | sed 's/.*: *"//;s/"$//')
  fi

  write_mcp_config() {
    mkdir -p "$MCP_DIR"
    if [ -n "$WS_KEY" ]; then
      local ENV_BLOCK="\"env\": { \"WINDSURF_API_KEY\": \"$WS_KEY\" }"
    else
      local ENV_BLOCK="\"env\": {}"
    fi
    cat > "$MCP_FILE" << MCP_EOF
{
    "mcpServers": {
        "fast-context": {
            "command": "npx",
            "args": ["-y", "--prefer-online", "fast-context-mcp"],
            $ENV_BLOCK
        },
        "gemini": {
            "command": "uvx",
            "args": ["--from", "git+https://github.com/GuDaStudio/geminimcp.git", "geminimcp"],
            "env": {}
        },
        "codex": {
            "command": "uvx",
            "args": ["--from", "git+https://github.com/GuDaStudio/codexmcp.git", "codexmcp"],
            "env": {}
        }
    }
}
MCP_EOF
  }

  if [ -f "$MCP_FILE" ]; then
    ok "MCP 配置已存在: $MCP_FILE"
    read -rp "  是否覆盖现有 MCP 配置？[y/N] " ans
    if [[ ! "$ans" =~ ^[Yy]$ ]]; then
      info "跳过 MCP 配置"
    else
      write_mcp_config
      ok "MCP 配置已更新: $MCP_FILE"
      [ -n "$WS_KEY" ] && ok "WINDSURF_API_KEY 已自动保留" || warn "WINDSURF_API_KEY 需手动填入"
    fi
  else
    write_mcp_config
    ok "MCP 配置已创建: $MCP_FILE"
    if [ -n "$WS_KEY" ]; then
      ok "WINDSURF_API_KEY 已从 ~/.claude.json 自动恢复"
    else
      warn "fast-context 的 WINDSURF_API_KEY 需手动填入"
      info "获取方式: 安装 Windsurf IDE 后提取，或从 ~/.claude.json 复制"
    fi
  fi
fi

# ── Phase 2: Install Workflow Files ───────────────────────────────
if $INSTALL_WORKFLOWS; then
  echo ""
  echo "Phase 2: Installing workflow files..."
  echo ""

  if [ "$TARGET_MODE" = "user" ]; then
    TARGET_DIR="$HOME/.agents/workflows"
  else
    TARGET_DIR="./.agents/workflows"
  fi

  mkdir -p "$TARGET_DIR"

  INSTALLED=0
  UPGRADED=0

  # Helper: install or upgrade a workflow file
  install_workflow() {
    local file="$1"
    local path="$TARGET_DIR/$file"
    if [ -f "$path" ]; then
      local old_size; old_size=$(wc -c < "$path" | tr -d ' ')
      UPGRADED=$((UPGRADED+1))
      return 0  # signal: upgrade (content written by caller)
    else
      INSTALLED=$((INSTALLED+1))
      return 1  # signal: new install
    fi
  }

  report_workflow() {
    local file="$1"
    local path="$TARGET_DIR/$file"
    local new_size; new_size=$(wc -c < "$path" | tr -d ' ')
    if [ "$2" = "upgrade" ]; then
      ok "$file  [升级] (${new_size}B)"
    else
      ok "$file  [新建] (${new_size}B)"
    fi
  }

  # ── gudaspec-init.md ──
  _mode="new"; install_workflow "gudaspec-init.md" && _mode="upgrade" || true
  cat > "$TARGET_DIR/gudaspec-init.md" << 'WORKFLOW_EOF'
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
WORKFLOW_EOF
  report_workflow "gudaspec-init.md" "$_mode"

  # ── gudaspec-research.md ──
  _mode="new"; install_workflow "gudaspec-research.md" && _mode="upgrade" || true
  cat > "$TARGET_DIR/gudaspec-research.md" << 'WORKFLOW_EOF'
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
WORKFLOW_EOF
  report_workflow "gudaspec-research.md" "$_mode"

  # ── gudaspec-plan.md ──
  _mode="new"; install_workflow "gudaspec-plan.md" && _mode="upgrade" || true
  cat > "$TARGET_DIR/gudaspec-plan.md" << 'WORKFLOW_EOF'
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
WORKFLOW_EOF
  report_workflow "gudaspec-plan.md" "$_mode"

  # ── gudaspec-implementation.md ──
  _mode="new"; install_workflow "gudaspec-implementation.md" && _mode="upgrade" || true
  cat > "$TARGET_DIR/gudaspec-implementation.md" << 'WORKFLOW_EOF'
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
WORKFLOW_EOF
  report_workflow "gudaspec-implementation.md" "$_mode"

  echo ""
  if [ $UPGRADED -gt 0 ] && [ $INSTALLED -gt 0 ]; then
    ok "完成: $INSTALLED 个新建, $UPGRADED 个升级 → $TARGET_DIR"
  elif [ $UPGRADED -gt 0 ]; then
    ok "已升级 $UPGRADED 个工作流 → $TARGET_DIR"
  else
    ok "已安装 $INSTALLED 个工作流 → $TARGET_DIR"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Usage in Antigravity IDE:"
echo "    /gudaspec-init            初始化项目"
echo "    /gudaspec-research <需求>  需求研究"
echo "    /gudaspec-plan             计划制定"
echo "    /gudaspec-implementation   代码实现"
echo "════════════════════════════════════════════"
echo ""
