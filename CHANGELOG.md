# Changelog

## [Unreleased]
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
