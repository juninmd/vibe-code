# /fix — Corrigir erros de TypeScript e lint

Encontre e corrija todos os erros de TypeScript e lint no monorepo.

## Processo

1. Execute `bun run typecheck 2>&1` e capture todos os erros.
2. Execute `bun biome check . 2>&1` e capture todas as violações.
3. Para cada erro encontrado:
   - Leia o arquivo em questão
   - Entenda o contexto (tipos esperados vs recebidos, regra de lint violada)
   - Aplique a correção mínima necessária — não refatore código não relacionado
4. Após todas as correções, execute `bun run typecheck` e `bun biome check .` novamente para confirmar 0 erros.

## Regras

- Não altere interfaces/tipos públicos sem avaliar impacto em outros pacotes
- Prefira `as unknown as T` apenas se absolutamente necessário — procure a solução semântica primeiro
- Para erros de lint auto-fixáveis, prefira `bun biome check . --write`
- Mantenha todas as correções dentro do escopo mínimo necessário

Ao final, mostre quantos erros foram corrigidos por arquivo.
