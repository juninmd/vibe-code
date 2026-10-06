# Flow and UX review

Review of every surface of the app (first run on an empty install, the populated board, the task
panel and terminal, all dialogs and panels, desktop and a 390 px phone). It lists what was fixed in
the same change, and a prioritised backlog for what was not.

## Flow map

```text
First run ─► Add repository ─► (optional) connect GitHub/GitLab ─► New task
                                                                      │
Board (Todo → Working → Review → Done)  ◄───────────────────────────┘
   │ click card
   ▼
Task panel ── Terminal · Changes · Details ──  Advanced view (timeline, reviews, telemetry)
   │ Start (Claude Code | OpenCode | Shell, skills, model)
   ▼
Live PTY ── Stop ──► Todo (nothing changed) / Review (changes) / Failed (non-zero exit)
   │ Finish (commit)
   ▼
Create PR ─► Done
```

## Fixed in this change

| Area | Problem found | Fix |
|---|---|---|
| First run | Empty install showed five empty columns; "New task" opened a form that could not be submitted ("No repositories found") | `Onboarding` screen (add repo → connect forge → create task, installed agents). "New task" with no repo opens *Add repository* instead |
| Header | Search collapsed to a bare icon, "All Projects" truncated, five actions competing, avatar **signed you out on click** (and showed `@` with auth off) | Search gets the room; shortcuts and what's new move to a `⋯` menu; sign out is an explicit menu item and only exists when auth is on |
| Board | Done column clipped with no way to scroll at common widths; "Scheduled 0 / Failed 0" lanes always drawn | Board scrolls horizontally when needed; side lanes only appear when non-empty |
| Add repository | Called GitHub on every page load even when closed (500 + console error + rate limit), twice per open; a missing token looked like an outage | Fetches only when open and once; the server answers `409 provider_not_configured` and the dialog shows *Connect GitHub* with *Open settings* / *paste a URL* |
| Settings → GitHub | Had **no field for a token**, showed `@undefined` and "OAuth active" while saying OAuth was not configured | Token form (with status and test) is always there; the OAuth login card appears only when the server supports it; no placeholder names |
| Stats | "Successful" counted queued/cancelled runs, success rate was `0%` with no runs, "Active tasks" was all tasks | Only finished runs count; `—` until a run finishes; labels corrected |
| Inbox | One warning per missing CLI (14 rows) buried real signals | One row: "No agent CLI installed" (warning) or "N more engines not installed" (info) |
| Naming | "Operations Center", "Operational Intelligence", "Intelligence Registry", "Intelligence Hub", "System Configuration", "Neural Interface Bindings" | Inbox, Stats, Skills, Engines, Settings, Keyboard shortcuts; sidebar and filter labels in one language |
| Shortcuts | Listed "split terminal" keys that do not exist; nothing said the terminal owns the keyboard | Corrected list and a note |
| Connection toast | "Reconectado!" on the very first connection | Only announces real reconnections |
| Task panel | No way to open the workspace in an editor; linked issue not visible | *Open in editor* in the menu; *Linked issue* in Details |
| Contrast | `textMuted`/`textDimmed` failed WCAG AA in all four themes (dark 2.3:1, Dracula 1.2:1) | New values reach ≥ 4.5:1 on every surface; a test pins it for every theme |

## Backlog

**P1**

1. **Dead colour utilities.** `text-secondary`, `text-muted`, `text-dimmed`, `bg-app`, `border-strong`,
   `border-default`… are used in ~40 files but generate no CSS (Tailwind 4 names theme colours
   `text-text-*`, `bg-bg-*`, `border-border-*`), so those texts inherit the primary colour and the
   intended hierarchy is lost. The tokens are AA-safe now: add aliases in `@theme` (or codemod to
   the real names) and do a visual pass over every screen.
2. **One language.** English chrome with Portuguese toasts, filters and the whole Runtimes dialog
   (without accents in places). Pick a default and move strings into a catalog.
3. **Issues-first tasks** (see below).
4. **Untrusted issue text → agent with a shell.** Only run issues from collaborators, or behind a
   maintainer-applied label.
5. **"Agent is waiting for you".** Claude Code/OpenCode stop and ask; the card should show it
   (terminal bell / idle-after-output heuristic), with a tab-title badge and optional notification.

**P2**

6. Too many monitoring surfaces (Sessions, Inbox, Runtimes, Stats, Engines, Schedules). Merge into
   *Activity* (live + inbox) and *Insights* (stats + engines); Runtimes only matters for multi-host.
7. Settings has seven tabs: Accounts (GitHub, GitLab), Agents (API keys, LiteLLM, MCP), General,
   Notifications (Telegram).
8. Several terminals per task (agent + shell side by side), persisted transcripts, a read-only
   "watch" mode for teammates.
9. Modal accessibility: focus trap/restore, `aria-labelledby`, keyboard drag-and-drop alternative on
   the board (move card with a menu).
10. Remove remaining jargon footers ("Secure Agent Infrastructure", "Background Automation Engine").
11. Skills: show where a skill came from (global / repo / registry) — "workspace" is shown for global ones.

**P3**

12. Windows terminals (ConPTY) — Bun PTY is POSIX-only.
13. WIP limits and per-repo swimlanes.
14. Persist filters per repository; saved views.

## Direction: issues as the source of truth

Every task is an issue; what is on the issue is what the app shows, so the app can run without a
database. What fits an issue (title, body, labels, assignee, state, comments, linked PR) lives in
GitHub/GitLab; ephemeral runtime state (PTYs, worktrees, logs) stays local; repo configuration lives
in versioned files; secrets stay in the environment.

- **Derive status instead of storing it:** Todo = open issue; Working = `vibe:doing` label (also the
  lease); Review = linked PR open; Done = issue closed (`Closes #N`).
- **Key** = `provider:owner/repo#number`; it replaces local ids and the local issue counter.
- **Port `IssueStore`** with GitHub, GitLab and a *local files* adapter (`.vibe-code/issues/*.md`) so
  development and tests need no network, token or database. The providers today only list issues:
  they must also create/update issues, labels and comments.
- **Risks:** rate limits (use ETag polling, webhooks when reachable), no atomic lock between
  instances (lease label + heartbeat comment, best effort), body edited while the agent runs (treat
  the body as a snapshot at launch), stats need history (derive from PRs/comments or drop).
- **Migration:** `IssueStore` + local adapter → write support in providers → mandatory key and
  "New task creates an issue" → status/priority/engine/skills as labels, run summaries as comments →
  settings to a file, sessions to a signed cookie, drop the task/run tables. SQLite becomes a
  disposable cache on the way.
