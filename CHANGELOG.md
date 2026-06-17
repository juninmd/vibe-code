# Changelog

## [Unreleased]
### Fixed
- Improved the task detail terminal panel with clearer session state, a stronger output frame, and a more readable idle state.
- Fixed prod pod crash risk by capping max agents to the deployment env and raising the runtime memory limit to 3Gi.
- Fixed Git fetch/sync for bare repo mirrors by fetching explicit remote-tracking branches before worktree setup and rebase.
- Fixed fallback models list by completely removing hardcoded registry models and increasing `opencode models` query timeout to 10s to ensure list is dynamically loaded.
- Fixed OpenCode model selection by returning a stable fallback model list when LiteLLM or the local OpenCode CLI cannot list models quickly.
- Fixed GitHub Actions validation by replacing the external reusable workflow dependency with local Bun lint, typecheck, test, and build gates.
- Fixed web Vitest execution on Windows by using forked workers, restoring the root `bun run test` homologation gate.
- Improved execution timeline semantics by using a real `nav` landmark and removed a non-null assertion from task stage scanning.

### Added
- **Model hardcoding lock test**: Added a verification test that automatically scans all agent engines to ensure no models are statically hardcoded, enforcing dynamic resolution via CLI, LiteLLM or environment variables.
- **Bulk Card Deletion**: Added board-level multi-select controls plus per-column delete-all actions for non-running task columns.
- **Task Detail Modal UX Audit**: Documented the modal information-density problem, console-first execution decision, implemented changes, and remaining UX cuts in `docs/task-detail-modal-ux-audit.md`.
- **Grok and ACPX Native Engines**: Ported native local Grok CLI execution engine and Agent Client Protocol (ACPX) parser adapter with full unit test coverage.
- **Cost Safety & Multi-run Budget Enforcement**: Implemented cost warnings at 80% and hard-abort/pause gating at 100% of max cost during both generation and validation repair cycles.
- **Process Tree Reaping**: Created process-tree execution safety utility for cross-platform recursive child-process termination during agent abort signals.
- **Graceful Shutdown**: Added signal handling (`SIGINT`/`SIGTERM`) to the server orchestrator to cancel active runs and release locks safely on server exit.
- **Validation Loop Detection**: Hashing signature mechanism added to the deterministic validation loop in the execution manager to identify and abort repeating/stalled retry loops.
- **Repository Contracts**: Added `WORKFLOW.md`, `docs/repo-contract.md`, and `docs/glossary.md` to define the repository workflow contract, shared vocabulary, and migration path toward an autonomous control plane.
- **Execution + Terminal Split**: Task detail now has dedicated `Execution` and `Terminal` tabs, with a new `ExecutionTimeline` surface and a `TerminalSessionPanel` for real terminal streaming.
- **Terminal Session Channel**: Added WS terminal protocol support (`terminal_open`, `terminal_input`, `terminal_resize`, `terminal_signal`, `terminal_close`) and server-side session lifecycle module.
- **Access Control Hardening**: Introduced centralized access-control enforcement for repo/task/run scope plus safe external serialization helpers for tasks/runs.
- **Coverage Additions**: Added tests for access control behavior and terminal panel session messaging.

### Changed
- **Task Detail Execution UX**: Reduced non-execution chrome in running task modals and made full-height agent output open in a raw, readable log view with the existing step timeline available on demand.
- **OpenCode Dynamic Configuration Isolation**: Configured OpenCode to execute using temporary configuration folders via isolated `XDG_CONFIG_HOME` env variables to prevent polluting the git workspace repository.
- **Unified Telemetry & Micro-dollar Conversion**: Refactored OpenCode event parsing to progressively accumulate execution costs, reporting unified cumulative costStats telemetry, and mapped cost units in task detail modals/cards to handle micro-dollar and standard-dollar conversions correctly.
- **Workspace Isolation**: Refactored the control plane database schema and Hono API endpoints to native `workspace_id` referencing workspace records, completely separating repository contexts.
- **Conflict Resolution Flow**: Conflict-resolution tasks now reuse the existing PR branch and preserve the conflicted rebase state so the agent can resolve real merge conflicts instead of showing an inactive terminal against a clean workspace.
- **Task Execution Telemetry**: Restored visible token/cost telemetry with an execution summary header and an explicit Cost tab empty state when engines have not emitted usage data yet.
- **Task Detail Readiness Review**: Added a real-data presentation readiness section that surfaces repository context, execution configuration, delivery output, artifacts, and governance state without synthetic progress claims.
- **Task Detail Presentation Polish**: Refined modal actions, approval copy, destructive-action wording, and removed a hidden legacy info block so the task detail surface is cleaner for executive demos.
- **Task Detail Executive Summary**: Added a presentation-grade summary band for objective, status, run state, output, and evidence so the task modal reads as an operational control surface.
- **Task Detail Data Audit**: Reworked the task detail info tab to show only backend-backed task, repository, run, and usage fields, with explicit empty states instead of inferred health/progress labels.
- **Task Detail Modal Polish**: Reworked the task detail modal header, action controls, goal strip, and tab navigation for clearer hierarchy, better responsive behavior, and less visual clutter.
- **Product Positioning**: Updated `README.md`, `CLAUDE.md`, and `AGENTS.md` to describe the product as an autonomous code production control plane instead of a task-board-first manager.
- **Task Poll Compatibility**: Preserved `GET /api/tasks/poll` legacy behavior for missing focused tasks (returns empty focused payload instead of hard failure) while keeping scope checks for valid resources.
- **Task UI Reliability**: Scheduled task actions now use `task.id` for run/toggle endpoints; board now includes ghost rails for hidden status visibility.

### Added
- **Semantic Task Priority**: Priority is now represented as named levels (`none`, `low`, `medium`, `high`, `urgent`) instead of integers. Shared `TASK_PRIORITY_META` provides label, icon, and color tokens for consistent UI rendering across the app.
- **Per-Repo Issue Numbers**: Tasks are automatically assigned sequential issue numbers scoped to each repository (`#1`, `#2`, …), enabling GitHub-style task references in the kanban board and task cards.
- **Labels System**: Full CRUD for colored labels per repository (`GET/POST/PATCH/DELETE /api/labels`). Labels can be assigned to tasks via `PUT /api/labels/tasks/:taskId`. Labels display as colored pill badges on task cards and can be used to filter tasks.
- **Priority Picker in New Task Dialog**: 5-button priority selector in the task creation dialog using the shared priority metadata.
- **`LabelBadge` component**: Reusable colored pill component for labels with optional remove button.
- **Goal Alignment**: Tasks now store explicit goal and desired outcome fields and inject them into agent context.
- **Persistent Run State**: Run snapshots now preserve branch, worktree, session, and validator progress details.
- **Task Artifacts**: Tasks now expose persisted work products such as worktrees, branches, docs, and pull requests.
- **GitHub OAuth Login**: Public deployments can require GitHub social login with HttpOnly sessions instead of exposing a GitHub token in the browser.

### Fixed
- Fixed the dev frontend entrypoint so port `3000` renders the Vite frontend through the backend when `VITE_DEV_URL` is configured.
- Fixed retries for legacy repositories by resolving existing `repoName.git` bare clones when the newer collision-safe bare path is absent.
- Fixed OpenCode stderr logging so structured JSON error payloads are rendered as useful JSON instead of `[object Object]`.
- Improved OpenCode execution output by emitting stable tool labels before completed tool results, rendering legacy result summaries as categorized timeline steps, and keeping the execution log pane scrollable.
- Fixed the new task dialog so opening it explicitly refreshes repositories, Target Repository is prefilled from the selected repository or the sole available repository, and pending/cloning repositories remain selectable.
- Fixed task loading for authenticated workspaces by mapping previously unowned repositories to the current workspace instead of returning `Repository access denied`.
- Fixed manual repository import so existing local Git clone paths are accepted instead of being rejected by URL-only validation, and clarified that GitHub/GitLab search only searches remote provider repositories.
- Corrigido `OpenCodeEngine` para criar o diretório `.vibe-code/prompts` antes de gravar prompts temporários.
- Corrigidas falhas de typecheck/lint no web em toasts, dependências de skills, badges, diff viewer e componentes de repositório.
- Corrigida a validação de caminhos do `RepoSkillsLoader` e seus testes em Windows.
- Ajustados testes do orchestrator para não dependerem de LiteLLM/revisores externos no ambiente local.
- Aumentado timeout dos testes de migração de banco de dados para 15s (schema cresceu com tabelas de labels).
*** Add File: d:\Solutions\pessoal\vibe\vibe-code\WORKFLOW.md
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
*** Add File: d:\Solutions\pessoal\vibe\vibe-code\docs\index.md
# Documentation Index

This directory is the repository system of record for durable operating guidance that should not live as prompt fragments.

## Core Documents

| Document | Purpose |
|---|---|
| `../WORKFLOW.md` | Repository-owned workflow contract in compatibility mode |
| `repo-contract.md` | Repository boundaries, quality gates, and rollout policy |
| `glossary.md` | Shared vocabulary for objectives, runs, artifacts, and memory |

## Usage

- Start at `AGENTS.md` for the short index.
- Use `WORKFLOW.md` for workflow intent.
- Use `repo-contract.md` for operational rules.
- Use `glossary.md` to keep naming stable across docs, code, and UI.
*** Add File: d:\Solutions\pessoal\vibe\vibe-code\docs\repo-contract.md
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
*** Add File: d:\Solutions\pessoal\vibe\vibe-code\docs\glossary.md
# Glossary

## Objective

A higher-level outcome the system should achieve. An objective may expand into multiple tasks or milestones.

## Milestone

A bounded implementation phase that can be validated and completed independently inside a larger objective.

## Task

A persisted unit of work tracked by the current application model. In the evolving architecture, tasks are expected to become leaves or executable nodes of a broader objective plan.

## Run

A single execution attempt for a task or future workflow node. A run produces logs, status transitions, and validation evidence.

## Review

A quality gate after implementation. Reviews may be automated, human, or hybrid, but they must produce actionable findings or approval.

## Artifact

A durable work product created by a run, such as a worktree, branch, validation summary, documentation delta, or pull request reference.

## Memory

Durable or session-scoped context preserved to improve future runs without requiring humans to restate the same guidance.

## Quality Score

A future summary signal derived from validation, review outcomes, and regressions. It is not yet implemented as a first-class runtime concept, but the term is reserved for that role.

## [0.2.0] - 2026-05-01
### Added
- **Skills Market**: New tab in Skills Browser to install/uninstall skills from GitHub repositories.
- **Enhanced Gemini Engine**: Support for dynamic model listing and improved CLI integration.
- **Meta-Orchestrator Skill**: Virtual skill allowing agents to delegate work by creating sub-tasks.
- **Improved Task Detail**: Real-time phase tracking and enhanced log viewer.
- **Budget Control**: Ability to set `maxCost` on tasks to limit AI spending.
- **Advanced Skill Metadata**: Support for versioning, dependencies, and tags for skills.

### Fixed
- **Skills Preview**: Restored rendered Markdown preview for skill, rule, agent, and workflow files.

## [0.1.0] - 2026-05-01
### Added
- Inicial release do Vibe Code.
- Suporte a múltiplos agentes (Claude Code, Aider, OpenCode).
- Kanban board para gerenciamento de tarefas.
- Integração com repositórios Git.
- Painel de logs em tempo real.
- Suporte a agendamento de tarefas (Cron).
- Barra de busca e filtros avançados.
- Notificações no navegador.
