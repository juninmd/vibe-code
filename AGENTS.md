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
- **Limite seguro: máximo 10 agentes simultâneos** — acima disso o Windows começa a se engasgar com RAM/CPU dado que cada opencode process consome memória significativa.

### BUG CRÍTICO: concorrência não respeitada após reinício (CORRIGIDO)

- **Causa raiz**: `Orchestrator.activeRuns` é in-memory. Após reinício do servidor, `activeRuns.size = 0` mesmo que o DB tenha 40 tasks com `status='in_progress'`. O guard `activeRuns.size >= maxConcurrent` era sempre falso no startup — o sweepBacklog lançava TODOS os agentes de uma vez, ignorando o limite.
- **Fix**: `activeCount` agora usa `Math.max(activeRuns.size, db.tasks.list(undefined, "in_progress").length)` — conta tasks no DB que ainda não estão em memória.
- **Fix 2**: `setMaxConcurrent()` tinha cap hardcoded em 10 — aumentado para 50 para permitir configurar via UI.
- **Fix 3**: `recoverInProgressTasks()` é chamado no startup (index.ts) — move TODOS os in_progress para `blocked`, depois promove os top-N (por prioridade) de volta ao `backlog` para o sweepBacklog pegar gradualmente.
- **Regra**: nunca usar `activeRuns.size` diretamente para guardar concorrência — sempre usar `activeCount`.

### Status "blocked" (concorrência excedida)

- `"blocked"` foi adicionado ao `TaskStatus` em `packages/shared/src/types.ts` — sem isso os guards do TypeScript recusam o valor em assignments.
- Tasks bloqueadas aparecem em coluna laranja no Board com badge `🔒 Blocked` e botão `Resume`.
- `POST /api/tasks/:id/unblock` → `orchestrator.unblockTask()` → move para backlog e dispara `sweepBacklog()`.
- O cliente web tem `api.tasks.unblock(id)` e `useTasks.unblockTask()`.
- Testes: `packages/server/src/agents/orchestrator/recover-blocked.test.ts` — 5 smoke tests, todos passam.

### Gemini CLI — sessão e integração

- O engine `gemini.ts` usa `parseAcpMessage` do `acp-parser.ts` — suporte a `session/started` e `session/resumed` já está implementado no parser, então a session_id é salva automaticamente se o gemini CLI emitir essas mensagens JSON-RPC.
- O gemini suporta `resumeSessionId` via flag `-r <id>` no CLI.
- Para homologar sessão gemini: verificar nos logs se aparece `[session] <id>` após iniciar uma task — significa que o parser capturou o session ID.

### Restore de sessão — enviar "continue" após resume (TODOS OS ENGINES)

- Quando um processo é encerrado e a sessão é retomada (`resumeSessionId` presente), o CLI já tem todo o contexto salvo internamente.
- **Problema**: enviar o prompt completo novamente ao retomar confunde o CLI (contexto duplicado, comportamento imprevisível).
- **Fix** (`executor.ts`): `effectivePrompt = activeSessionId ? "continue" : promptWithContext`
  - Se há `activeSessionId` (resume mode), envia apenas `"continue"` como stdin para o CLI retomar de onde parou.
  - Aplica-se a **todos os engines** (opencode, gemini, claude-code, codex, copilot) pois o executor é o ponto único de chamada.
- Log visível nos eventos da task: `[resume] Sending "continue" to session <id> (engineName)`
- Os sub-prompts de repair/improvement/autofix (linhas 889+) **não** são afetados — são novos prompts dentro da mesma execução, não retomadas de sessão anterior.

### Fluxo de reinício seguro (ATUALIZADO)

1. Matar todos os processos: `Get-Process | Where-Object { $_.Name -match 'bun|opencode|gemini' } | Stop-Process -Force`
2. **NÃO é mais necessário resetar o DB manualmente** — `recoverInProgressTasks()` bloqueia os órfãos no startup automaticamente.
3. Iniciar server: `bun run dev:server`
4. O startup chama `recoverInProgressTasks()`: move todos `in_progress` para `blocked`, promove top-N para `backlog`
5. `sweepBacklog()` lança até `maxConcurrent` agentes (default 10 no DB)
6. Tasks restantes ficam `blocked` e aparecem visualmente no Board com badge laranja

### Banco de dados (SQLite)

- O DB de produção está em `~/.vibe-code/vibe.db` (não `vibe-code.db`). O caminho é construído em `packages/server/src/index.ts` como `join(DATA_DIR, "vibe.db")`.
- `tmp_test_db/test.sqlite` é usado apenas pelos testes — **não é o DB da aplicação rodando**.
- Para resetar runs/tasks órfãos após matar processos brutalmente:
  ```sql
  UPDATE agent_runs SET status='failed', finished_at=datetime('now'), error_message='Process killed externally' WHERE status='running' OR status='pending';
  UPDATE tasks SET status='backlog' WHERE status='in_progress';
  ```
- Fazer esse reset **antes** de reiniciar o servidor — caso contrário o orquestrador pensa que há 60+ agents rodando e recusa novos lançamentos.

### Heartbeat vs watchdog de inatividade (BUG CRÍTICO CORRIGIDO)

- O engine emite `{type:"log", stream:"system", content:"Still running..."}` como heartbeat a cada 30s.
- **BUG**: `event-handler.ts` chamava `onActivity()` para esses eventos de sistema, fazendo o watchdog de inatividade nunca disparar. Tasks ficavam presas `in_progress` por horas sem produzir output real.
- **FIX** (commit: `fix: heartbeat system logs must not reset inactivity watchdog`):
  ```typescript
  const isRealAgentOutput =
    (event.type === "log" && event.stream !== "system") ||
    event.type === "error" || event.type === "status" || event.type === "cost";
  if (isRealAgentOutput && event.content) { onActivity?.(); }
  ```
- `VIBE_CODE_INACTIVITY_MS=600000` (10min) é o valor correto com esse fix. Sem o fix, aumentar esse valor só escondia o problema.

### Processo opencode no Windows

- O opencode com `--format json` e stdin fechado produz zero output real em muitos cenários no Windows. O watchdog de inatividade é a única salvaguarda — ele deve disparar e marcar a task como `failed` após `INACTIVITY_MS`.
- Tasks marcadas como `failed` pelo watchdog **devem** voltar ao backlog manualmente ou via requeue — o orquestrador não faz isso automaticamente.
- Quando o server é reiniciado, todos os processos opencode em flight morrem com exit 143 (SIGTERM). Os runs ficam presos como `running` no DB. Sempre resetar o DB antes de reiniciar.
- `opencode run --session <id>` teóricamente permite resumir sessões interrompidas, mas ainda **não foi homologado** — o engine atual não implementa retomada automática por sessionId.

### Fluxo de reinício seguro (checklist legado — ver seção atualizada abaixo)

1. Matar todos os processos: `Get-Process | Where-Object { $_.Name -match 'bun|opencode' } | Stop-Process -Force`
2. O reset manual do DB não é mais necessário — `recoverInProgressTasks()` trata isso no startup
3. Iniciar server: `bun run dev:server`
4. O startup bloqueia automaticamente todos os `in_progress` e promove top-10 para backlog
