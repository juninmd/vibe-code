# AGENTS

Índice e regras operacionais para o **vibe-code** — um **Painel de Controle de Produção Autônoma de Código** (Autonomous Code Production Control Plane) que orquestra agentes de IA em workspaces/worktrees isolados com validação determinística.

## 1. Mapa de Conhecimento (Leia nesta ordem)
- [WORKFLOW.md](file:///d:/Solutions/pessoal/vibe/vibe-code/WORKFLOW.md) — Contrato de ciclo de vida (Intake -> Run -> Validação -> Review).
- [docs/repo-contract.md](file:///d:/Solutions/pessoal/vibe/vibe-code/docs/repo-contract.md) — Boundaries e Quality Gates.
- [docs/glossary.md](file:///d:/Solutions/pessoal/vibe/vibe-code/docs/glossary.md) — Vocabulário padronizado do control plane.
- [README.md](file:///d:/Solutions/pessoal/vibe/vibe-code/README.md) & [CLAUDE.md](file:///d:/Solutions/pessoal/vibe/vibe-code/CLAUDE.md) — Setup local, surfaces e comandos técnicos.

## 2. Regras Operacionais Críticas
- **Changelog**: Registrar alterações para push ou release em [CHANGELOG.md](file:///d:/Solutions/pessoal/vibe/vibe-code/CHANGELOG.md).
- **Qualidade**: Linter (Biome) e testes devem passar com sucesso antes de finalizar.
- **Resolução de Conflitos**: Usar a mesma sessão do agente (`session_id`) para resolver conflitos de merge na task.
- **Segurança e Isolamento**: Repositórios pertencem a workspaces. Valide acessos usando `repositories.workspace_id`.
- **Agent Templates**: Localizados em `packages/server/src/agents/templates/*.json` (validados no boot via `agent-templates.ts`).

## 3. Diretivas Técnicas e Limitações
- **Processos**: Encerrar árvores de processos filhos usando `process-tree.ts` (`killProcessTree`). Nunca mate `node.exe` globalmente.
- **OpenCode**: Invocar o executável nativo em `node_modules/opencode-windows-*/bin/opencode.exe` para evitar truncamento de prompts multiline.
- **Gemini CLI**: Injetar `GEMINI_CLI_TRUST_WORKSPACE=true` em worktrees temporárias para evitar erros de workspace não confiável (Exit 55).
- **Watchdog de Inatividade**: Logs de sistema (ex: `"Still running..."`) não resetam `VIBE_CODE_INACTIVITY_MS`.
- **Banco de Dados (SQLite)**: `PRAGMA foreign_keys = ON` ativa validação rígida de chaves estrangeiras. Crie workspaces antes de associar repositories.
- **Testes**: Excluir testes do Bun (`packages/web/src/utils/*.test.ts`) no `vite.config.ts` (Vitest) e executá-los via `bun test`.
- **Proibição de Modelos Hardcoded (Trava)**: Nenhum engine de agente pode ter listas estáticas/hardcoded de modelos (ex: `COPILOT_MODELS = [...]`, `staticModels = [...]`). Esta restrição é validada deterministicamente pelo teste unitário em [hardcoded-models.test.ts](file:///d:/Solutions/pessoal/vibe/vibe-code/packages/server/src/agents/engines/hardcoded-models.test.ts). Modelos devem ser carregados dinamicamente via consultas à CLI do respectivo agente, LiteLLM, ou variáveis de ambiente de customização/override (`VIBE_<ENGINE>_MODELS`).

## 3.1 Aprendizados Windows (validado 2026-07-15)
- **Paths em drives diferentes**: `path.relative(cwd, dir)` entre drives (`D:` vs `C:`) retorna caminho **absoluto** (sem `..`). Qualquer guard "está dentro do repo?" precisa também checar `isAbsolute(rel)` — bug real corrigido no guard de `VIBE_CODE_DATA_DIR` em `packages/server/src/index.ts`.
- **Argv não preserva newlines**: `Bun.spawn(["bun", "--eval", "<script multi-linha>"])` faz o filho imprimir o help. Em testes, escrever o script em arquivo temporário e rodar `bun <arquivo>` (ver `FakeOpenCodeEngine` em `opencode.test.ts`). Mesmo motivo pelo qual prompts vão via stdin para o OpenCode.
- **Commit no worktree**: após desestagiar `.vibe-code/`, validar o **index** (`git diff --cached --name-only`), não o working tree; hooks do repo alvo (husky/commitlint) podem rejeitar o commit do orquestrador — fallback `--no-verify` em `git-service.ts::commitAll`.
- **Locale**: nunca usar `toLocaleString()` sem locale fixo em output comparado por testes (máquinas pt-BR formatam `1.234`). Usar `toLocaleString("en-US")`.
- **Repo bare deletado com DB `ready`**: `orchestrator.launch` re-clona automaticamente (self-heal) — não assumir que `status=ready` implica bare presente no disco.

## 3.2 Suíte E2E (Playwright)
- `bun run test:e2e` na raiz. O `playwright.config.ts` sobe server real isolado (porta 3123, data dir em `%TEMP%`, auth desabilitada com env vazias) + Vite (5199) e cria um repo git fixture. Specs em `e2e/` (API smoke + fluxo do board/modal).

## 4. Operação em Produção (k8s) — Engines, Modelos & Memória
Aprendizados de homologar o OpenCode rodando dentro do container deployado (`ghcr.io/juninmd/vibe-code`, Debian/Bun). Validado 2026-06-04.

- **Toolchain nativo é obrigatório na imagem**: o `Dockerfile` runtime instala `build-essential pkg-config`. Sem isso, agentes que compilam deps nativas (Rust/cgo) falham com `cc not found`, ficam 300s sem output e o run trava (`AGENT FAILED: stalled`).
- **Modelos OpenCode Zen free (`opencode/*-free`, `opencode/big-pickle`) TRAVAM no container**: `auth.json` vazio e o request ao gateway nunca retorna (egress p/ `opencode.ai` está OK — HTTP 200; logo, não é rede). Hipótese forte: o provider `opencode` (Zen) exige login de conta (`opencode auth login`). **Não usar como modelo default** — leva ao loop de retry abaixo.
- **Caminho FREE funcional = GitHub Models** (`github-models/openai/gpt-4o-mini` etc.): usa o `GITHUB_TOKEN` que o OpenCode auto-detecta (`opencode auth list` → "GitHub Models"). Endpoint `models.github.ai/inference` aceita PAT clássico (scope mínimo) — confirmado retornando completion. Sujeito a rate-limit do free tier.
- **GitHub Copilot (`github-copilot/*`) NÃO funciona com PAT clássico**: retorna `Personal Access Tokens are not supported for this endpoint` (exige token OAuth do Copilot).
- **`DEFAULT_OPENCODE_MODEL`** (`agents/engines/opencode.ts`): Configurado para `github-models/openai/gpt-4o-mini` — modelo free funcional (usa o `GITHUB_TOKEN` do deploy).
- **Rota LiteLLM** (`litellm-client.ts` + `providers` no `opencode.ts`): só ativa quando `LITELLM_MASTER_KEY` (a chave REAL, não placeholder) **e** `LITELLM_BASE_URL` estão no env. `getLiteLLMBaseUrl()` faz fallback p/ `localhost:4000` se ausente. Comprovadamente funcional via provider OpenAI-compatible, mas pode estar desabilitada por preferência do operador.
- **Memória**: runs do OpenCode são pesados; rodar OpenCode somando ao server sob limite de 2Gi causa `OOMKilled` e reinício do pod. Manter `VIBE_CODE_MAX_AGENTS=1` e/ou subir o limite de memória; nunca disparar OpenCode extra dentro do pod de produção via `kubectl exec`.
- **Loop de retry monopoliza o slot**: run que trava (stall 300s) → `AGENT FAILED` → auto-retry **sem teto**, prendendo o único slot (`MAX_AGENTS=1`) e matando de fome todas as outras tasks. Parar uma task em loop: `POST /api/tasks/{id}/cancel` e então `PATCH {status:"archived"}` (status `cancelled`/`canceled` → 400; `cancel` sozinho só mata o run atual e o orchestrator repesca a task do backlog). Tasks com tag `auto-improve` são auto-relançadas pelo orchestrator.

## 5. Blockers de Homologação do Fluxo Free E2E (abertos em 2026-06-04)
Estado: o OpenCode free **não fecha fluxo completo (PR aberto)** no deploy atual. PRs JÁ foram abertos com sucesso antes (github-assistance #125–132, 19–20/mai) → é **regressão**, não greenfield. Causas identificadas, em ordem de prioridade:

1. **Watchdog de inatividade mata runs que não streamam eventos** (provável causa raiz): runs do OpenCode (tanto Zen `*-free` quanto `github-models/*`) ficam 300s sem emitir evento de agent parseável → `stalled` → `AGENT FAILED` → retry. O `"Still running..."` (heartbeat) NÃO conta como atividade. A API do GitHub Models responde isolada (curl direto OK), mas o run via OpenCode `--format json` não produz evento dentro de `VIBE_CODE_INACTIVITY_MS=300000`. Investigar parsing de eventos in `engines/opencode.ts::parseLine` vs formato real de saída do OpenCode 1.15.x, e/ou aumentar/segmentar o watchdog na fase `generating`.
2. **Gate de verificação falha em repos não-JS**: `Verification failed: unable to discover validation commands from WORKFLOW.md or package.json`. Repos Python/uv (ex: github-assistance) não têm `package.json` → o quality-gate aborta **antes do PR**. Precisa detectar `pyproject.toml`/`uv`/`Makefile` ou permitir validação opt-out por repo.
3. **`MAX_AGENTS=1` não é respeitado**: observados 4 runs `in_progress` simultâneos. Enforcement de concorrência (`orchestrator.ts::launch` / `activeCount`) está furado — runs órfãos/zumbis não decrementam o contador.
4. **Modelo default inválido**: [Resolvido] Trocado para o free funcional `github-models/openai/gpt-4o-mini`.
