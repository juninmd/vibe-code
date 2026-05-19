# ROADMAP — Integrações inspiradas no multica

Candidatos catalogados durante deep explore de `D:\Solutions\pessoal\vibe\multica`. Cada item está pareado com a fonte original e o pré-requisito que falta no vibe-code hoje.

## Backend / engine

### Mention expander — `MUL-117 → [MUL-117](mention://issue/<uuid>)`
- **Origem**: `server/internal/mention/expand.go` (197 LOC + 119 LOC test).
- **Valor**: identificadores de issue clicáveis em qualquer markdown (descrição, comentário, log). Pula código inline/fenced e links já existentes.
- **Pré-requisito**: vibe-code não tem hoje numbering de issue/task com prefixo de workspace. Implementar isso primeiro ou usar o `id` curto.

### Duplicate-issue guard com lock advisory
- **Origem**: `server/internal/issueguard/duplicate.go` + `LockIssueDuplicateKey` no schema.
- **Valor**: previne criação de duas tasks idênticas em paralelo (race conditions na UI/CLI). Normaliza título (`strings.ToLower(strings.Fields(...))`).
- **Pré-requisito**: SQLite não tem `pg_advisory_lock`; portar via `INSERT OR IGNORE` em tabela de lock-keys + cleanup.

### Autopilot admission control
- **Origem**: `server/internal/service/autopilot.go::shouldSkipDispatch` (MUL-1899).
- **Valor**: antes de enfileirar uma task agendada, checa se a runtime do agente assignee está online; se não, grava `skipped` com `failure_reason`. Evita pilhas de tasks doomed quando o laptop está pausado.
- **Pré-requisito**: vibe-code é single-runtime hoje; aplicável quando houver remote runtimes ou pause/resume de daemon.

### bareDirName collision-safe encoding
- **Origem**: `server/internal/daemon/repocache/cache.go::bareDirName` (host+path com `+`, `:`→`%3A`).
- **Valor**: dois remotes distintos (`gitlab:22/org/repo` vs `gitlab-22/org/repo`) nunca colidem no diretório bare. Hoje vibe-code usa `${repoName}.git`, sujeito a colisão silenciosa quando dois repos diferentes têm mesmo nome final.
- **Pré-requisito**: nenhum — só requer migração das bares existentes (renomear `<name>.git` → `<host>+<owner>+<name>.git`). Risco baixo se feito com fallback de lookup.

### Token usage map por modelo no resultado final
- **Origem**: `opencode.go::Execute` retorna `map[model]TokenUsage`.
- **Valor**: vibe-code emite `cost` events por step, mas não acumula por modelo no Result final. Adicionar agregação no orchestrator possibilita relatórios "custo por modelo por task" sem reprocessar logs.
- **Pré-requisito**: definir tabela de agregação em `agent_runs` ou tabela nova `agent_run_usage`.

### MCP config por engine
- **Origem**: `opts.McpConfig json.RawMessage` + `writeMcpConfigToTemp` em `claude.go`.
- **Valor**: passar config MCP custom por agent sem rebuildar. Daemon escreve para tempfile e remove no fim.
- **Pré-requisito**: definir UI para gerenciar configs MCP por workspace/agent.

## Frontend / UX

### Já entregue
- **Timeline bar** sobre o accordion de steps (segmentos coloridos com click-to-scroll).
- **redactSecrets** safety-net no display.
- **TaskStatusPill** semântico (Thinking/Reading/Running/...) com anchor monotônico de tempo.
- **ToolFilterDropdown** multi-select aplicado a timeline + accordion.
- **formatElapsedSecs/Ms** util compartilhado.
- **shortenPath + summarizeToolInput** com fallback chain do multica.
- **MetadataChip** com 5 tones (default/info/warning/success/danger).
- **PropRow** (CSS subgrid label/value) para sidebar do task card.
- **sort-runs utils**: partitionRuns + sortPastRuns (failed→cancelled→completed).

### Pendente — inspirado em `agent-transcript-dialog.tsx`
- **Filtro por categoria semântica**: agent/text/thinking/tool/result/error cores fixas (`getEventColor`) — alinha com timeline bar quando ambas existirem.
- **getEventSummary smart fallback chain** — `input.query → file_path → path → pattern → command (truncate 120) → prompt → skill → primeiro string < 120`. Hoje vibe-code usa primeira linha do `log.content` apenas.
- **shortenPath helper** — `/a/b/c/d/e.ts → .../d/e.ts` para previews. Aplicar em `getEventSummary` e em badges.
- **Metadata chips no header** — runtime/provider/duration/event-count em pílulas pequenas (multica usa `MetadataChip` component). Hoje espalhados no toolbar.
- **Copy filtered/all** — exporta apenas eventos visíveis (multica já distingue `copy_all` vs `copy_filtered` no i18n).
- **headerSlot prop** — slot opcional entre header e timeline para mostrar trigger payload (webhook, scheduled, manual) sem o agente precisar ecoar.
- **`#seq` indicators** — número sequencial small/tabular-nums por evento; útil para citar passo em comentários ou bug reports.
- **Transcript dialog separado** — multica abre dialog full-screen-ish (`!max-w-4xl !h-[calc(100vh-4rem)]`) ao invés de painel embedded. Útil para inspeção forense de runs concluídos.

## Achados deep explore #5 (módulos restantes)

### Backend (ainda não portado)
- **Event Bus** (`server/internal/events/bus.go`): pub/sub sync in-process com handlers por tipo + globais (`SubscribeAll`), panics recuperados. Permite analytics/audit/realtime listeners sem acoplar dispatch. **Quando portar**: ao crescer número de listeners para eventos de task lifecycle (>3 consumidores).
- **Rate limit middleware** (`server/internal/middleware/ratelimit.go`): per-IP per-route fixed window, Lua atomic INCR+EXPIRE em Redis. Para vibe-code (sem Redis), variant in-memory `Map<key, {count, expiresAt}>` protegeria `/api/auth/dev-login` e `/api/tasks/:id/launch` de abuso.
- **Trusted-proxy X-Forwarded-For**: walk right-to-left no XFF chain, honra apenas se RemoteAddr está em CIDR confiável. Critical para deploys atrás de proxy.
- **WS event dedup ring** *(já portado como util; falta wiring)*: integrar no `BroadcastHub` quando o protocolo WS ganhar campo `id`. Hoje deduplicação é por timestamp no client (`AgentOutput.tsx`).
- **RerunIssue com `force_fresh_session=true`** (`handler/task_lifecycle.go`): rerun manual NÃO herda sessão (usuário já julgou output prévio ruim), retry automático HERDA (infraestrutura, não conteúdo). vibe-code não distingue hoje.
- **PinTaskSession daemon endpoint**: persiste `session_id` + `work_dir` assim que conhecidos, sobrevive crash mid-run. vibe-code salva session_id mas verificar se workDir também é gravado eagerly.
- **`InjectRuntimeConfig` por engine** (`daemon/execenv/runtime_config.go`): grava arquivo nativo do CLI (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) com identidade do agente + comandos disponíveis. Hook nativo dos CLIs ao invés de prompt injection. vibe-code escreve algum context mas não com esse mapeamento provider-specific de filename.
- **Skill conflict detector**: multica trata "Skill conflict detected: X from A is overriding same skill from B" — vibe-code/gemini observado no terminal real (5 conflitos durante homologação). Mostrar warning visível no AgentOutput.

### Frontend (ainda não portado)
- **ExecutionLogSection layout** (`packages/views/issues/components/execution-log-section.tsx`): collapse "Show past runs (N)" com bucket active sticky. Separador visual entre ativos e passados. Pin: failed-first ranking.
- **Mask gradient para truncate** (TRIGGER_MASK_STYLE): `linear-gradient(to right, black calc(100% - 12px), transparent)` para fade-out suave de textos longos antes das ações trailing. Visual mais polido que ellipsis.
- **IssueChip pattern** (`packages/views/issues/components/issue-chip.tsx`): chip presentation-only, NÃO link/button — caller decide wrap. Single source of truth para "task mention card".
- **Reaction bar / Reactions** (`packages/views/issues/hooks/use-issue-reactions.ts`): emoji reactions agregadas em tasks/comments — desejável quando tasks ganharem comentários.
- **AvatarGroup** (`@multica/ui/components/ui/avatar`): N avatars sobrepostos + contador. Útil para mostrar quem está acompanhando uma task (subscribers).
- **PageHeader** + `useDefaultLayout` + `ResizablePanelGroup`: layout 3-painéis (sidebar / main / right-panel) com persistência de tamanho. Substitui split-pane atual do TaskDetail.

### Engine-specific (codex)
- **`StderrTail` wired in codex execute** (`server/pkg/agent/codex.go::drainAndWait`): `sync.Once` que fecha stdin + cmd.Wait() antes de ler `stderrBuf.Tail()`. Garante que `os/exec` flush as goroutines de stderr antes da amostragem. **Crítico**: sem `Wait()` antes de `Tail()`, o tail pode vir vazio. Já existe util `StderrTail` portado; falta wiring na engine codex.ts.
- **`semanticInactivityTimeout`** (codex.go): timeout separado de absolute, default 10min. Reseta apenas em eventos "semanticamente significativos" (text/tool_use, NÃO heartbeats). vibe-code tem inactivity watchdog mas não distingue.

## Observações operacionais

- Multica é Go/Postgres/Next.js — não copiar arquitetura, só padrões transversais.
- Tudo que tocar UI deve sobreviver no monorepo Bun + Hono + React 19 + Tailwind 4 + Vite (sem Next.js).
- **Áreas exploradas (cumulative)**: `pkg/agent/{opencode,gemini,codex,claude,agent,stderr_tail}.go`, `internal/{events/bus,middleware/ratelimit,daemonws/hub,realtime/broadcaster,service/autopilot,service/cron,issueguard,mention,handler/{task_lifecycle,activity},daemon/{repocache/cache,local_skills,execenv/runtime_config}}.go`, `agenttmpl/`, `packages/views/{common/{prop-row,task-transcript/*},chat/{components/task-status-pill,lib/{copy-text,format}},issues/components/{agent-live-card,issue-chip,execution-log-section,issue-detail (1937 LOC)}}.tsx`.
- **Áreas não auditadas profundamente** (baixo leverage para vibe-code): dashboard widgets (utils.ts 274 LOC — métricas agregadas), onboarding flow, runtimes UI (multi-runtime não aplicável a vibe-code single-host), squad routing (vibe-code não tem squads), inbox panel (vibe-code já tem InboxPanel próprio), invitations/auth-signup, GitHub webhook handler, autopilot webhook IPRL test, analytics/posthog (vibe-code é self-hosted single-user).
