# Automação de PR e conectores (portado do vibe-kanban)

Módulos em `packages/server/src/automation/`:

| Módulo | Função |
| --- | --- |
| `reactions.ts` | Política por evento (`ci_failed`, `changes_requested`, `approved`, `agent_stuck`, `validation_failed`) → `reinvoke`/`notify`/`skip`, com `max_retries` e `escalate_after`. |
| `ci-monitor.ts` | Poll único do CI (GitHub Actions / CircleCI) e resumo dos jobs que falharam. |
| `review-monitor.ts` | Decisão de review, comentários, fingerprint (não reprocessa o mesmo feedback) e diff do PR. |
| `spec-compliance.ts` | Critérios de aceite (`- [ ]`) verificados por LLM contra o diff. |
| `plan-validation.ts` | Ciclos, ondas de execução, sobreposição de arquivos e revisão por LLM. |
| `enrichment.ts` | Palavras-chave da task e arquivos relevantes via `git grep`. |
| `kill-escalation.ts` | SIGTERM → SIGKILL após período de graça. |
| `pr-automation.ts` | Loop que liga tudo às tasks em `review` (60 s). Desligue com `VIBE_CODE_PR_AUTOMATION=false`. |

LLM: `LITELLM_BASE_URL`/`LITELLM_API_KEY` ou `OPENAI_API_KEY` (`VIBE_AUTOMATION_MODEL`). Sem LLM, a spec compliance falha de forma segura e a validação de plano usa só as checagens estáticas.

API: `POST /api/automation/validate-plan`, `GET /api/automation/reactions`,
`POST /api/connectors/{backlog,comment,slack}` (Jira, Linear, Notion, ClickUp, Asana, Trello, Monday, Slack; credenciais vêm no corpo, nada é gravado).

## Avatares e ambientes 3D

`packages/web/src/components/office3d/`: `skins.ts` (dev, robô, astronauta, mago, ninja, gato) e `environments.ts` (escritório, estação espacial, cyberpunk, floresta, praia). Seletores no modo 3D, persistidos em `localStorage`. Protótipo: `docs/previews/avatar-skins/` (`index.html` + screenshots; rebuild com `bun build main.ts --outfile bundle.js --target browser`).
