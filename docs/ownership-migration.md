# Migração de ownership (workspace → conta)

A entrega de produção não adivinha dono de recurso: o operador fornece um mapa
explícito e roda primeiro um **dry run**.

```bash
# mapa: { "<workspaceId>": "<accountId>" }
cat ownership.json
{ "ws-1795835018551": "acc-..." }

# dry run (não escreve nada)
bun run scripts/migrate-ownership.ts --db /data/vibe.db --map ownership.json

# aplica (idempotente; recusa se houver qualquer pendência)
bun run scripts/migrate-ownership.ts --db /data/vibe.db --map ownership.json --apply
```

Saída: contagens, plano por workspace, issues e o que foi aplicado. `--json`
imprime o relatório para automação. Códigos de saída: `0` relatório gerado,
`2` apply bloqueado por issues, `1` entrada inválida.

## Regras

- Workspace sem entrada no mapa → `unmapped_workspace`; o acesso segue bloqueado
  para ele e o apply não escreve nada.
- Conta inexistente → `unknown_account`.
- Workspace já pertence a outra conta → `workspace_conflict` (não sobrescreve).
- Repositório sem workspace → `orphan_repository`; tarefa cujo repositório sumiu
  → `orphan_task`. Ambos bloqueiam o apply em vez de chutar dono.
- Aplicação: grava `workspaces.owner_account_id`; deriva repositórios do
  workspace, cria/liga o projeto inicial (`proj-<repoId>`) e aponta as tarefas
  para ele. Artefatos e agendamentos herdam pela sessão/tarefa.
- Segunda execução com o mesmo mapa aplica `0` em tudo.

## Antes de aplicar em produção

1. `kubectl -n vibe-code exec deploy/vibe-code -- cp /data/vibe.db /data/backup-vibe.db`
   (ou snapshot do PVC).
2. Dry run e revisão das issues com o operador.
3. `--apply` com escritores parados; depois valide contagens e o login das contas
   mapeadas.
4. Rollback: parar o pod, restaurar o arquivo do backup e subir o binário
   anterior; o relatório do dry run fica no log do operador.
