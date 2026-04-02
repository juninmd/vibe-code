# /add-migration — Adicionar migração SQLite

Adiciona uma nova migração ao banco de dados do vibe-code de forma segura.

## Argumentos

`/add-migration <descrição>` — ex: `/add-migration add-task-tags-table`

## Processo

1. Leia `packages/server/src/db/schema.ts` para entender a estrutura atual.
2. Leia `packages/server/src/db/migrations.ts` (ou o arquivo de migrations existente) para ver o padrão.
3. Determine o próximo número de versão da migração.
4. Crie a migração com:
   - `ALTER TABLE` ou `CREATE TABLE` conforme necessário
   - Rollback documentado em comentário (o que fazer para desfazer)
   - `NOT NULL` com DEFAULT para colunas novas em tabelas existentes (evit quebrar registros existentes)
5. Atualize os tipos TypeScript em `packages/shared/src/types.ts` se necessário.
6. Execute `bun run typecheck` para confirmar que não há erros.

## Regras de segurança

- Nunca use `DROP COLUMN` sem confirmar com o usuário
- Sempre adicione `DEFAULT` ao adicionar coluna `NOT NULL` em tabela existente
- Documente o rollback de cada migração em comentário
- Execute em `:memory:` primeiro (nos testes) antes de aplicar em produção
