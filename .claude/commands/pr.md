# /pr — Preparar e descrever Pull Request

Prepara o branch atual para PR: valida qualidade, gera título e body.

## Processo

1. Execute `git diff main...HEAD --stat` para ver o que mudou.
2. Execute `git log main...HEAD --oneline` para ver os commits.
3. Execute `bun run typecheck 2>&1` — se falhar, avise o usuário e pare.
4. Execute `bun run --filter '*' test 2>&1` — se falhar, avise e pare.
5. Com base nas mudanças, gere:

### Título do PR
Formato conventional commit: `<tipo>(<escopo>): <descrição concisa em inglês>`
Tipos: feat, fix, refactor, perf, chore, docs, test

### Body do PR (em inglês)
```markdown
## Summary
- <bullet point por mudança significativa>

## Changes
- `caminho/arquivo.ts` — o que mudou e por quê

## Test plan
- [ ] <ação de teste manual relevante>
- [ ] All CI checks pass

## Notes
<contexto adicional se necessário>

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
```

6. Mostre o título e body gerado.
7. Pergunte: "Quer que eu crie o PR agora com `gh pr create`?"
