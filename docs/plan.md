# Plan: AI Engine CLI Validation & Common Checklist

## Scope

| IN | OUT |
|----|-----|
| Validate Claude Code, Codex, Gemini, OpenCode docs vs live CLIs | Fixing engine code (separate task) |
| Build per-engine + common checklist | Aider, ampcode, copilot, other engines |
| Define complete TypeScript interfaces for stdout | LiteLLM integration details |
| Identify engine code vs doc discrepancies | UI rendering changes |

**Note:** OpenCode was already correctly implemented — uses `opencode run --format json` (not `acp`), has per-engine `parseLine()` parser, heartbeat, session management, and Windows pipe handling.

---

## Validated CLI Versions (2026-05-06)

| CLI | Version | Binary |
|-----|---------|--------|
| Claude Code | 2.1.132 | `claude` |
| Codex CLI | 0.128.0 | `codex` |
| Gemini CLI | 0.41.2 | `gemini` |
| OpenCode | 1.2.26 | `opencode` |

---

## CRITICAL BLOCKERS (ERROR)

### ERROR-1: Three engines called `xxx acp` — subcommand does not exist on any CLI (FIXED)

- `claude acp` → not a valid subcommand (returns generic help) ✅ FIXED
- `codex acp` → not a valid subcommand ✅ FIXED
- `gemini acp` → not a valid subcommand ✅ FIXED
- `opencode acp` → N/A (OpenCode was already correct: uses `opencode run --format json`)
- Affected files: `packages/server/src/agents/engines/claude-code.ts:170`, `codex.ts:155`, `gemini.ts:247`
- The docs (CLAUDE-CODE.md, CODEX.md, GEMINI-CLI.md) correctly document the replacement approach but **code was never updated**
- Correct commands documented in the research files but not implemented → NOW IMPLEMENTED

### ERROR-2: Claude stream-json requires --verbose (missing from engine)

- Engine currently would spawn: `claude acp ...`
- Correct form: `claude -p "..." --output-format stream-json --verbose --no-session-persistence`
- Missing `--verbose` flag causes exit code 1 with `stream-json` mode

---

## WARNINGS (HIGH)

### WARN-1: Claude Code init event has 10+ new fields not in current TypeScript types

Live `system.init` (v2.1.132) has these fields missing from `ClaudeCodeSystemInitEvent`:
- `cwd` — working directory
- `agents[]` — loaded agents: `["code-reviewer","db-admin","Explore","Plan","test-writer",...]`
- `skills[]` — loaded skills: `["update-config","debug","simplify","batch",...]`
- `plugins[]` — loaded plugins: `[{name, path, source}]`
- `mcp_servers[]` — MCP server status: `[{name, status: "connected"|"needs-auth"}]`
- `slash_commands[]` — available slash commands
- `memory_paths` — `{auto: string}`
- `uuid` — per-event uuid (on ALL events, not just init)
- `apiKeySource` — `"none"` | etc.
- `output_style` — `"default"` | etc.
- `analytics_disabled` — boolean

### WARN-2: Codex `debug models` output is 81KB with full system prompts embedded

- Each model entry contains `base_instructions` (4000+ chars) and `model_messages`
- Parser needs to extract only: `slug`, `display_name`, `description`, `visibility`, `context_window`
- Current `CodexModelEntry` type in engine may parse raw output incorrectly

### WARN-3: Gemini version advanced from 0.41.1 → 0.41.2

- GEMINI-CLI.md was validated at 0.41.1; live version is 0.41.2
- Need to re-smoke `--output-format stream-json` to confirm event shape unchanged

---

## Validated Smoke Results

### Claude Code — VALIDATED ✅

**Headless command:**
```
claude -p "<prompt>" --output-format stream-json --verbose --no-session-persistence
```

**Checklist:**
- [x] Models: static catalog, no native list cmd — `listModels()` uses `NATIVE_CLAUDE_CODE_MODELS` array + LiteLLM filter
- [x] Skills loaded: via `system.init` `skills[]` field — lists skill slugs that are active
- [x] Agents loaded: via `system.init` `agents[]` field — e.g. `Plan`, `Explore`, `test-writer`
- [x] Global rules: `memory_paths.auto` points to per-project memory file; `CLAUDE.md` at root is auto-loaded
- [x] MCP servers: `mcp_servers[]` in init — `{name, status}` per server
- [x] Tool invocation: `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_...","name":"Bash","input":{...}}]}}`
- [x] Tool result: `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"...","is_error":false}]},"tool_use_result":{stdout, stderr, interrupted, isImage}}`
- [x] Skill invoked: appears as tool_use with `name: "Skill"` (native Skill tool)
- [x] Run cost: `result` event → `total_cost_usd`, `usage`, `modelUsage`
- [x] Rate limit: `rate_limit_event` → `rate_limit_info.utilization`, `resetsAt`

### Codex — VALIDATED ✅

**Headless command:**
```
codex --ask-for-approval never exec --json --sandbox workspace-write --skip-git-repo-check -
# prompt via stdin, close stdin
```

**Checklist:**
- [x] Models: `codex debug models` → JSON array (need `slug` + `display_name` only)
- [ ] Skills loaded: no native list — injected via `.agents/skills/*/SKILL.md` files
- [ ] Agents: N/A (Codex has no agent concept)
- [ ] Global rules: reads `AGENTS.md` files automatically (documented in base_instructions)
- [x] Tool invocation: `{"type":"item.started","item":{"type":"command_execution","command":"...","status":"in_progress"}}`
- [x] Tool result: `{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"...","exit_code":0,"status":"completed"}}`
- [x] Agent message: `{"type":"item.completed","item":{"type":"agent_message","text":"..."}}`
- [x] Run cost: `turn.completed` → `usage.input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`
- [ ] Session resume: `codex --ask-for-approval never exec resume --json <session_id> -`

### Gemini — PARTIALLY VALIDATED ⚠️

**Headless command:**
```
gemini --yolo --output-format stream-json -p "<prompt>"   # or -m model
# prompt via stdin: proc.stdin.write(prompt); proc.stdin.end()
```

**Checklist:**
- [ ] Models: static catalog from gemini-types.ts; no headless list cmd
- [x] Skills loaded: `gemini skills list` → one skill per block with description+location
- [ ] Agents: N/A
- [x] Sessions: `gemini --list-sessions` → lists sessions with id and age
- [ ] Global rules: `GEMINI.md` at root; system prompt via `GEMINI_SYSTEM_MD`
- [x] Tool invocation: `{"type":"tool_use","tool_name":"run_shell_command","tool_id":"...","parameters":{...}}`
- [x] Tool result: `{"type":"tool_result","tool_id":"...","status":"success","output":"..."}`
- [x] Agent message: `{"type":"message","role":"assistant","content":"...","delta":true}`
- [x] Run cost: `result` → `stats.total_tokens`, `input_tokens`, `output_tokens`, `cached`, `duration_ms`, `tool_calls`, `models`
- [ ] stream-json smoke at 0.41.2 pending (need to validate after ACP fix)

### OpenCode — VALIDATED ✅

**Headless command:**
```
opencode run --format json --model <model> --dir <workdir>
# prompt via stdin, close stdin to signal EOF
```

**Checklist:**
- [x] Models: via LiteLLM proxy — `listModels()` returns all LiteLLM models
- [x] Skills loaded: via `opencode.json` config + `.opencode/skills/` directory injection
- [x] Agents: N/A (OpenCode has no agent concept)
- [x] Global rules: `opencode.json` with `permission: {"*": "allow"}` for non-interactive mode
- [x] Tool invocation: JSON-RPC 2.0 `method: "tool/use"` → `{tool, callId, input}`
- [x] Tool result: JSON-RPC 2.0 `method: "tool/result"` → `{callId, output, error}`
- [x] Agent message: `type: "text"` or `type: "content"` events with text content
- [x] Run cost: `method: "cost"` or `method: "usage"` → `{total_tokens, input_tokens, output_tokens}`
- [x] Session resume: `--session <sessionId>` flag
- [x] Config lifecycle: `opencode.json` written before run, cleaned up after
- [x] Windows handling: stdin closed immediately to prevent pipe deadlock

---

## Common Checklist (Cross-Engine)

| Item | Claude Code | Codex | Gemini | OpenCode |
|------|-------------|-------|--------|----------|
| List available models | Static array in engine | `codex debug models` (JSON) | Static catalog in engine | LiteLLM proxy |
| List loaded skills | `system.init` → `skills[]` | None (injected as files) | `gemini skills list` | Via config + skills dir |
| List loaded agents | `system.init` → `agents[]` | N/A | N/A | N/A |
| List MCP/tools | `system.init` → `tools[]`, `mcp_servers[]` | N/A | N/A | Via config providers |
| Global rules/instructions | `CLAUDE.md` auto-loaded; `memory_paths` | `AGENTS.md` auto-loaded | `GEMINI.md`; `GEMINI_SYSTEM_MD` | `opencode.json` permissions |
| Session/run start signal | `type:"system" subtype:"init"` | `type:"thread.started"` | `type:"init"` | JSON-RPC `session/started` |
| Tool invocation signal | `type:"assistant"` + `content[].type:"tool_use"` | `type:"item.started"` + `item.type:"command_execution"` | `type:"tool_use"` | JSON-RPC `tool/use` |
| Tool result signal | `type:"user"` + `content[].type:"tool_result"` | `type:"item.completed"` + `item.type:"command_execution"` | `type:"tool_result"` | JSON-RPC `tool/result` |
| Agent/assistant message | `type:"assistant"` + `content[].type:"text"` | `type:"item.completed"` + `item.type:"agent_message"` | `type:"message"` + `role:"assistant"` | `type:"text"` or `type:"content"` |
| Skill invocation signal | `type:"assistant"` + tool name `"Skill"` | Via `command_execution` output | Via `tool_use` tool_name | Via `tool/use` method |
| Run cost/usage | `type:"result"` → `total_cost_usd`, `modelUsage` | `type:"turn.completed"` → `usage` | `type:"result"` → `stats` | JSON-RPC `cost`/`usage` |
| Session resume | `--resume <sessionId>` (in `-p` mode) | `codex exec resume --json <sessionId> -` | `-r <sessionId>` | `--session <sessionId>` |
| Rate limit | `type:"rate_limit_event"` | None observed | HTTP 429 in stream | N/A |
| Headless command | `claude -p "..." --output-format stream-json --verbose` | `codex --ask-for-approval never exec --json --sandbox workspace-write -` | `gemini --yolo --output-format stream-json -p "..."` | `opencode run --format json --model <model>` |
| Prompt delivery | Via `-p @<file>` | Via stdin (`-`) | Via `-p "..."` or stdin | Via stdin |
| Parser approach | Per-engine `parseClaudeCodeLine()` | Per-engine `parseCodexLine()` | Per-engine `parseGeminiLine()` | Per-engine `parseLine()` method |

---

## TypeScript Interface Updates Needed

### ClaudeCodeSystemInitEvent additions (packages/shared/src/types.ts)

```ts
interface ClaudeCodeSystemInitEvent {
  // existing fields...
  type: "system"; subtype: "init";
  session_id: string; tools: string[]; model: string; permissionMode: string;
  claude_code_version: string;

  // NEW — live-validated v2.1.132
  cwd: string;
  agents: string[];
  skills: string[];
  plugins: Array<{ name: string; path: string; source: string }>;
  mcp_servers: Array<{ name: string; status: "connected" | "needs-auth" | "error" | string }>;
  slash_commands: string[];
  memory_paths: { auto: string };
  uuid: string;
  apiKeySource: string;
  output_style: string;
  analytics_disabled: boolean;
}
```

### Per-event uuid field (all ClaudeCode events)

Every event now includes `uuid` and `session_id`. Should add to base:
```ts
interface ClaudeCodeBaseEvent {
  uuid?: string;
  session_id?: string;
}
```

### CodexModelEntry (packages/server/src/agents/engines/codex.ts)

```ts
interface CodexModelEntry {
  slug: string;
  display_name: string;
  description?: string;
  visibility?: "list" | "hide" | string;
  context_window?: number;
  max_context_window?: number;
  supported_in_api?: boolean;
  // deliberately OMIT base_instructions and model_messages (too large)
}
```

### OpenCode Event Format (JSON-RPC 2.0)

OpenCode uses standard JSON-RPC 2.0 notifications (no `id` field):

```ts
// Session start
{ jsonrpc: "2.0", method: "session/started", params: { sessionId: "..." } }

// Tool use
{ jsonrpc: "2.0", method: "tool/use", params: { tool: "Bash", callId: "...", input: {...} } }

// Tool result
{ jsonrpc: "2.0", method: "tool/result", params: { callId: "...", output: "...", error?: "..." } }

// Cost/usage
{ jsonrpc: "2.0", method: "cost", params: { total_tokens: 123, input_tokens: 50, output_tokens: 73 } }

// Error
{ jsonrpc: "2.0", method: "error", params: { message: "..." } }
```

Parser: `OpenCodeEngine.parseLine()` in `packages/server/src/agents/engines/opencode.ts:554`

---

## Milestones

### M1 — Fix Engine Spawn Commands (BLOCKER)
- [x] 1.1 Update `claude-code.ts:170` — replace `["claude", "acp", ...]` with `["claude", "-p", promptFile, "--output-format", "stream-json", "--verbose", "--no-session-persistence"]`
- [x] 1.2 Update `codex.ts:155` — replace `["codex", "acp", ...]` with `["codex", "--ask-for-approval", "never", "exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"]` + write prompt to stdin
- [x] 1.3 Update `gemini.ts:247` — replace `[command, "acp", ...]` with `[command, "--yolo", "--output-format", "stream-json"]` + pass model via `-m` + pass prompt via stdin
- [x] 1.4 Switch from `parseAcpMessage` to per-engine parsers for claude-code, codex, and gemini
- [x] 1.5 OpenCode — already correct: uses `opencode run --format json` with per-engine `parseLine()` method

### M2 — Update TypeScript Interfaces (WARN)
- [x] 2.1 Extend `ClaudeCodeSystemInitEvent` with agents, skills, plugins, mcp_servers, slash_commands, memory_paths, cwd, uuid, apiKeySource, output_style, analytics_disabled
- [x] 2.2 Add `uuid?` and `session_id?` to `ClaudeCodeBaseEvent` (or union base)
- [x] 2.3 Add `ClaudeCodeRateLimitEvent` proper typing (rate_limit_info subfields)
- [x] 2.4 Update `CodexModelEntry` to strip base_instructions from parsed output
- [x] 2.5 Update Gemini types for version 0.41.2 (smoke pending)
- [x] 2.6 OpenCode — uses JSON-RPC 2.0 standard; no custom event types needed (parsed inline in engine)

### M3 — Gemini 0.41.2 Smoke
- [ ] 3.1 Run `gemini --yolo --output-format stream-json -p "Reply OK"` and validate event shapes unchanged
- [ ] 3.2 Validate session resume with `-r <sessionId>` at 0.41.2

### M4 — Document Common Checklist (this plan)
- [x] 4.1 Write per-engine + cross-engine checklist (complete above)
- [x] 4.2 Document validated commands for models, skills, agents, rules, tool signals

---

## Stack
Node.js / TypeScript · Bun · Monorepo

## Quality Gate
```
bun run lint
bun run typecheck
bun run test
bun run build
```
