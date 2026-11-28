# AGENTS.md

vibe-code: autonomous code production control plane. It runs coding agents in isolated git worktrees and validates their output deterministically. `CLAUDE.md` holds the detailed architecture and env var table; this file holds the operating rules.

## Stack

- Bun, Hono, SQLite (`packages/server`); React 19, Vite, Tailwind 4 (`packages/web`); shared types (`packages/shared`).
- Biome for lint and format; husky + commitlint (Conventional Commits, `commit-msg` hook).
- Engines: one file per CLI in `packages/server/src/agents/engines/` (OpenCode is the default). LiteLLM route is optional.

## Commands

```bash
bun install
bun run dev          # server + web
bun run typecheck    # all packages
bun run test         # per package
bun run test:e2e     # Playwright (boots an isolated server on :3123 and Vite on :5199)
bun run lint         # biome check packages/
```

Bun tests under `packages/web/src/utils/*.test.ts` are excluded from Vitest in `packages/web/vite.config.ts`; run them with `bun test`.

## Map (read in this order)

1. [WORKFLOW.md](WORKFLOW.md): lifecycle contract (intake, run, validation, review).
2. [docs/repo-contract.md](docs/repo-contract.md): boundaries and quality gates.
3. [docs/glossary.md](docs/glossary.md): shared vocabulary.
4. [docs/remote-control.md](docs/remote-control.md): remote harness (code mode, session names, PWA).
5. [README.md](README.md) and [CLAUDE.md](CLAUDE.md): setup, surfaces, commands.

## Conventions

- **Changelog**: every change for push or release goes in [CHANGELOG.md](CHANGELOG.md).
- **Quality**: Biome and tests must pass before you finish.
- **Validation**: new endpoints use Zod; never interpolate strings into SQL.
- **Conflicts**: resolve merge conflicts in the same agent session (`session_id`).
- **Isolation**: repos belong to workspaces. Check access through `repositories.workspace_id`.
- **Templates**: agent templates in `packages/server/src/agents/templates/*.json`, validated at boot by `agent-templates.ts`.
- **Docs**: record decisions and pitfalls. Do not write PR summaries or file catalogs in docs, and keep each fact in one doc only.
- **Tests**: test what can break (protocol translation, permissions, migrations, races) at the lowest layer that fails. A bug fix starts with a failing test. No `sleep` or polling in tests; wait for the event. Run only the affected file; the full suite runs in CI.

## Gotchas

- **Processes**: stop child trees with `killProcessTree` (`packages/server/src/utils/process-tree.ts`). Never kill `node.exe` globally, never `pkill -f`, and kill only the PID you started.
- **Sandbox safety**: never use the real DB or `VIBE_CODE_DATA_DIR`; use a temporary data dir. Never restart the server that runs your own session; a timeout is not a reason.
- **OpenCode**: run the native binary at `node_modules/opencode-windows-*/bin/opencode.exe` to avoid prompt truncation in multiline input. Prompts go through stdin.
- **Gemini CLI**: set `GEMINI_CLI_TRUST_WORKSPACE=true` in temporary worktrees, or it exits 55.
- **Inactivity watchdog**: system logs such as "Still running..." do not reset `VIBE_CODE_INACTIVITY_MS`.
- **SQLite**: `PRAGMA foreign_keys = ON` enforces foreign keys. Create the workspace before its repositories.
- **Model lists**: no engine may hardcode model lists (`COPILOT_MODELS = [...]`, `staticModels = [...]`). `hardcoded-models.test.ts` enforces it. Load models from the agent CLI, LiteLLM, or `VIBE_<ENGINE>_MODELS`.
- **Parity**: a capability appears in the UI only if the engine really runs it; the server refuses it otherwise.

### Windows

- `path.relative` across drives (`D:` vs `C:`) returns an absolute path. Any "inside the repo?" guard must also check `isAbsolute(rel)`.
- `Bun.spawn(["bun", "--eval", "<multiline>"])` drops newlines. Write the script to a temp file and run `bun <file>`.
- After unstaging `.vibe-code/`, validate the index (`git diff --cached --name-only`), not the working tree. Commit hooks in target repos may reject the orchestrator's commit; `git-service.ts::commitAll` falls back to `--no-verify`.
- Use `toLocaleString("en-US")` in output that tests compare. pt-BR machines format `1.234`.
- `status=ready` does not mean the bare repo is on disk: `orchestrator.launch` re-clones it (self-heal).

### Production (k8s, validated 2026-06-04)

- The runtime image needs `build-essential pkg-config`. Without them, native deps fail with `cc not found`, the run stalls 300 s, and it logs `AGENT FAILED: stalled`.
- OpenCode Zen free models (`opencode/*-free`, `opencode/big-pickle`) hang in the container: `auth.json` is empty and the gateway never answers. Do not use them as default.
- Working free path: GitHub Models (`github-models/openai/gpt-4o-mini`), using the deploy `GITHUB_TOKEN`. Rate-limited.
- GitHub Copilot (`github-copilot/*`) rejects classic PATs. It needs an OAuth token.
- LiteLLM route is active only when `LITELLM_MASTER_KEY` (real key, not placeholder) and `LITELLM_BASE_URL` are set.
- OpenCode runs are heavy. OpenCode plus the server under a 2Gi limit causes `OOMKilled`. Keep `VIBE_CODE_MAX_AGENTS=1` or raise the memory limit. Never start OpenCode inside the production pod with `kubectl exec`.
- A stalled run retries with no cap and holds the only slot. Stop it with `POST /api/tasks/{id}/cancel`, then `PATCH {status:"archived"}`. (`cancelled`/`canceled` return 400.) Tasks tagged `auto-improve` are relaunched automatically.

### Known open issues (as of 2026-06-04; not re-verified)

1. The watchdog kills OpenCode runs that stream no parseable events for 300 s. Suspect `engines/opencode.ts::parseLine` against the real OpenCode 1.15.x output.
2. The quality gate fails on non-JS repos: `unable to discover validation commands`. Python/uv and Makefile repos need detection or an opt-out.
3. `MAX_AGENTS=1` is not enforced: four `in_progress` runs were seen. Check `orchestrator.ts::launch` and `activeCount`; orphaned runs do not decrement the counter.

## Remote and surfaces (T3 Code and Paseo rules, see [docs/t3-paseo-port.md](docs/t3-paseo-port.md))

- Every action in the conversation also exists in the command palette, and in a shortcut if it is frequent.
- Every entry has an inverse (open/close, archive/restore).
- Test desktop (1440px) and phone (390px). Attach before/after screenshots for UI changes.
- Colors come only from `--rw-*` tokens. No loose hex in components.
- Hierarchy by weight and color, not size. At most one primary button per screen.
- Destructive actions are outlined until confirmed. Disabled is opacity only.
- A state change does not shift layout. Spinners go before the text.
- Empty state: one short sentence and at most one action. Error: one direct sentence below the field.
- Every fallible action shows pending, success, and failure states.

<!-- base-actions-main-policy -->
## GitHub Actions — padrão obrigatório (@main)

- Referencie as actions internas sempre pelo branch, nunca por SHA:
  - `uses: juninmd/base-actions/<action>@main`
  - `uses: juninmd/base-actions/.github/workflows/<arquivo>.yml@main`
- Não fixe `@<sha>` em `juninmd/base-actions`: a atualização é centralizada no
  `main` e passa a valer no próximo run.
- PRs cujos checks não iniciam por billing/spending limit são mesclados pelo bot central
  `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`.
  Para impedir o merge automático de um PR, aplique a label `do-not-merge`.
