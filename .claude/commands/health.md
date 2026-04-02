# /health — Verificação completa de qualidade

Execute a pipeline completa de qualidade do monorepo e reporte os resultados de forma concisa.

## Passos

1. **Lint** — `bun run lint 2>&1` (ou `bun biome check .`)
2. **Typecheck** — `bun run typecheck 2>&1`
3. **Testes server** — `bun run --filter '@vibe-code/server' test 2>&1`
4. **Testes web** — `bun run --filter '@vibe-code/web' test 2>&1`
5. **Build** — `bun run build 2>&1`

Execute todos em sequência. Para cada passo, mostre:
- ✅ Passou — com contagem de testes/arquivos processados
- ❌ Falhou — com os erros específicos, caminho do arquivo e linha

Ao final, mostre um resume em formato tabela:

| Passo      | Status | Detalhes       |
|------------|--------|----------------|
| Lint       | ✅/❌  | N erros        |
| Typecheck  | ✅/❌  | N erros        |
| Tests/srv  | ✅/❌  | N/N passed     |
| Tests/web  | ✅/❌  | N/N passed     |
| Build      | ✅/❌  | -              |

Se tudo passar: "🟢 Pipeline 100% — pronto para PR."
Se algo falhar: "🔴 X problema(s) encontrado(s) — corrija antes do PR."
