# Harness Remote — code mode and the PWA

> A entrada principal agora é o workspace unificado em `/`, com recursos e
> configurações inline. `/prototype` é um alias e `/legacy` mantém as superfícies
> avançadas descritas abaixo. Consulte [o guia atual](unified-remote-prototype.md)
> para conversa, plugins, effort e terminal na experiência unificada.

Harness Remote is the remote-control surface for the harness: an installable
web app you open on your phone to start a coding session, watch the agent work
and reply to it. It runs entirely against the same server and data as the
kanban board — nothing extra to deploy.

## Two surfaces, one app

The app has three modes, switchable from the header; the choice is remembered in
`localStorage` (`harness-remote-mode`).

| Mode | What it shows | Default |
|---|---|---|
| **Code** | Searchable session history, central conversation, repository/branch/engine/model controls and a context panel. **Session overview** opens the Live now grid. | ✅ |
| **Board** | The kanban board (all existing columns, filters, drag-and-drop, panels, dialogs) | |
| **Terminals** | Interactive agent terminals and locally detected CLI sessions | |

Code mode is a *view* over the same tasks, runs and logs. Every existing
feature (board, task detail, terminal, engines, skills, lanes, schedules,
inbox, runtimes, reviews…) is still present in Board mode — code mode only
adds a mobile-first entry point.

## Session lifecycle

1. **Ask.** Choose a ready repository, base branch, engine (OpenCode by default)
   and model, then send a task. Branches and models are loaded from the server.
   Only engines that can resume a CLI conversation (honor the resume option and
   report a session id) are offered: a follow-up turn reuses the same session, so
   an engine that ignores the resume option (for example, the ACP invocation of
   Claude Code today) is rejected by both the selector and `POST /api/tasks`. A
   remote task also needs an explicit engine; omitting it is rejected rather than
   falling back to an engine that cannot resume. The client creates a task
   tagged `remote-session` and launches its first turn.
2. **Name.** The operator never types a title. If a title is absent, the server
   derives one from the first meaningful line of the prompt:
   `<prefix>-<slug>` (for example `harness-fix-the-login-bug`). The prefix
   defaults to the machine hostname and can be pinned with
   `VIBE_CODE_SESSION_NAME_PREFIX`. When the prompt has no usable text the
   harness falls back to a `adjective-noun` codename. See
   `packages/server/src/utils/session-name.ts`.
3. **Stream.** Opening a session subscribes to its logs over the existing
   WebSocket. Consecutive stdout lines are grouped into a single assistant
   bubble, stderr becomes an error bubble, and `system`/`review` lines render as
   notice chips. Text is ANSI-stripped and rendered as Markdown.
4. **Reply.** Wait for the turn to finish, then send the next message. The server
   resumes the same CLI session in the same worktree through
   `POST /api/tasks/:id/messages`. **Stop** interrupts the current turn. New
   messages are rejected while a turn is running, the runtime is full, or a
   previous workspace/session can no longer be resumed. Failed delivery keeps
   the draft. Reopening a conversation loads persisted logs across its runs,
   including user messages; WebSocket events stream new output.

Conversational sessions retain uncommitted work between turns and across server
restarts. They stay out of the automatic backlog/retry loops. A completed turn
means the agent finished responding; it does **not** certify deterministic
validation. Ask the agent to run checks and review **Changes & validation**.
The harness does not automatically commit, push or create a PR after each turn.
**Create PR** (next to the session status) does it on demand, like Claude Code on
the web: it commits what the agent left in the workspace, pushes the session
branch and opens the PR (`POST /api/tasks/:id/pull-request`). Once a PR exists
the button becomes **Update PR** and later turns are pushed to the same PR. The
workspace and CLI session stay intact, so the conversation continues. The agent
can also open PRs itself when asked (GitHub MCP is injected when a token is set).
Existing autonomous tasks retain their validation/review/publication pipeline.

History stays visible on desktop and opens as a drawer on phones. The context
panel shows the repository/branch, execution details and background sessions;
it is collapsible on smaller screens. **Projects & settings** opens the existing
management surfaces. **Board**, **Terminals** and **Session overview** remain available.

![Compiled UI with a real two-turn OpenCode conversation](screenshots/remote-code/conversation.png)

[New session](screenshots/remote-code/new-session.png) ·
[Mobile repository picker](screenshots/remote-code/mobile.png)

## Running remotely

Install and authenticate OpenCode **on the machine running the server**, then
register repositories in the app. To serve the compiled UI from that server:

```powershell
bun install --frozen-lockfile
bun run build
$env:NODE_ENV = "production"
bun run packages/server/src/index.ts
```

Open the server's reachable address (default port 3000) in your browser. The
existing authentication and repository workspace checks apply to messages as
well. HTTPS is required for PWA installation outside localhost. This change
provides the browser workspace; it does not provision hosting or pair additional
execution hosts. The displayed environment is the current vibe-code server.

OpenCode turns run over `opencode serve` (default): the engine starts one server
per turn on `127.0.0.1` with a free port and a random `OPENCODE_SERVER_PASSWORD`,
drives it with `@opencode-ai/sdk` (create or resume the session, `prompt_async`,
stream `/event` until the session is idle, abort on Stop) and stops it after the
turn. Bus events are mapped to the same JSON lines `opencode run` prints, so logs,
the work log and costs read the same. A retry that needs the operator (for example
an exhausted free tier) ends the turn with that message instead of retrying forever.
Set `VIBE_OPENCODE_TRANSPORT=cli` to roll back to `opencode run`.

**Approval mode.** A session tagged `supervised` (the "Pedir aprovação" option
next to the model) runs with OpenCode permissions `edit`, `bash`, `webfetch` and
`external_directory` set to `ask`. Each request is held by the orchestrator's
`ApprovalBroker`, logged as `[approval] …`, broadcast as
`tool_approval_requested`, listed by `GET /api/tasks/:id/approvals` and answered
with `POST /api/tasks/:id/approvals/:approvalId` (`once`, `always`, `reject`).
A stopped turn rejects what it was waiting on. The `cli` transport cannot ask and
says so in the log.

OpenCode `run` (the `cli` transport) uses its native executable on Windows, the worktree as process
`cwd`, JSON output, and `--session` on continuation. No `--dir` flag is sent
(OpenCode 2.0.30 rejects it). Both `sessionID` and `sessionId` event fields are
accepted without discarding the accompanying text.

## Model providers (OpenCode)

Configure them in **Settings → Providers**; the model picker then lists them
next to whatever `opencode auth login` already provides.

| Provider | Models | Credentials |
|---|---|---|
| OpenCode Go (subscription) | `opencode-go/*` | key in Settings or `OPENCODE_API_KEY`; otherwise the server's `opencode auth login` |
| LiteLLM / any OpenAI-compatible gateway | `litellm/<gateway model id>` | base URL + key in Settings, or `LITELLM_BASE_URL` + `LITELLM_API_KEY` (`LITELLM_MASTER_KEY` also mints per-run virtual keys) |

LiteLLM is declared as an `@ai-sdk/openai-compatible` provider in an inline
config (`OPENCODE_CONFIG_CONTENT`); the key travels in `VIBE_LITELLM_API_KEY` and
is referenced as `{env:VIBE_LITELLM_API_KEY}`, never written to disk or argv.
Models come from the gateway's `/v1/models`, plus the optional fixed list
(`litellm_models` / `LITELLM_MODELS`). The effort selector maps to OpenCode's
`--variant`. `VIBE_OPENCODE_FREE_ONLY=true` restores the free-models-only list.

### Choosing models

- **Per project:** pick a harness and model on the new-session composer and tap
  **Definir padrão**. New sessions in that project start with it (stored on the
  repository as `default_engine` / `default_model`, `PATCH /api/repos/:id`). The
  default model only applies when the session runs on the default's harness.
- **Per turn:** inside a conversational session the model picker switches the
  model for the next message (`POST /api/tasks/:id/messages` with `model`); the
  CLI session, workspace and branch stay the same.

## Security

- **Phone access needs auth.** With no `VIBE_CODE_API_KEY` and no GitHub OAuth,
  the server answers only localhost and returns `403 auth_required` to every
  other client, and says so at startup. Set a key or OAuth before opening it
  from your phone (`VIBE_CODE_ALLOW_UNAUTHENTICATED_REMOTE=true` opts out,
  e.g. behind your own authenticating proxy).
- **The live socket is authenticated too.** `/ws` carries task updates and agent
  transcripts, so an upgrade without a valid key or session is refused with `401`
  (the browser sends the key as `?api_key=`).
- **Agents never get server secrets.** Every agent and terminal process starts
  from a sanitized environment: `VIBE_CODE_API_KEY`, OAuth client secret,
  `LITELLM_MASTER_KEY`, database URLs, bot tokens and any `*_SECRET`,
  `*_PASSWORD`, `*_PRIVATE_KEY` variable are removed (`VIBE_CODE_AGENT_ENV_DENY`
  adds more names). Provider keys the run needs are still injected per run.
- **Logs are redacted.** Known secret values (server env and keys saved in
  Settings) and common token shapes (`ghp_`, `github_pat_`, `sk-…`, `AKIA…`,
  `Bearer …`) become `[REDACTED]` before a log line is stored or sent over the
  WebSocket, including terminal replays.

## Skills

Skills follow OpenCode's official `SKILL.md` format and discovery. The inline
config is an overlay, so OpenCode still reads the user's global config and the
repository's own `opencode.json`, and loads skills from `.opencode/skills`,
`.claude/skills`, `.agents/skills` (walking up to the git root) and
`~/.config/opencode/skills`. vibe-code's catalog (`<skills path>/skills` and the
reviewed `registry/skills`) is added through the `skills` config key, so the
agent picks skills on demand with OpenCode's `skill` tool. The process gets
`PWD` set to the workspace: OpenCode resolves the project from `$PWD`, and an
inherited value hid the repository's skills and `AGENTS.md`.

## PWA

- `packages/web/public/manifest.webmanifest` — installable metadata, shortcuts,
  maskable icons.
- `packages/web/public/sw.js` — service worker. Navigations are network-first
  with a cached app-shell fallback; hashed `/assets/*` are cache-first;
  `/api`, `/ws` and `/health` are never cached.
- Icons are generated procedurally by `scripts/generate-pwa-icons.ts`
  (`bun run scripts/generate-pwa-icons.ts`) into `packages/web/public` — no
  binary image tooling in the build.
- The server serves `sw.js` and `manifest.webmanifest` with `Cache-Control:
  no-cache` and every other build file by extension, so installs and updates
  land without a hard refresh. See the static handler in
  `packages/server/src/index.ts`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VIBE_CODE_SESSION_NAME_PREFIX` | hostname | Prefix for auto-generated session names |
| `OPENCODE_API_KEY` | — | OpenCode Go key (Settings value wins) |
| `LITELLM_BASE_URL` / `LITELLM_API_KEY` | `http://localhost:4000` / — | LiteLLM gateway for `litellm/*` models |
| `LITELLM_MODELS` | — | Extra LiteLLM model ids to always offer |
| `VIBE_OPENCODE_FREE_ONLY` | `false` | Only offer free OpenCode models |
| `VIBE_CODE_ALLOW_UNAUTHENTICATED_REMOTE` | `false` | Allow non-localhost clients while auth is off |
| `VIBE_CODE_AGENT_ENV_DENY` | — | Extra comma-separated env names hidden from agents |
| `VIBE_OPENCODE_E2E_BIN` | — | Path to `opencode` to run `opencode.e2e.test.ts` |

## Tests

- `packages/server/src/utils/session-name.test.ts` — slug/prefix/codename rules.
- `packages/server/src/api/tasks.integration.test.ts` — task creation without a
  title derives a session name.
- `packages/web/src/components/code-mode/chat.test.ts` — transcript folding.
- `packages/web/src/components/code-mode/CodeComposer.test.tsx` — composer input.
- `packages/server/src/agents/orchestrator/remote-session.integration.test.ts` —
  two turns preserve the CLI conversation, workspace and uncommitted files.
- `e2e/code-mode.spec.ts` — desktop/mobile workspace and session creation.
  Set `VIBE_E2E_REAL_OPENCODE=1` to opt into two real free-model turns plus
  history recovery after reload; regular tests intercept execution.
  After `bun run build`, set `VIBE_E2E_PRODUCTION_UI=1` to test the compiled UI
  served by the real server instead of the Vite development server.

Server tests use Bun's `--isolate` to prevent process-wide module mocks from
one engine test from contaminating subsequent engine/filesystem tests.
