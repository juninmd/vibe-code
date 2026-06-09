# Task Detail Modal UX Audit

Status: implemented first pass on 2026-06-04.

## Problem

The task card modal was trying to serve three jobs at the same time:

1. Executive task summary.
2. Operator control surface.
3. Agent output reader.

That made the most urgent workflow, reading a running OpenCode/Codex/Claude output, compete with low-priority metadata. In running tasks the modal already opens on `Execution`, but it still showed summary chrome, jump links, duplicated phase labels, repeated running indicators, token/cost tiles, and a step timeline before the raw agent stream.

## UX Decision

Treat `Execution` as a console-first view.

- Default full-height agent output to `Raw`, because raw OpenCode output remains readable even when parser labels are imperfect.
- Keep `Steps` available as an analysis mode, not the primary reading mode.
- Keep status/run/tokens compact in the `Execution` header.
- Hide the `Task objective / Jump to` strip outside `Info`.
- Remove duplicated running/current-status bars inside the full-height console.
- Preserve copy, download, stream filters, search, timestamps, split, fullscreen, stdin, ANSI rendering, and secret redaction.

## Current Improvement

The modal now prioritizes the agent stream in running tasks:

- `TaskDetail` shows the summary strip only on `Info`.
- `ExecutionTimeline` uses a compact `AGENT OUTPUT` header.
- `AgentOutput` opens in `Raw` mode when rendered full-height.
- `Steps` remains available for grouped tool inspection.

## Remaining Cuts

Next useful reductions if the modal still feels dense:

- Move `Cost`, `Memory`, `Reviews`, and `Artifacts` into a secondary overflow menu when empty.
- Collapse destructive task actions into one danger menu.
- Show only task title, status, engine/model, and close button in the modal header while on `Execution`.
- Add a run-output minimap only when there are enough logs to justify it.
- Add an `Errors` quick filter that appears only when stderr exists.
