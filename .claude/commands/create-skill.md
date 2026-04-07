# /create-skill — Capturar comportamento real do OpenCode e transformar em skill reutilizável

Use este comando quando precisar aprender algo novo sobre o OpenCode através de execução real e registrar esse aprendizado como testes e conhecimento interno do projeto.

## Objetivo

Transformar uma execução manual do OpenCode em três artefatos:

1. Fixture sanitizado para replay
2. Teste focado cobrindo o contrato observado
3. Atualização do conhecimento interno em `.claude/agents/opencode-testing.md`

## Processo

1. Verifique disponibilidade do CLI:
   - `opencode --version`
   - `opencode models | head -n 20`
2. Rode um cenário manual curto com JSON:
   - `opencode run --format json --model opencode/minimax-m2.5-free --dir <workdir> "<mensagem>"`
3. Capture stdout/stderr em arquivos temporários.
4. Sanitizar:
   - paths absolutos
   - timestamps
   - session IDs
   - snapshots dinâmicos
5. Salve o fixture sanitizado ao lado da engine.
6. Escreva ou atualize teste de replay cobrindo a ordem e o comportamento observados.
7. Atualize `.claude/agents/opencode-testing.md` com o aprendizado novo.
8. Valide com:
   - `bun test packages/server/src/agents/engines/opencode.replay.test.ts`
   - `bun test packages/server/src/agents/engines/opencode.test.ts`

## Critérios de qualidade

- Não aceite fixture que só repete texto sem ensinar nada sobre o fluxo da engine.
- Prefira cenários que revelem ferramentas, erros recuperáveis ou transições de estado.
- Se o comportamento real contradizer os testes atuais, corrija a implementação antes de expandir a suíte.

## Saída esperada

Mostre:

- qual comando manual foi executado
- qual comportamento novo foi aprendido
- quais arquivos de fixture/teste/skill foram criados ou atualizados
- resultado dos testes focados
