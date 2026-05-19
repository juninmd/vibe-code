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
4. **AGENTS.md obrigatório em todo repositório modificado**: ao modificar qualquer repositório externo, verifique se existe `AGENTS.md` na raiz. Se não existir, crie um com os aprendizados relevantes ao LLM sobre aquele repositório (stack, convenções, armadilhas, comandos, env vars). Nunca commite sem o arquivo presente.
5. **Resolução de conflitos e CI via sessão única do agente da task**: ao resolver merge conflicts ou falhas em GitHub Actions jobs, use sempre a mesma sessão do agente que executou a task — não abra sessões paralelas para o mesmo problema. Use o engine da task (opencode, gemini, claude-code, etc.) com o session_id registrado nos logs. Fluxo obrigatório:
   ```
   # 1. Atualizar a branch (espera-se que conflito apareça)
   git fetch origin && git merge origin/main   # ou rebase
   # 2. Se conflito ou job falhou, passar para o agente na mesma sessão
   <engine> -s '<session_id>' \
     --prompt 'Resolver conflitos de merge em <arquivo(s)>. Contexto: <descrição do problema>'
   # 3. Nunca abrir nova sessão — usar o session_id da sessão atual para manter contexto acumulado
   ```
   O `session_id` fica visível nos logs da task no vibe-code. Isso garante contexto completo e evita análises repetidas.

## Catálogo de Agent Templates (portado do multica)

Templates de personas curadas para bootstrap de novos agentes — pares `instructions` + skill refs.

- **Local**: `packages/server/src/agents/templates/*.json` (25 templates: bug-fixer, code-reviewer, brainstormer, adr-writer, pr-description, release-notes, summarizer, translator-zh-en, etc.).
- **Loader**: `packages/server/src/agents/agent-templates.ts` — `AgentTemplateRegistry` carrega sincronamente no startup, valida slug kebab-case, slug=filename, campos obrigatórios (`name`, `instructions`) e `skills[i].source_url`. Duplicatas e malformados abortam o boot.
- **API**:
  - `GET /api/agent-templates` → `{ data: AgentTemplate[] }` (ordem determinística).
  - `GET /api/agent-templates/:slug` → `{ data: AgentTemplate }` ou 404.
- **Auth**: rotas atrás de `authMiddleware`. Em scripts/CI use `Authorization: Bearer $VIBE_CODE_API_KEY`.
- **Adicionar template novo**: criar `<slug>.json` no diretório com `{slug, name, description, category, icon, accent, instructions, skills:[{source_url,cached_name,cached_description}]}`. Nome do arquivo **deve** ser `<slug>.json`. Restart do server valida; falha de validação é fail-fast no boot — desejado.
- **Smoke test**: `bun test packages/server/src/agents/agent-templates.test.ts` (6 testes: load, validação de campos, get por slug, GET /, GET /:slug, 404).
- **Homologação ponta a ponta validada (2026-05-18)**: server em PORT=3099 retornou `count: 25`, `code-reviewer` com 1 skill e instructions de 1389 chars, 404 para slug inexistente.

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

### EventDedup + PropRow + sort-runs (portado do multica — deep explore #5)

- **EventDedup** (`packages/server/src/ws/event-dedup.ts`): ring buffer bounded (default 128) por cliente WS, `markSeen(id)` retorna `true` se primeira ocorrência, `false` se dup. Empty/undefined id = always-deliver (compat com eventos legados sem id). Ports de `daemonws/hub.go::markSeen`. Pronto para wiring quando o protocolo WS ganhar `id` em mensagens.
- **PropRow** (`packages/web/src/components/PropRow.tsx`): linha label/valor com CSS subgrid (`grid-cols-subgrid`) para que labels do mesmo container alinhem na largura do mais largo automaticamente. Substituir `w-16` mágicos no `TaskDetail` sidebar.
- **sort-runs utils** (`packages/web/src/utils/sort-runs.ts`): `partitionRuns(runs)` separa active vs past; `sortPastRuns(runs)` ordena failed → cancelled → completed, newest first dentro de cada grupo. Permite seção "Past runs" ordenada por urgência (failed primeiro precisa atenção).

### Homologação ponta a ponta (2026-05-19)

Subi o servidor em `PORT=3098`, criei repo local em `D:/tmp/vibe-homolog-repo` (auto-clone com per-repo lock OK), executei tasks reais:

- **Shim resolver (opencode)** ✅: server log mostra `running: ...\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe run --format json --model anthropic/claude-sonnet-4-5 --dir ...` — binário **nativo** invocado, `.cmd` shim pulado. Task chegou a `phase=generating` em <3s.
- **GEMINI_CLI_TRUST_WORKSPACE=true** ✅: `gemini -p "What is 2+2?"` em worktree não-listada com env injetado retornou `4` sem `FatalUntrustedWorkspaceError`. Fix bloqueia exit 55 quando `security.folderTrust.enabled=true`.
- **Per-repo lock** ✅: `cloneRepo` finalizado sem colisão de lockfile, repo ficou `status: ready` em <4s.

### GEMINI_CLI_TRUST_WORKSPACE fix + stderr-tail + event-summary utils (portado do multica)

- **Gemini folder-trust bypass** (`packages/server/src/agents/engines/gemini.ts::buildGeminiChildEnv`): injeta `GEMINI_CLI_TRUST_WORKSPACE=true` quando não definido. Caller env wins. **Por que vale**: com `security.folderTrust.enabled` ligado em `~/.gemini/settings.json`, gemini headless em worktrees não-listadas dá exit 55 (`FatalUntrustedWorkspaceError`) sem output útil, run morre após ~10s. Documented escape hatch do próprio CLI (multica gemini.go::buildGeminiEnv).
- **StderrTail util** (`packages/server/src/agents/engines/stderr-tail.ts`): ring buffer bounded (default 2KB) que forward para handler + retém tail. `withAgentStderr(msg, label, tail)` compõe "exit N; codex stderr: …". Pronto para wiring no codex/gemini quando CLI falha antes do handshake JSON-RPC.
- **shortenPath + summarizeToolInput** (`packages/web/src/utils/event-summary.ts`): paths longos viram `.../parent/file.ts`; resumo de tool input segue fallback chain do multica (`query → pattern → path → description → command(120) → prompt(120) → skill → url → first short string`). Pronto para uso em transcript/timeline.
- **MetadataChip** (`packages/web/src/components/MetadataChip.tsx`): pílula reutilizável com 5 tones (default/info/warning/success/danger) — disponível para refactor do toolbar do `AgentOutput`.

### Semantic StatusPill + ToolFilter dropdown (portado do multica)

- **TaskStatusPill** (`packages/web/src/components/TaskStatusPill.tsx`): pill no toolbar do `AgentOutput` que mostra **o que o agente está fazendo agora**, inferido do último log significativo — `Thinking`, `Reading files`, `Running command`, `Searching code`, `Making edits`, `Fetching web`, `Git operation`, `Replying`, ou `Queued`/`Starting up`. Skip de heartbeats e stderr para o label não piscar.
- **Anchor monotônico de tempo** (padrão multica): `useRef` trava o timestamp inicial; nunca é reatribuído, então o timer nunca "salta para trás" quando `startedAt` opcional chega depois do mount.
- **pickTaskStage util** (`packages/web/src/utils/task-stage.ts`): pura, testável, mapeia (status, logs) → stage. 10 testes Bun cobrindo cada heurística.
- **formatElapsedSecs/Ms** (`packages/web/src/utils/elapsed.ts`): drops "0s" em round-minutes (`3m`, não `3m 0s`). 4 testes Bun.
- **ToolFilterDropdown** (`packages/web/src/components/ToolFilterDropdown.tsx`): multi-select por tool/icon detectado nos `stepGroups`. Click fora ou ESC fecha. `count` por opção. Aplicado a `filteredStepGroups` que alimenta tanto a `AgentTimelineBar` quanto o accordion — filtra ambas em lockstep. Botão "Clear filters" aparece quando há seleção.

### Timeline bar + redactSecrets na UI (portado do multica)

- **Timeline bar** (`packages/web/src/components/AgentTimelineBar.tsx`): barra horizontal de segmentos coloridos sobre o accordion de steps em `AgentOutput`. Cada segmento = step group, largura proporcional ao log count, cor herda de `detectToolColor`, vermelho se houver stderr. Hover mostra tool/log count; click expande o step e faz `scrollIntoView` no container.
- **Por que vale**: scan visual da execução completa cabe em <50px de altura. Detecta visualmente concentrações de errros, steps longos e padrões repetidos sem precisar abrir os accordions.
- **redactSecrets** (`packages/web/src/utils/redact.ts`): safety-net no display layer — passa por logs antes de `convertAnsi`/`dangerouslySetInnerHTML`. Cobre: AWS keys, GitHub/GitLab PATs, OpenAI sk-*, Slack xox*, JWTs, Bearer tokens, connection strings, env vars (`API_KEY=`, `TOKEN=`, etc.).
- **Por que vale**: defesa em profundidade. Se um agente vazar segredo em log, o servidor não viu e a UI redacta antes de renderizar.
- **Smoke tests**:
  - `packages/web/src/utils/redact.test.ts` (9 testes Bun) — cobre cada padrão.
  - `packages/web/src/components/AgentTimelineBar.test.tsx` (5 testes Vitest) — render, click, empty, error tint, min width. **Nota**: vitest está bloqueado por timeout de worker no ambiente local (pré-existente, atinge TaskCard.test.tsx também). Testes Bun rodam normalmente.

### Per-repo lock no GitService (portado do multica)

- **Problema**: git mantém lockfiles globais por bare-repo (`packed-refs.lock`, `config.lock`, dirs admin de worktree). Clone/fetch/worktree-add concorrentes na mesma bare colidem e abortam (visto principalmente quando duas tasks compartilham o mesmo repo).
- **Fix**: `GitService.withRepoLock(barePath, fn)` serializa mutações por bare path; bares diferentes rodam em paralelo. Aplicado a `cloneRepo`, `fetchRepo`, `createWorktree` (fetch + worktree-add atômicos) e `removeWorktree`.
- **Smoke test**: `packages/server/src/git/git-service.lock.test.ts` (2 testes — serializa same-path, paraleliza diff-path).

### filterCustomArgs + VIBE_OPENCODE_EXTRA_ARGS (portado do multica)

- Operadores podem passar flags extras ao opencode via `VIBE_OPENCODE_EXTRA_ARGS` (separadas por espaço).
- `filterCustomArgs` (em `agents/engines/blocked-args.ts`) descarta flags protocol-critical: `--format`, `--dir`, `--session`, `--model`. Cada drop loga warning.
- Útil para passar `--print-logs`, `--verbose` etc. sem rebuildar binário e sem risco de quebrar o protocolo JSON.
- Smoke test: `packages/server/src/agents/engines/blocked-args.test.ts` (6 testes — inline `=value`, standalone, with-value, callback).

### step_finish: cost event com cache tokens (portado do multica)

- O parser do opencode agora emite um `cost` event a cada `step_finish` com `input_tokens`, `output_tokens`, `total_tokens` e `cached` (mapeado de `tokens.cache.read`).
- Log system mostra `tokens in:N out:M (cache r:X w:Y)` — taxa de cache hit é a alavanca mais acionável de custo.
- Smoke test: `packages/server/src/agents/engines/opencode.cache-tokens.test.ts` (3 testes).

### Fix: opencode.cmd shim trunca prompts multiline (portado do multica)

- **Causa raiz**: `npm install -g opencode-ai` instala um `opencode.cmd` shim do Windows. O encaminhamento `%*` do batch **não preserva newlines** — prompts multilinha são truncados na primeira `\n` antes de chegar ao JS entrypoint, fazendo o agente ver apenas a primeira linha (= zero output útil).
- **Fix** (`packages/server/src/agents/engines/opencode.ts`):
  - `resolveOpencodeNativeFromShim()` localiza o `opencode.exe` nativo dentro de `node_modules/opencode-ai/node_modules/opencode-windows-{x64,x64-baseline,arm64}/bin/`.
  - `resolveOpencodeBinary()` é chamado em `buildCommandArgs()` — no Windows usa o nativo; nas demais plataformas devolve `"opencode"`.
  - Ordem de candidatos respeita `process.arch`; baseline serve CPUs antigas sem AVX2.
- **Belt-and-suspenders**: `OPENCODE_PERMISSION={"*":"allow"}` agora também é injetado via env no `Bun.spawn`, complementando `opencode.json`. Se o arquivo falhar ao gravar, o env var ainda autoriza tools.
- **Smoke test**: `bun test packages/server/src/agents/engines/opencode.shim-resolver.test.ts` (5 testes com mock `statFn`, cobrem x64, x64-baseline, arm64 e fallback).
- Resultado esperado: prompts multilinha agora chegam íntegros ao agente no Windows, eliminando a causa documentada de "zero output real em muitos cenários".

### Processo opencode no Windows (legado — ver fix acima)

- O opencode com `--format json` e stdin fechado produz zero output real em muitos cenários no Windows. O watchdog de inatividade é a única salvaguarda — ele deve disparar e marcar a task como `failed` após `INACTIVITY_MS`.
- Tasks marcadas como `failed` pelo watchdog **devem** voltar ao backlog manualmente ou via requeue — o orquestrador não faz isso automaticamente.
- Quando o server é reiniciado, todos os processos opencode em flight morrem com exit 143 (SIGTERM). Os runs ficam presos como `running` no DB. Sempre resetar o DB antes de reiniciar.
- `opencode run --session <id>` teóricamente permite resumir sessões interrompidas, mas ainda **não foi homologado** — o engine atual não implementa retomada automática por sessionId.

### Fluxo de reinício seguro (checklist legado — ver seção atualizada abaixo)

1. Matar todos os processos: `Get-Process | Where-Object { $_.Name -match 'bun|opencode' } | Stop-Process -Force`
2. O reset manual do DB não é mais necessário — `recoverInProgressTasks()` trata isso no startup
3. Iniciar server: `bun run dev:server`
4. O startup bloqueia automaticamente todos os `in_progress` e promove top-10 para backlog
