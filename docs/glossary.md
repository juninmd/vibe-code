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