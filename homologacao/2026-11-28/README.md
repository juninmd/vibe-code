# Homologação — 2026-11-28

Ambiente: cluster k3s `junin-vm`, namespace `vibe-code`, release
`https://vibe.antonio-code.duckdns.org`.
Imagem: `ghcr.io/juninmd/vibe-code:latest` (build do merge `e16e38b`, que inclui
as PRs #259, #263 e #264).

## O que foi exercitado

| Verificação | Comando | Resultado |
| --- | --- | --- |
| App responde atrás do Traefik (TLS wildcard) | `curl -s https://vibe.antonio-code.duckdns.org/health` | `200 {"status":"ok"}` |
| SPA servida | `curl -s -o /dev/null -w '%{http_code}' https://vibe.antonio-code.duckdns.org/` | `200` |
| API protegida sem credencial | `curl -s -o /dev/null -w '%{http_code}' https://vibe.antonio-code.duckdns.org/api/workspaces` | `401` |
| API responde com a chave de operador | `curl -H "Authorization: Bearer $VIBE_CODE_API_KEY" .../api/workspaces` | `200` com o workspace `personal` |
| Status de autenticação público | `GET /api/auth/me` | `enabled:true`, `authenticated:false`, `methods.apiKey:true` |
| Login em desktop 1440 px | `homologacao/2026-11-28/login-desktop-1440.png` | tela de acesso renderiza |
| Workspace autenticado em desktop | `homologacao/2026-11-28/workspace-desktop-1440.png` | sessão, conversa e composer |
| Login em telefone 390 px | `homologacao/2026-11-28/login-mobile-390.png` | sem overflow |
| Workspace em telefone 390 px | `homologacao/2026-11-28/workspace-mobile-390.png` | abas, composer e seletor de modelo |
| Contas/allowlist (unidade) | `bun test src/accounts.test.ts src/auth.test.ts src/oauth src/security` | 50 testes passando |
| Typecheck do servidor | `bun run --filter @vibe-code/server typecheck` | exit 0 |
| Lint | `bun run lint` | 0 erros |

## Pendências conhecidas do ambiente

- **Credenciais OAuth ausentes**: `GITHUB_OAUTH_CLIENT_ID/SECRET` e
  `GOOGLE_OAUTH_CLIENT_ID/SECRET` não existem no cluster (foram apagados junto
  com o deploy anterior). Enquanto não forem cadastradas, `/api/auth/me`
  reporta `methods.github=false` e `methods.google=false` e a tela mostra
  apenas a chave de operador. A allowlist (`VIBE_CODE_ALLOWED_EMAILS`) já está
  aplicada ao secret `vibe-code-secret`: `jr_acn@hotmail.com`,
  `juninho140695@gmail.com`.
- **Runner Kubernetes**: o ServiceAccount `default` do namespace não tem a Role
  do runner (`docs/k8s-runner.md`); o servidor sobe, mas o modo "um pod por
  tarefa" fica indisponível. A execução "Dentro do servidor" funciona.
- **Chave OpenCode Go por conta** e demais itens da issue #262 (projetos com
  vários repositórios, grants de PR, artefatos) seguem fora desta entrega.
