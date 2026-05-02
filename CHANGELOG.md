# Changelog

## [Unreleased]
### Added
- **Repository Contracts**: Added `WORKFLOW.md`, `docs/repo-contract.md`, and `docs/glossary.md` to define the repository workflow contract, shared vocabulary, and migration path toward an autonomous control plane.

### Changed
- **Product Positioning**: Updated `README.md`, `CLAUDE.md`, and `AGENTS.md` to describe the product as an autonomous code production control plane instead of a task-board-first manager.

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
