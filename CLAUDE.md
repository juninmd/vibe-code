# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**vibe-code** is a multi-agent AI task manager: it orchestrates AI coding agents (Claude Code, Aider, OpenCode) to work on tasks across multiple Git repositories, with a kanban web UI for tracking.

### Packages

- **`packages/shared`** — TypeScript types shared between server and web (`Task`, `Repository`, `AgentRun`, `TaskStatus` enum, WebSocket protocol types)
- **`packages/server`** — Hono + Bun + SQLite backend (port 3000)
- **`packages/web`** — React 19 + Vite + Tailwind CSS 4 frontend

### Server internals (`packages/server/src/`)

- **`agents/engine.ts`** — `AgentEngine` interface all engines implement (returns `AsyncGenerator<AgentEvent>`)
- **`agents/registry.ts`** — discovers and registers available engines at startup
- **`agents/orchestrator.ts`** — manages concurrent runs (default max 4), git worktree creation, task lifecycle, and broadcasts WS events
- **`agents/engines/`** — one file per engine; each spawns the CLI tool via `Bun.spawn` and streams output
- **`db/`** — SQLite via Bun; tables: `repositories`, `tasks`, `agent_runs`, `agent_logs`; WAL mode + foreign keys enabled
- **`git/git-service.ts`** — clones repos as bare, creates per-task git worktrees under `~/.vibe-code/workspaces/`
- **`ws/broadcast.ts`** — WebSocket hub; clients subscribe to task updates and receive live logs
- **`api/`** — REST routes (`/api/repos`, `/api/tasks`, `/api/runs`, `/api/engines`) using Zod validation

### Web internals (`packages/web/src/`)

- **`api/client.ts`** — typed fetch wrapper over the REST API
- **`hooks/`** — `useTasks`, `useRepos`, `useEngines`, `useWebSocket` (with reconnect logic)
- **`components/`** — `Board` (dnd-kit drag-drop kanban), `TaskDetail` (slide-over with live logs and stdin input), `Sidebar` (repo selector)

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
