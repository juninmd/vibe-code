# Repository Contract

## Purpose

This repository is moving toward an autonomous code production control plane. The contract below exists to keep that transition predictable for both humans and agents.

## Current Product Direction

- The product is not board-first anymore.
- The board remains an important operator view, but it is one surface of the control plane.
- The primary unit of work is moving from individual task supervision toward objective execution with validation and review evidence.

## Repository Boundaries

- Prefer repository-owned contracts over ad hoc prompt instructions.
- Keep workflow behavior versioned in `WORKFLOW.md` and `docs/`.
- Keep `AGENTS.md` short and index-like.
- Treat runtime safety, validation, and review as harness responsibilities rather than tribal knowledge.

## Current Validation Contract

Before changes are considered healthy, the repository expects these root commands to pass:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

This is the current repo-wide contract until a stricter health command is introduced.

## Windows Note

The root `bun run dev` script currently depends on `bash ./scripts/dev-safe.sh`. On Windows, prefer Git Bash or WSL until the dev entrypoint becomes shell-neutral.

## Rollout Policy

- Introduce new workflow-driven behavior behind compatibility boundaries when possible.
- Avoid claiming runtime capabilities that are not yet implemented.
- When guidance becomes durable, move it into versioned docs or contracts.
- When product behavior changes materially, update `README.md`, `CLAUDE.md`, and `CHANGELOG.md` accordingly.