# Task terminal

Each kanban card can run an interactive agent harness (Claude Code, OpenCode) or a plain
shell inside a real terminal that lives in the task panel. Server: `packages/server/src/terminal/`.
Web: `TaskPanel`, `TaskTerminal`, `SkillPicker`.

## Flow

```text
POST /api/terminal/:taskId/start {engine, model?, skills?, skillMode?, cols, rows}
  → TerminalController: reuse or create the task worktree (+ branch)
  → write .vibe-code/TASK.md, plan + build the agent plugin, build the harness command
  → TerminalSessionService: Bun PTY (POSIX) + headless screen model
  → run status "running" (phase "terminal"), task → in_progress

WS terminal_open / terminal_input / terminal_resize / terminal_signal / terminal_close
  ← terminal_opened / terminal_output / terminal_closed
```

- **Harnesses** (`harness.ts`): `claude [--model m] "<task>"` and `opencode [--model m] --prompt "<task>"`,
  both interactive TUIs started in the worktree. Reopening a task in the same workspace resumes the
  conversation (`--continue`). Prompts over 4 KB are read from `.vibe-code/TASK.md`. `shell` opens `$SHELL`.
- **Skills = agent plugins, applied automatically.** Nobody has to browse a catalogue before a task:
  `skill-plan.ts` picks skills from the task text (title, description, goal — name and tag words weigh
  more than description words, filler words are ignored, at most four) and records *why* each was
  chosen ("matches: tests, failing"). The built-in `vibe-code-orchestrator` skill (sub-tasks on the board,
  via `VIBE_CODE_API_URL`, `VIBE_CODE_TASK_ID`, ... in the environment) rides along with every task.
  The plan is `auto` until the operator edits it; an explicit pick makes it `manual` and survives restarts
  until "Reset to auto". The plan and its reasons are stored in `.vibe-code/plan.json`.
  - **Claude Code** gets a session-only plugin generated in `.vibe-code/plugin/`
    (`.claude-plugin/plugin.json` + `skills/<name>/`) and loaded with `claude --plugin-dir`. Nothing is
    written to the repository's own `.claude/` directory, so there is nothing to collide with, commit or clean.
  - **OpenCode** has no plugin-directory flag, so its skills are copied into `.opencode/skill/<name>` and
    excluded through `.git/info/exclude`; skills the repo already tracks are never overwritten.
  - Plugins are read when the harness starts: changes made while a session runs apply at the next start.
  - UI: the idle card shows the plugin as chips with their reason before **Start**; the `Skills` popover
    lists every installed skill with the applied ones on top, built-ins locked, `Auto`/`Manual` badge and
    "Reset to auto". `POST /api/terminal/:taskId/skills/preview` computes the plan before a workspace exists.
- **Reattaching**: a client that opens a live task gets a *snapshot of the rendered screen* (headless
  xterm + serialize addon), not the raw byte history, so TUIs that repaint with relative cursor moves
  restore correctly. Closing the panel only detaches; the agent keeps running. `Stop` ends it.
- **Finish** commits the worktree and moves the task to Review; "Create PR" is the existing PR flow.
- Task/run bookkeeping: clean exit or stop with changes → Review; without changes → Todo; non-zero exit → Failed.

## Coexistence with the autopilot

Todo tasks are auto-launched headless by the orchestrator. Tasks driven by hand are exempt: the
`manual` tag (set by the New Task dialog for harness engines) or a latest run with phase `terminal`.
`recoverInProgressTasks` parks them in Todo after a restart, and the startup workspace cleanup keeps
the worktrees of unfinished terminal tasks (they hold uncommitted work).

## Security

A terminal is a shell on the server. `terminal_*` WebSocket messages are rejected unless the upgrade
request was authenticated (`isRequestAuthenticated`: API key or session cookie) when auth is enabled.
The HTTP routes use the same task access control as `/api/tasks`. The web app gives the focused
terminal every key (no board shortcuts fire while it has focus).

## Limits

- PTYs need a POSIX host. On Windows the session falls back to plain pipes (no TUI support).
- One terminal session per task.
- Terminal runs have no token/cost telemetry (the CLIs own their sessions).
