# Troca das primitivas locais pelo Sonido

O `packages/web` mantinha, dentro de `workspace.css` e das views, os mesmos padrões que o
[`@juninmd/sonido`](https://github.com/juninmd/sonido) publica. Esta pasta guarda a comparação
lado a lado usada na revisão da troca.

| Componente      | Antes (vibe-code)                                             | Depois (`@juninmd/sonido`)                                                     |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Button`        | `<button class="rw-button [primary\|subtle]">`                 | `Button` (variantes `primary`, `default`, `subtle`) com `loading` e `iconStart` |
| `Tabs`          | `<nav class="rw-settings-tabs">` com `button.selected`         | `Tabs` (`variant="pill"`, foco itinerante e `aria-selected`)                    |
| `Badge`         | `<span class="rw-count">` e chips `rw-skill-chips > span`      | `Badge` (pílula, tons e contraste AA)                                           |
| `EmptyState`    | `<div class="rw-empty-view">` + ícone + `h3` + `p`             | `EmptyState` (marca, superfície tracejada, ação opcional)                      |
| `Skeleton`      | `<p role="status">Carregando…</p>`                             | `Skeleton` (linhas com shimmer e anúncio em região viva)                        |
| `Spinner`       | `<span class="rw-status-dot working">` + frase                 | `Spinner` decorativo + frase na região `status`                                 |
| `Kbd`           | `<kbd>` cru                                                    | `Kbd` (keycap do design system)                                                |
| `CommandPalette`| componente local com busca, setas e grupos                     | `CommandPalette` do Sonido; `filterCommands` do app decide o que a busca acha   |

Os adaptadores finos ficam em `packages/web/src/ui/` e preservam a API que o app já usava
(`variant="subtle"`, `title`, `aria-*`, `onClick`). O tema é o mesmo dos dois lados: o app e o
Sonido leem `data-theme` no `<html>`; `src/theme/sonido.ts` traduz `github-dark` (que o Sonido
não publica) para os tokens escuros padrão.

O único ajuste de layout está em `src/sonido-bridge.css`: largura/margem da troca de abas, do
estado vazio e dos botões dentro de `rw-pr-actions`. Cor, tipografia e a estrutura interna dos
componentes continuam sendo do Sonido. As regras globais de `button`/`a` do workspace deixaram
de alcançar classes `sn-*` para não sobrescrever o design system.

## Capturas

`preview.html` + `preview.tsx` montam a mesma página com os dois lados. O lado **Antes** importa
cópias do markup de `origin/main` em `legacy/`; o lado **Depois** importa os arquivos do app já
apoiados no Sonido. A página usa o CSS real do app (`index.css` + `workspace.css`) e o
`styles.css` instalado do Sonido.

```bash
bunx vite --config docs/sonido-migration/vite.config.mts
# http://localhost:5303/preview.html
# http://localhost:5303/preview.html?theme=light
node C:/caminho/para/full.cjs "http://localhost:5303/preview.html" "docs/sonido-migration/antes-depois.png"
```

As capturas (`antes-depois.png`, `antes-depois-claro.png`) foram feitas em Chromium 1180×900,
`fullPage`, com dados fictícios.

## O que ficou de fora

- As abas da sessão (Conversa / Terminal / Alterações) continuam locais: o `Tabs` do Sonido não
  tem item desabilitado, e essas abas precisam ficar desabilitadas sem sessão selecionada.
- `SearchField`, `Dialog` e `Toast` não foram trocados nesta passagem; o diálogo de projeto e a
  lista de atalhos ainda usam o `<dialog>` local.

## Verificação

```text
bun install                 → bun.lock atualizado; pnpm-lock.yaml intocado
bun run test                → 26 arquivos, 145 testes
bun run build               → tsc -b + vite build OK (com o bypass abaixo)
bun run lint                → biome check OK
```

`bun run typecheck` e `bun run build` falham neste Windows antes de qualquer mudança, porque o
repositório tem `workLog.ts` e `WorkLog.tsx` e o TS resolve `./WorkLog` no arquivo de caixa
diferente. A falha foi reproduzida em `origin/main` num export limpo:

```text
src/features/remote-workspace/WorkspaceViews.tsx(15,10): error TS2305:
  Module '"./WorkLog"' has no exported member 'WorkLog'.
src/features/remote-workspace/WorkspaceViews.tsx(15,25): error TS1149:
  File name '.../WorkLog.ts' differs from already included file name '.../workLog.ts'
  only in casing.
```

No Linux (CI) o mesmo import resolve normalmente. Para conferir o restante da árvore neste
Windows, `WorkLog.tsx` foi renomeado temporariamente durante o `tsc`; com isso `typecheck` e
`build` passam. O arquivo foi restaurado e não faz parte do diff.
