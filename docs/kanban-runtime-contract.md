# Kanban Runtime Contract (para o github-assistance)

Este documento fixa o papel do vibe-code dentro do fluxo de manutenção autônoma descrito
em `github-assistance/docs/AUTONOMOUS_MAINTENANCE.md`: o vibe-code é o **runtime de
kanban**. Ele não decide o que fazer nos repositórios; recebe tasks já planejadas,
executa no harness mais barato disponível, aplica os gates e devolve um PR.

## O que o vibe-code precisa expor

| Mudança | Onde | Motivo |
| --- | --- | --- |
| `idempotencyKey` em `POST /api/tasks` (retorna a task existente em vez de duplicar) | `packages/server/src/api/tasks.ts`, coluna nova em `tasks` | O planner roda todo dia; a fila não pode encher com repetições |
| `skills[]`, `runtimeProfile`, `gates.preflight[]`, `gates.postflight[]` no payload | `packages/shared/src/types.ts`, executor | Skill vem por nome (já existe o loader em `~/.agents`); gates são os comandos reais do repo |
| `GET /api/capacity` → slots livres por `runtimeProfile` | `orchestrator.ts` (`maxConcurrent`, `activeRuns`) | Admission control: o dispatcher só enfileira o que roda hoje |
| Webhook assinado `task.done` / `task.failed` com `prUrl`, `runtimeProfile`, `tokenUsage` | `settings` + `orchestrator/executor.ts` após `createPullRequest` | Fecha o ciclo sem polling |
| `runtimeProfile` → escada de modelo (`opencode-free` → `opencode-litellm` → `claude`) | `executor.ts` (resolução de modelo + retry) | Tokens grátis primeiro; item "Intelligent Model Progression" do ROADMAP |
| Postflight falhou ⇒ `failed` com motivo, **sem** PR | `executor.ts` antes do push | Nunca abrir PR que quebra o build |

## O que sai ou fica atrás de flag

- Lixo na raiz: `fix_*.js`, `patch_tags.js`, `test-sonar.js`, `old_*.txt`, `*.log`,
  `temp_templates_history.txt`, `test_hello.txt`, `run_*.sh`, `homologacao/`, `pnpm-lock.yaml`.
- `agents/queue.ts` duplica `sweepBacklog`; manter só um.
- `sessions`, `inbox`, `prompts`, `templates`, `agent-templates` ficam atrás de
  `VIBE_CODE_EXPERIMENTAL=true` até provarem uso.
- `db/schema.ts` (18 tabelas) e `migrations/001-*` (11 tabelas) precisam convergir.

## O que fica como está

Board, TaskDetail com logs ao vivo, `dependsOn` + `priority` + `sweepBacklog`, worktrees,
criação de PR, review pipeline (advisory por padrão, `STRICT` para tier de migração),
skills loader e virtual keys LiteLLM.
