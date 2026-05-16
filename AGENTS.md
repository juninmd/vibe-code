# AGENTS

Este arquivo é um índice curto. O contrato operacional do repositório está distribuído em artefatos versionados e específicos por tema.

## Leia nesta ordem

1. `WORKFLOW.md` — contrato-alvo de workflow e handoff entre objetivo, execução, validação e review.
2. `docs/repo-contract.md` — boundaries, quality gates, rollout e expectativas de mudança.
3. `docs/glossary.md` — vocabulário comum do control plane.
4. `README.md` — visão do produto, setup e surfaces atuais.
5. `CLAUDE.md` — mapa técnico do monorepo e comandos de desenvolvimento.

## Regras obrigatórias

1. **Changelog obrigatório**: toda alteração preparada para push ou release deve ser refletida em `CHANGELOG.md`.
2. **Não trate o board como a identidade do produto**: ele é uma superfície operacional; o alvo do sistema é produção autônoma de código com evidências e handoffs previsíveis.
3. **Prefira contratos versionados a instruções soltas**: novas regras duráveis devem ir para `WORKFLOW.md` ou `docs/`, não crescer indefinidamente aqui.

## Aprendizados operacionais

### API do vibe-code

- O cookie de sessão chama-se `vibe_session` (não `session`). O middleware lê via `getCookie(c, "vibe_session")`.
- O token enviado no cookie é o valor **raw**; o DB armazena `sha256(token)` na coluna `id` da tabela `auth_sessions`. Para injetar sessão diretamente no SQLite, calcule o hash antes de inserir.
- O campo para associar uma task a um repositório é `repoId` (não `repositoryId`). O prompt da task vai no campo `description`.
- Para adicionar um repo local, passe o path absoluto como `url` no POST `/api/repos` — o `GitService.isRepoSource()` aceita paths locais com `.git`.
- Repositórios locais adicionados por path não têm `url` pública; o `ConflictResolver` pode falhar ao tentar verificar PRs no GitHub para esses repos — filtre antes.

### Portas e processo no Windows

- A porta 3000 ficou travada com PID zumbi (processo Claude Code desktop morto mas socket kernel vivo). `Stop-Process` e `netsh` sem admin não liberam. Workaround: usar outra porta e atualizar `.env` + `packages/web/.env.local` + `VIBE_CODE_PUBLIC_URL`.
- `$pid` é variável reservada no PowerShell — use outro nome (ex: `$pp`, `$portPid`) em loops.
- `Start-Process` com `-RedirectStandardOutput` e `-RedirectStandardError` apontando para o mesmo arquivo falha. Use arquivos separados.
- `-Environment` não é parâmetro válido no `Start-Process` do Windows PowerShell. Defina a env var antes: `$env:VAR = 'value'` e então chame `Start-Process`.
- Processos iniciados com `bun ... &` no bash WSL não sobrevivem quando o shell termina. Use `Start-Process ... -WindowStyle Hidden -PassThru` para daemons persistentes.

### Sidecar autônomo (`scripts/sidecar.ts`)

- O sidecar **não roda automaticamente** junto com o servidor — precisa ser iniciado como processo separado.
- Em cluster/Docker, toda configuração pode ser passada via env vars sem alterar o `sidecar.config.json`:
  - `VIBE_SERVER_URL` — URL interna do serviço vibe-code
  - `VIBE_SESSION_TOKEN` — token raw da sessão (obrigatório; sem isso todas as chamadas retornam 401)
  - `SIDECAR_REPOS` — lista de URLs separadas por vírgula
  - `SIDECAR_MODEL`, `SIDECAR_PROVIDER`, `SIDECAR_INTERVAL_MINUTES`, `OLLAMA_BASE_URL`
- O `sidecar-client.ts` injeta o cookie `vibe_session` a partir de `VIBE_SESSION_TOKEN`.
- Para economizar tokens, use Ollama local. Modelos disponíveis no ambiente: `qwen3:1.7b` (mais leve), `gemma4:e4b`. O `qwen3:1.7b` é preferido para o sidecar.
- O sidecar salva aprendizados por repo em `~/.vibe-code/sidecar.db` — não compartilhado entre nós de cluster.

### vite.config.ts

- `loadEnv` não está exportado por `vitest/config`. Importe de `"vite"` separadamente: `import { loadEnv } from "vite"; import { defineConfig } from "vitest/config";`
- Para que o proxy do Vite dev server leia a URL do backend de `.env.local`, use `loadEnv(mode, process.cwd(), "")` e acesse `env.VITE_SERVER_URL`.

### Orquestrador e max agents

- `Orchestrator.setMaxConcurrent(n)` atualiza o limite em runtime sem reiniciar o servidor.
- O valor persiste em `db.settings` com chave `max_agents` e é restaurado no startup via `db.settings.get("max_agents")`.
- O campo `maxAgents` foi adicionado a `SettingsResponse` e `UpdateSettingsRequest` em `packages/shared/src/types.ts` — ao adicionar campos na API, atualizar sempre os tipos compartilhados.
