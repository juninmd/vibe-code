# Board lanes ↔ issue labels

Each board column is a **label on the linked GitHub/GitLab issue**. Drag a card and the issue is
relabelled; relabel the issue (on the provider, from a bot, from your phone) and the card moves.
It is the first step of the issues-first direction in `ux-review.md`: the issue holds the lane.

Server: `lanes/lane-sync.ts`, `api/lanes.ts`. Shared mapping: `packages/shared/src/lanes.ts`.
Web: Settings → **Lanes** (`LanesSettings`), header pill (`LaneSyncPill`), label under each column
title, `#12` link on linked cards.

## Turning it on

Off by default, because syncing writes labels to real issues. Settings → Lanes → switch on. The next
sync (and then one per minute, see below):

1. creates the five lane labels on every connected repository (with colours),
2. labels the issues your cards are linked to,
3. creates a card for every **open** issue that already carries a lane label.

## Labels

| Lane | GitHub | GitLab |
| --- | --- | --- |
| Todo | `status:todo` | `status::todo` |
| Working | `status:in-progress` | `status::in-progress` |
| Blocked | `status:blocked` | `status::blocked` |
| Review | `status:review` | `status::review` |
| Done | `status:done` | `status::done` |

GitLab's `scope::value` labels are mutually exclusive, which is exactly what a lane is; GitHub does not
enforce that, so vibe-code removes the other lane labels when it moves an issue. If several lane labels
are present anyway, the furthest lane wins. Matching ignores case. Every lane can be renamed in
Settings (one name per lane, shared by both providers; names may not repeat, contain a comma or
exceed 50 characters). A closed issue with no lane label counts as Done.

*Scheduled* and *Archived* cards have no lane and are never touched. A *Failed* card sits in Blocked
on the provider (it needs a person, like a blocked one).

## Who wins

Per card, vibe-code remembers the lane both sides last agreed on (`tasks.issue_lane`). Then:

| Card moved | Issue moved | Result |
| --- | --- | --- |
| yes | no | the issue is relabelled |
| no | yes | the card moves |
| yes | yes | **the issue wins** — unless an agent is working on the card, or you just dragged it |
| — | labels stripped | the card's lane is put back |

First contact: a linked issue that already has a lane label decides the card's column ("what is in the
issue is in the app"); an unlabelled issue gets the card's lane. A remote move never pulls a card away
from a live terminal; it is applied once the session ends.

## When it runs

- Dragging a card (or any change to a linked card) syncs that repository ~1.5 s later.
- A poll every 60 s covers changes made on the provider. It reads the 100 most recently updated issues
  per repository (state `all`), so it costs one request per repository per minute.
- "Sync now" in Settings runs it immediately; the header pill shows the last sync or which repository
  is failing (missing token, 403, ...). A failing repository is paused for five minutes.

## Safety rules

- **Moving cards never starts an agent.** While lane sync is on, issue-linked cards are skipped by the
  autopilot, and cards created from labelled issues carry the `manual` tag. Otherwise anyone able to
  label an issue could start an agent on your machine.
- **Deleting a card takes its issue off the lanes** (removes the lane labels) and remembers the issue
  number, so the next sync does not bring the card back.
- Issue titles and bodies are untrusted text that ends up in the task prompt — see the prompt-injection
  item in `ux-review.md`. Only label issues from people you trust.
- Only labels are written. Issues are never closed, reopened or edited.

## API

```text
GET  /api/lanes        → { enabled, overrides, defaults: {github, gitlab}, status }
PUT  /api/lanes        { enabled?, labels?: { backlog|in_progress|blocked|review|done: string } }
POST /api/lanes/sync   → same payload after a sync (409 while disabled)
```

Provider adapters gained `updateIssueLabels` (GitHub: one `POST .../labels` plus a `DELETE` per removed
label; GitLab: one `PUT` with `add_labels`/`remove_labels`) and `ensureLabels`.
