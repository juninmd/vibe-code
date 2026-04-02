# /new-engine — Scaffoldar novo motor de IA

Cria um novo adaptador de engine para o vibe-code seguindo o padrão existente.

## Argumentos esperados

`/new-engine <nome>` — ex: `/new-engine copilot`

## Processo

1. Leia `packages/server/src/agents/engine.ts` para entender a interface `AgentEngine`.
2. Leia `packages/server/src/agents/engines/claude-code.ts` como referência de implementação.
3. Leia `packages/server/src/agents/registry.ts` para entender como registrar a engine.
4. Crie `packages/server/src/agents/engines/<nome>.ts` com:
   - Classe implementando `AgentEngine`
   - Método `execute()` que faz spawn do CLI via `Bun.spawn` e yield de `AgentEvent`
   - Método `getVersion()` que retorna a versão do CLI instalado (ou null)
   - Método `cancel()` que mata o processo filho
   - Stdin mantido aberto para interatividade
5. Registre a engine em `registry.ts` (import + `register(new <Nome>Engine())`).
6. Adicione o nome da engine ao tipo `EngineName` em `packages/shared/src/types.ts`.
7. Adicione instruções de instalação em `EnginesPanel.tsx` (objeto `INSTALL_DOCS`).

## Saída esperada

Após criar os arquivos, rode `bun run typecheck` para confirmar que não há erros de tipo.
Mostre um resumo dos arquivos criados/modificados com os números de linha relevantes.
