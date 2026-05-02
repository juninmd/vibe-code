# AGENTS

Este arquivo é um índice curto. O contrato operacional do repositório está distribuído em artefatos versionados e específicos por tema.

## Leia nesta ordem

1. `WORKFLOW.md` — contrato-alvo de workflow e handoff entre objetivo, execução, validação e review.
2. `docs/repo-contract.md` — boundaries, quality gates, rollout e expectativas de mudança.
3. `docs/glossary.md` — vocabulário comum do control plane.
4. `README.md` — visão do produto, setup e surfaces atuais.
5. `CLAUDE.md` — mapa técnico do monorepo e comandos de desenvolvimento.

## Regras obrigatórias

1. **Changelog obrigatório**: toda alteração preparada para push ou release deve ser refletida em `CHANGELOG.md`.
2. **Não trate o board como a identidade do produto**: ele é uma superfície operacional; o alvo do sistema é produção autônoma de código com evidências e handoffs previsíveis.
3. **Prefira contratos versionados a instruções soltas**: novas regras duráveis devem ir para `WORKFLOW.md` ou `docs/`, não crescer indefinidamente aqui.
