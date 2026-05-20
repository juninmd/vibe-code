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
