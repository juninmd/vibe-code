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

## Iteração 2 — projetos, branches e credencial por conta (PRs #266/#267)

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Projeto criado e listado no cluster | `POST /api/projects` + `GET /api/projects?workspace_id=...` | `201` com `repoIds`, lista com o projeto |
| Repositório vinculado ao projeto | `POST /api/projects/:id/repos` | `repoIds: ["f7d72de7a080cd16"]` |
| Sessão grava projeto e par de branches | `POST /api/tasks` com `projectId/startBranch/prTargetBranch` | `projectId=proj-...`, `startBranch=main`, `prTargetBranch=main`, `baseBranch=main` |
| Chave de criptografia no pod | `printenv VIBE_CODE_CREDENTIAL_KEY_VERSION` | `v1` |
| Credencial de conta exige sessão de conta | `GET /api/credentials` com chave de operador | `400 {"error":"account_required"}` |
| Unidade AES-GCM | `bun test src/security/credentials.test.ts` | 10 passando (round-trip, AAD por conta, rotação v1→v2, linha ilegível) |
| Projetos | `bun test src/api/projects.integration.test.ts` | repo em 2 projetos, repo de outro workspace 403, projeto de outra conta 403, branch pair persistido |

## Iteração 3 — grants de publicação de PR (PR #269)

| Verificação | Como | Resultado |
| --- | --- | --- |
| Grant criado antes do push | `POST /api/tasks/:id/pull-request` | linha em `pr_grants` com `source=api_request`, `head_branch=vibe-code/homolog/grant`, `target_branch=main`, `turn_id` preenchido |
| Publicação sem grant | `publishRemoteSession` direto no pod após revogar | `{"code":"no_grant"}` |
| Cancelamento revoga pendências | `POST /api/tasks/:id/cancel` | `revoked_at` + `revoked_reason=session_cancelled` na linha |
| Reconciliação por head/base | teste `remote-pr.test.ts` com `findPR` mockado | `created:false`, `createPR` não chamado, `pr_url` persistido |
| Parser de pedido explícito | `pr-grants.test.ts` (22 casos) | aceita "abra um PR"/"create a pull request"; recusa pergunta, "talvez", negação e descrição |

## Iteração 4 — artefatos de sessão (PR #271)

| Verificação | Como | Resultado |
| --- | --- | --- |
| Upload de print | `POST /api/tasks/:id/artifacts/upload` (PNG 108 KB) | `201`, `mimeType=image/png`, `sha256` gravado, `expiresAt` 30 dias |
| Visualizar inline | `GET .../artifacts/:id/file` com `Authorization` | `200`, `Content-Type: image/png`, `Content-Disposition: inline` |
| Conteúdo idêntico | sha256 local vs download | `83e85711…b56aa2e` nos dois |
| Sem credencial | mesmo GET sem header | `401` |
| Tipo não-imagem | upload `notes.txt` | `Content-Disposition: attachment; filename="notes.txt"` |
| Limite por arquivo | upload de 26 MB | `413 {"error":"too_large"}` |
| UI desktop/telefone | `artifacts-desktop-1440.png`, `artifacts-mobile-390.png` | faixa "Evidências" com miniatura e download |
| Raiz dedicada | `ls /data/artifacts` no pod | arquivos em `_operator/<task>/<id>.<ext>` |

## Iteração 5 — migração de ownership (PR #273)

| Verificação | Como | Resultado |
| --- | --- | --- |
| Dry run no banco real | `bun scripts/migrate-ownership.ts --db /data/vibe.db --map {}` no pod | `ready=false`, `ISSUE unmapped_workspace ws-1795835018551`, nada escrito |
| Apply em cópia do banco | criar `acc-homolog`, mapa `{ws: acc}`, `--apply` | `applied workspaces=1 projectsCreated=1 projectsLinked=1 tasksLinked=1` |
| Idempotência | segundo `--apply` no mesmo mapa | `applied workspaces=0 projectsCreated=0 projectsLinked=0 tasksLinked=0` |
| Bloqueio por pendência | conta inexistente / repo órfão / conflito de dono | `ready=false` e `applied` zerado |
| Testes | `bun test src/migrations/ownership.test.ts` | 8 passando |

## Iteração 6 — rotinas com "Abrir PR ao final" (PR #275)

| Verificação | Como | Resultado |
| --- | --- | --- |
| Liga o toggle | `PUT /api/tasks/:id/schedule { cron, openPr:true }` | `openPr=true` persistido |
| Edita cron sem o campo | `PUT` só com `cronExpression` | `openPr` continua `true` |
| Desliga | `PUT` com `openPr:false` | `openPr=false` |
| Coluna no banco | `PRAGMA table_info(task_schedules)` no pod | `open_pr INTEGER` presente |
| Executor | grant `routine_toggle` antes do push; sem grant/toggle, não há push nem PR | coberto pelo fluxo e por `pr-grants.test.ts` |
| Teste de integração | `bun test src/api/tasks.integration.test.ts` | 62 passando |
