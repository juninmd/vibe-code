# Port de T3 Code e Paseo

O que o vibe-code adotou de [T3 Code](https://github.com/pingdotgg/t3code) (MIT) e
[Paseo](https://github.com/getpaseo/paseo) (Apache-2.0). Portamos ideias e regras,
reescritas para Bun + Hono + React; nenhum código, nome ou marca foi copiado.
Arquivos que seguem um desenho específico citam a origem num comentário de uma linha.

## Adotado

| Item | Origem | Onde |
| --- | --- | --- |
| Regras de agente: riscos, toda superfície, testes, docs | T3 Code `AGENTS.md`, Paseo `AGENTS.md` | `AGENTS.md` §6 |
| Regras de design: tokens, um CTA de destaque, estados | Paseo `docs/design.md` | `AGENTS.md` §6.3 |
| Work log: chamadas de ferramenta agrupadas fora do texto, "ir para o fim" | T3 Code `WorkLog`, `useTimelineFollow` | `features/remote-workspace/workLog.ts` |
| Paleta de comandos com registro, ↑↓/Enter e atalhos globais (`?` lista) | T3 Code `keybindings.ts`, Paseo Command Center | `features/remote-workspace/commands.ts` |
| Prompts anteriores com ↑/↓ e rascunho por sessão que sobrevive ao reload | Paseo `composer/recall.ts`, `composer/draft/` | `features/remote-workspace/composerHistory.ts` |
| Aviso ciente de presença quando a sessão termina, ponto de não visto e contador no título | Paseo `agent-attention-policy.ts` | `features/remote-workspace/attention.ts` |

## Fora do escopo por ora

- Modos de permissão e cards de aprovação: exigem o Agent SDK do Claude ou `opencode serve`
  com SDK. Hoje o OpenCode roda com `opencode run`, sem canal de aprovação.
- Troca de provider no meio da conversa com handoff de contexto (T3 Code orchestration-v2).
- Checkpoints por turno e rewind; agentes como servidor MCP (Paseo); voz; apps nativos.
- Login por pareamento (T3 Code): o vibe-code mantém GitHub OAuth ou chave de API.
