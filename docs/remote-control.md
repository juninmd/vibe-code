# Harness Remote — code mode and the PWA

Harness Remote is the remote-control surface for the harness: an installable
web app you open on your phone to start a coding session, watch the agent work
and reply to it. It runs entirely against the same server and data as the
kanban board — nothing extra to deploy.

## Two surfaces, one app

The app has two modes, switchable from the header; the choice is remembered in
`localStorage` (`harness-remote-mode`).

| Mode | What it shows | Default |
|---|---|---|
| **Code** | A **Live now** session grid (filter chips, Group by, search) plus a live chat transcript with a reply composer | ✅ |
| **Board** | The kanban board (all existing columns, filters, drag-and-drop, panels, dialogs) | |

Code mode is a *view* over the same tasks, runs and logs. Every existing
feature (board, task detail, terminal, engines, skills, lanes, schedules,
inbox, runtimes, reviews…) is still present in Board mode — code mode only
adds a mobile-first entry point.

## Session lifecycle

1. **Ask.** Type a task in the composer and send. The client creates a task and
   launches it in one step.
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
4. **Reply.** While a session is running, the composer sends the text to the
   agent over `agent_input`. When it is idle, use **Start** to resume it.

## Skills

Code mode has no skill picker. Skills are resolved automatically from the task
text by the existing matcher (`packages/server/src/skills/matcher.ts`) and
loaded as session plugins — the operator only supplies the task.

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

## Tests

- `packages/server/src/utils/session-name.test.ts` — slug/prefix/codename rules.
- `packages/server/src/api/tasks.integration.test.ts` — task creation without a
  title derives a session name.
- `packages/web/src/components/code-mode/chat.test.ts` — transcript folding.
- `packages/web/src/components/code-mode/CodeComposer.test.tsx` — composer input.
