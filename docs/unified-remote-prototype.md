# Workspace remoto unificado

A interface inspirada no Claude Code Remote em `/` reúne projetos, sessões, conversa,
terminal e alterações.
Skills, plugins, agentes e configurações abrem na própria navegação, sem kanban ou
questionário. `/prototype` permanece como alias. A autenticação GitHub ou por chave
de acesso existente protege as duas entradas. `/legacy` preserva o painel avançado.

## Executar com dados isolados

```powershell
bun install --frozen-lockfile
bun run build
./scripts/preview-unified.ps1
```

Abra http://127.0.0.1:5188/. O servidor real escuta somente em `127.0.0.1`;
banco, clones e registro ficam em `%TEMP%/vibe-code-unified-preview`.
O script aceita `-Port` e `-PreviewDirectory` e preserva os dados ao encerrar.
Para usar uma instalação existente, abra `/` na origem dela. O Vite preview sem
backend permite apenas a demonstração explícita com `?demo=1`.

## Fluxos reais

- **Projetos:** conecte uma URL ou caminho Git em Configurações → Projetos.
  O clone é preparado pelo servidor; a criação de sessão consulta as branches reais.
- **Conversa:** enviar inicia uma tarefa conversacional quando o engine anuncia
  suporte a retomada. O OpenCode usa o mesmo contexto e workspace nas mensagens
  seguintes. Uma falha preserva o rascunho; parar a execução é uma ação explícita.
  A seleção de sessão fica na URL para sobreviver ao reload. O histórico consulta
  os últimos cinco runs e atualiza a cada segundo enquanto o agente trabalha.
- **Terminal:** conecta o xterm ao harness atual. Abrir a aba não dispara outro
  processo. Quando parado, iniciar/retomar prepara o workspace e as skills. Um run
  headless ativo impede um segundo harness. No OpenCode 2, o terminal herda o
  identificador da conversa e grava esse mesmo identificador no run para o chat.
- **Modelo e effort:** catálogos consultados no CLI instalado; nenhum novo catálogo
  estático. O OpenCode persiste a variante no identificador `provider/model#variant`
  usado pelos turnos e aplica o modelo pela API nativa no terminal. Claude Code
  recebe `--effort` no terminal; o CLI valida a compatibilidade com o modelo.
- **Alterações:** mostra commits, arquivos modificados e arquivos novos no workspace,
  inclusive enquanto a sessão está parada. A leitura não prepara arquivos nem cria
  commits. Arquivos novos binários ou maiores que 1 MiB têm apenas indicação de
  conteúdo indisponível; links que escapam do workspace não são lidos.
- **Recursos:** biblioteca de skills globais e do projeto, leitura das instruções,
  seleção de skills ao iniciar o terminal e consulta dos templates de agentes.
- **Configurações:** acesso GitHub e teste de conexão; projetos; harness e concorrência;
  chaves Anthropic/OpenAI/Gemini; LiteLLM; mapa JSON de servidores MCP. Segredos
  mascarados nunca preenchem os campos e as novas credenciais não ficam no navegador.

Engines sem suporte a conversa retomável, como o adaptador headless atual do
Claude Code, criam sessões manuais que usam o terminal nativo. Não há simulação de
respostas em sessões reais. A demonstração é opcional e identifica seus exemplos;
as páginas de recursos/configurações continuam consultando o servidor.

## Plugins remotos e importação em lote

Informe `owner/repo` ou uma URL GitHub. O servidor descobre a branch padrão e fixa
um commit completo. A credencial configurada no servidor permite acesso privado
e a cota autenticada; erros de cota orientam configurar acesso ou aguardar.
Metadados de revisões fixas têm cache limitado e separado por credencial.

Skills incluem toda a pasta, com referências e scripts: até 200 arquivos, 1 MiB
por arquivo e 8 MiB por pacote. Para um `SKILL.md` na raiz, o pacote é o próprio
repositório e está sujeito aos mesmos limites. Caminhos inseguros e links simbólicos
são excluídos. Importar não executa scripts ou hooks: os recursos ficam pendentes
para leitura, ativação ou rejeição. Ativos podem ser removidos.

**Importar todas as skills** processa o catálogo inteiro, independentemente da busca.
Cópias da mesma skill são deduplicadas, priorizando `.agents/skills`. As existentes
são preservadas, inclusive pendentes. Progresso e resultados individuais mostram
sucessos, itens existentes e falhas; repetir tenta os restantes. Parar aguarda a
skill em andamento e preserva os resultados. Não há ativação automática. Mutações
do registro são serializadas e o manifesto é substituído atomicamente.

Estes plugins são recursos de instruções. Skills ativas podem compor o plugin
Claude Code ou as skills OpenCode do workspace. Agentes/regras/workflows ficam no
catálogo; o seletor do terminal injeta skills. A tela não instala extensões
JavaScript arbitrárias do OpenCode.

## Contratos adicionados

- `GET /api/engines/:engine/harness-models` retorna
  `{ "data": [{ "id": "provider/model", "name": "Model", "efforts": ["high"] }] }`.
  Os valores são exemplos de formato, não uma lista de modelos disponíveis.
- `GET /api/skills/remote/catalog?repo=juninmd/skills` retorna `repo`, `ref`, `commit`
  e `assets` com `name`, `path`, `category`, `files`.
- `POST /api/skills/remote/import` recebe `{ "repo": "owner/repo", "commit": "<sha40>",
  "path": ".agents/skills/example/SKILL.md" }`; retorna um registro pendente com
  `id`, origem, checksum, `bundleRoot` e `fileCount`. Erros usam `{ "error": "mensagem" }`.
- `GET /api/skills/registry/:id/content` retorna `{ "data": { "content": "..." } }`.
  Aprovação, rejeição e remoção reutilizam as rotas existentes do registro.
- `POST /api/terminal/:taskId/start` aceita `effort` opcional, validado no catálogo
  do modelo. O estado do terminal inclui `model` e `effort` quando está ativo.

As extensões são aditivas. `VIBE_CODE_SKILLS_PATH` configura a mesma pasta para
loader e registro; `VIBE_CODE_HOST` configura o endereço de escuta. Defaults mantidos.
Não há nova migração de banco. Para voltar à interface anterior, abra `/legacy`;
para reverter a promoção, retorne o entrypoint autenticado para `AuthenticatedApp`.
Dados, APIs e repositórios existentes são preservados.

## Validação e limites

```powershell
bun run lint
bun run typecheck
bun run test
bun run build
$env:VIBE_PROTOTYPE_LIVE_GITHUB = "1"
$env:VIBE_PROTOTYPE_LIVE_HARNESS = "1"
bunx playwright test --config playwright.prototype.config.ts
```

O navegador usa servidor real e diretórios isolados. Cenários de contrato substituem
apenas fronteiras externas; são distintos da homologação GitHub e do TUI instalado.
O teste nativo cria uma conversa vazia antes de retomar e não envia prompt ao modelo.
Na validação anterior, em 20/10/2026, o lote real de `juninmd/skills`, revisão
`915a14f542e620a2f6309083cc24265aafcfc049`, concluiu 35 skills: 30 novas, cinco
preservadas, zero falhas no acesso autenticado. Esse registro histórico não substitui
uma nova execução das integrações opcionais.
A skill já ativa foi mantida e as novas ficaram pendentes. Isso não certifica a
qualidade das instruções importadas; a ativação exige revisão do conteúdo.

O transporte nativo existente usa PTY em POSIX e pipes no Windows. O TUI OpenCode
foi exercitado no Windows; não há uma implementação nova de ConPTY. Testes POSIX
são ignorados explicitamente no Windows. CI remota e implantação são evidências
separadas dos gates locais. Capturas da UI e do terminal são anexadas ao PR.

As capturas `docs/screenshots/unified-remote/live-workspace-*.png` mostram a versão
compilada com um repositório e uma tarefa locais de teste, sem executar um modelo.
As demais capturas dessa pasta documentam o protótipo e integrações anteriores.

Código: `packages/web/src/features/remote-workspace/`; estilos restritos a `rw-*`.
