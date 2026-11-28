# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Code mode is a conversational remote workspace (history / chat / context), with
OpenCode selected by default. Tasks tagged `remote-session` preserve their
worktree and resume the CLI session for each `POST /api/tasks/:id/messages`.
Keep them out of autonomous sweep/retry/cleanup and do not equate a finished
turn with validated code. See [docs/remote-control.md](docs/remote-control.md).
Models and branches must come from the existing API. OpenCode turns run over
`opencode serve` + `@opencode-ai/sdk` (one loopback server per turn, random
password, process `cwd` = worktree); `VIBE_OPENCODE_TRANSPORT=cli` falls back to
`opencode run` (no `--dir`, resumes with `--session`).

## Commands

```bash
# Install dependencies
bun install

# Run both server and web in dev mode
bun run dev

# Run only the server (port 3000)
bun run dev:server

# Run only the web (Vite dev server)
bun run dev:web

# Build all packages
bun run build

# Type check all packages
bun run typecheck
```

## Architecture

**vibe-code** is evolving into an autonomous code production control plane. It orchestrates coding agents across multiple Git repositories, preserves isolated workspaces, and treats board views, runtime panels, and reviews as operator surfaces around a stronger workflow contract.

Repository contract entrypoints:

- `AGENTS.md` — short index loaded early by coding agents
- `WORKFLOW.md` — compatibility workflow contract for future runtime-driven orchestration
- `docs/repo-contract.md` — repo-level boundaries, quality gates, and rollout policy
- `docs/glossary.md` — shared terms for objective, task, run, artifact, review, and memory

### Packages

- **`packages/shared`** — TypeScript types shared between server and web (`Task`, `Repository`, `AgentRun`, `TaskStatus` enum, WebSocket protocol types)
- **`packages/server`** — Hono + Bun + SQLite backend (port 3000)
- **`packages/web`** — React 19 + Vite + Tailwind CSS 4 frontend

### Server internals (`packages/server/src/`)

- **`agents/engine.ts`** — `AgentEngine` interface all engines implement (returns `AsyncGenerator<AgentEvent>`)
- **`agents/registry.ts`** — discovers and registers available engines at startup
- **`agents/orchestrator.ts`** — manages concurrent runs (default max 4), git worktree creation, task lifecycle, and broadcasts WS events
- **`agents/runners/k8s/`** — `PodPool` (pod per task, idle reaper), minimal in-cluster API client, pod/Secret manifests
- **`agents/engines/`** — one file per engine; each spawns the CLI tool via `Bun.spawn` and streams output
- **`terminal/`** — interactive task terminals: `session-service.ts` (Bun PTY + headless screen snapshot), `harness.ts` (Claude Code / OpenCode launch + skill injection), `controller.ts` (worktree, run/task lifecycle); routes in `api/terminal.ts` (see `docs/terminal.md`)
  - `skill-plan.ts` picks skills from the task text (auto/manual plan with reasons); `harness.ts` turns the plan into a Claude Code plugin (`--plugin-dir`) or OpenCode project skills
- **`lanes/lane-sync.ts`** — keeps board lanes and issue labels in step (opt-in; `decideLaneSync` is the conflict policy); shared mapping in `packages/shared/src/lanes.ts`; see `docs/lanes.md`
- **`oauth/`** — login providers (GitHub, Google OIDC+PKCE) and the `auth_sessions` store; `auth.ts` keeps the middleware
- **`integrations/`** — "connect" flows for the default MCPs (GitHub OAuth, GitLab PAT or OAuth2 with refresh); `mcp/default-servers.ts` adds GitHub/GitLab (once authenticated), Playwright and Context7 MCPs to every run
- **`git/hook-guard.ts`** — every agent/server git call runs hooks from `scripts/git-hooks` (pre-push: gitleaks + repo tests, then the repo's own hooks); `orchestrator/pr-evidence.ts` puts `.vibe-code/evidence/` (EVIDENCE.md + Playwright screenshots, pushed to `refs/vibe-code/evidence/<branch>`) in the PR body
- **`agents/custom-providers.ts`** — user-defined OpenAI-compatible providers (bearer, custom header, OAuth2 client credentials) merged into the OpenCode overlay; API in `api/custom-providers.ts`
- **`vscode/`** — one loopback `code-server` per session worktree behind the authenticated proxy `/vscode/<taskId>/` (one-time ticket → path-scoped cookie)
- **`sessions/`** — read-only readers for the local CLI session stores (OpenCode, Claude Code, Antigravity) plus `SessionService`, which projects them onto kanban cards
- **`db/`** — SQLite via Bun; tables: `repositories`, `tasks`, `agent_runs`, `agent_logs`; WAL mode + foreign keys enabled
- **`git/git-service.ts`** — clones repos as bare, creates per-task git worktrees under `~/.vibe-code/workspaces/`
- **`ws/broadcast.ts`** — WebSocket hub; clients subscribe to task updates and receive live logs
- **`api/`** — REST routes (`/api/repos`, `/api/tasks`, `/api/runs`, `/api/engines`, `/api/sessions`) using Zod validation

### Web internals (`packages/web/src/`)

- **`features/remote-workspace/`** — default authenticated workspace at `/` (alias `/prototype`): inline skills/plugins/settings, real conversational tasks, harness terminals, and the Quadro/Terminais/Escritório 3D surfaces (`surfaces/`). The old `/legacy` panel was removed. Preview with `./scripts/preview-unified.ps1`; see `docs/unified-remote-prototype.md`.

- **`api/client.ts`** — typed fetch wrapper over the REST API
- **`hooks/`** — `useSessions`, `useTerminals`, `useExternalTerminal`, `useTerminalSocket`, `useWebSocket` (with reconnect logic)
- **`components/`** — shared pieces still used by the workspace: `TaskTerminal` (xterm), `office3d/` (three.js scene), `ErrorBoundary`

### Session board data flow

```text
GET /api/sessions
  → SessionService scans each CLI's own storage dir (never spawns anything)
  → readers parse transcripts and drop everything a card does not show
  → status derived per session: explicit CLI state, else activity window
  → the Terminais and Escritório 3D surfaces show the open (active / idle) cards
```

### Data flow

```text
POST /api/tasks/{id}/launch
  → Orchestrator: create worktree → spawn engine CLI
  → AsyncGenerator yields AgentEvents
  → BroadcastHub pushes to subscribed WS clients
  → Frontend useWebSocket receives live logs + status updates
```

### Runtime configuration (env vars)

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `VIBE_CODE_DATA_DIR` | `~/.vibe-code` |
| `VIBE_CODE_MAX_AGENTS` | `4` |
| `VIBE_OPENCODE_TRANSPORT` | `serve` (`cli` = legacy `opencode run`, the rollback switch) |
| `VIBE_AGENT_RUNNER` | `local` — default only; Settings → Execução decides (`k8s` = one pod per task, see `docs/k8s-runner.md`) |
| `VIBE_OPENCODE_SESSIONS_DIR` | `$XDG_DATA_HOME/opencode`, `~/.local/share/opencode` |
| `VIBE_CLAUDE_SESSIONS_DIR` | `~/.claude/projects` |
| `VIBE_ANTIGRAVITY_SESSIONS_DIR` | `~/.antigravity/sessions`, `~/.antigravity/cli/sessions`, `~/.config/antigravity/sessions` |
| `VIBE_SESSION_ACTIVE_WINDOW_MS` | `900000` (15 min — newer than this ⇒ `active`) |
| `VIBE_SESSION_IDLE_WINDOW_MS` | `86400000` (24 h — older than this ⇒ `done`) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | unset — Google login also needs `GOOGLE_ALLOWED_EMAILS` or `GOOGLE_ALLOWED_DOMAINS` |
| `GITLAB_OAUTH_CLIENT_ID` / `_SECRET` | unset — GitLab OAuth2 for the GitLab MCP (or set in Settings → MCP) |
| `VIBE_VSCODE_BIN` | `code-server` on PATH — VS Code in the browser at `/vscode/<taskId>/` |
| `VIBE_VSCODE_MAX` / `VIBE_VSCODE_IDLE_MS` | `3` / `1800000` |
| `VIBE_GIT_HOOK_GUARD` | on — `off` stops routing git hooks through `scripts/git-hooks` (pre-push: gitleaks + repo tests) |
| `VIBE_REQUIRE_GITLEAKS` | unset (image: `1`) — `1` blocks pushes when gitleaks is missing instead of skipping the scan |
| `VIBE_PREPUSH_TESTS` / `VIBE_PREPUSH_TEST_TIMEOUT` | `on` / `900` s — the pre-push test run |
| `CONTEXT7_API_KEY` | unset — optional key for the default Context7 MCP (or setting `context7_api_key`) |

The three `*_SESSIONS_DIR` variables accept a comma-separated list and are only
needed when a CLI stores its sessions somewhere other than the defaults.

Data is stored at `~/.vibe-code/`: SQLite DB, bare repos (`repos/`), and task worktrees (`workspaces/`).

## Custom Commands (`.claude/commands/`)

| Comando | Descrição |
| --- | --- |
| `/health` | Roda lint + typecheck + testes + build e reporta resultados |
| `/fix` | Encontra e corrige todos os erros de TypeScript e lint |
| `/pr` | Valida qualidade e gera título + body do PR |
| `/new-engine <nome>` | Scaffolda novo adaptador de engine seguindo o padrão do projeto |
| `/add-migration <desc>` | Adiciona migração SQLite segura com rollback documentado |
| `/create-skill` | Captura comportamento real do OpenCode e transforma em fixture, replay test e skill interna |

## Sub-Agents (`.claude/agents/`)

| Agente | Persona |
| --- | --- |
| `code-reviewer` | Revisa código buscando bugs, segurança e padrões do projeto |
| `test-writer` | Escreve testes de integração (server) e componentes/hooks (web) |
| `db-admin` | Projeta schemas, otimiza queries SQLite e gerencia migrações |
| `opencode-testing` | Aprende contratos reais do OpenCode via execução manual e os converte em fixtures e testes de replay |

## Convenções de código

- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- **Lint/Format**: Biome (`bun biome check . --write`)
- **Novos endpoints**: sempre com validação Zod, nunca string interpolation em SQL
- **Engines**: manter stdin aberto para interatividade; implementar `getVersion()`
- **Review pipeline**: advisory por padrão; só bloqueia com `VIBE_CODE_REVIEW_STRICT=true`
