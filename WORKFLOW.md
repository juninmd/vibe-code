# Workflow Contract

Status: Draft v1 (compatibility mode)

Purpose: define the repository-owned workflow contract for humans and agents while the runtime migrates from prompt-template orchestration to workflow-driven orchestration.

## Compatibility Note

This file is not yet the sole source of truth for runtime behavior.

- Current runtime behavior still relies on the existing task prompt pipeline, review settings, and server-side orchestrator logic.
- This file defines the target contract and immediate expectations for contributors.
- Future milestones should progressively make the runtime consume this contract directly.

## Primary Objective

Turn repository work into autonomous, reviewable, high-quality implementation runs with explicit validation, artifacts, and handoff points.

## Workflow Stages

1. Objective intake
2. Task decomposition or selection
3. Workspace preparation
4. Implementation run
5. Deterministic validation
6. Review and repair loop
7. Artifact publication
8. Human approval or merge handoff

## Current Quality Gate

Use the root Bun scripts as the repository validation contract.

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

If a change touches runtime startup or operator workflows on Windows, account for the current shell limitation of `bun run dev`, which depends on `bash ./scripts/dev-safe.sh`.

## Required Artifacts

Each successful implementation run should converge toward these artifacts, even when the current runtime produces only part of them:

- branch or worktree reference
- validation evidence
- review summary
- pull request or review handoff
- task summary or docs delta when behavior changes

## Human Handoff Policy

- Human attention should be spent on objective quality, exceptions, and approvals.
- Humans should not need to micromanage each coding session.
- If the system lacks the contract or tooling to proceed safely, the fix is to improve the repository contract, not to rely on permanent ad hoc prompting.

## Related Documents

- `AGENTS.md`
- `docs/index.md`
- `docs/repo-contract.md`
- `docs/glossary.md`