# GEMINI CLI

Data da validacao: 2026-05-06

## Status

Compatibilidade operacional validada para o projeto apos ajuste em
`packages/server/src/agents/engines/gemini.ts`.

O engine agora chama Gemini CLI em modo headless com `--output-format stream-json`,
envia o prompt por `stdin`, interpreta eventos `message`, `tool_use`, `tool_result`
e `result`, e finaliza com `complete:0` em smoke real.

## Fontes oficiais consultadas

- Repositorio oficial: https://github.com/google-gemini/gemini-cli
- Headless mode: https://geminicli.com/docs/cli/headless/
- Get started: https://google-gemini.github.io/gemini-cli/docs/get-started/
- NPM oficial: https://www.npmjs.com/package/@google/gemini-cli

## Contrato confirmado

- Instalacao oficial: `@google/gemini-cli`.
- Binario local validado: `gemini` / `gemini.cmd`.
- Versao local: `0.41.1`.
- Headless: `-p` ou `--prompt`.
- Output estruturado: `--output-format stream-json`.
- Model override: `-m <model>`.
- Resume: `-r <session>` / `--resume <session>`.
- Aprovacao total: `--yolo` ou `--approval-mode yolo`.
- Modo somente leitura seguro para smoke: `--approval-mode plan`.
- Skills: `gemini skills list/install/link/enable/disable/uninstall`.
- Modelos: nao ha subcomando shell nativo de listagem, mas ha slash command interativo
  `/model` e comando direto `/model set <model-name> [--persist]`.

## Smoke tests executados

| Teste | Resultado |
| --- | --- |
| `gemini.cmd --version` | OK, retornou `0.41.1`. |
| `gemini.cmd --help` | OK, confirmou flags usadas pelo engine. |
| `Bun.spawn(["gemini", "--version"])` | OK, o runtime do projeto consegue resolver o binario. |
| `gemini.cmd --list-sessions` | OK, sem sessoes anteriores neste projeto. |
| Env sem segredos | `GEMINI_API_KEY`, `GOOGLE_GEMINI_BASE_URL`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI` nao estavam setadas; OAuth salvo localmente autenticou. |
| `--approval-mode=plan --skip-trust -p "Reply with exactly OK." --output-format stream-json` | OK, JSONL com `init`, `message`, `result`, exit 0. |
| `--yolo -m gemini-2.5-flash --output-format stream-json -p "Reply with exactly OK."` | OK, exit 0, `tool_calls:0`. |
| `--output-format json` | OK, retornou JSON unico com `response` e `stats`. |
| `GeminiEngine.execute()` apos patch | OK, stdout `OK`, custo emitido, `complete:0`. |
| `gemini.cmd skills list` | OK, listou skills descobertas em `C:\Users\jr_ac\.agents\skills`. |
| `gemini.cmd skills list --all` | Parcial: listou tambem built-in `skill-creator`, mas terminou com assertion nativa do Node/libuv no Windows. |
| Pesquisa no bundle nativo por `/model` | OK, encontrou `packages/cli/src/ui/commands/modelCommand.ts` e `ModelDialog`. |
| Pesquisa no bundle nativo por `/models` | OK, nao encontrou slash command plural; o comando documentado e `/model`. |
| `gemini.cmd models --help` / `gemini.cmd list-models --help` | Nao existe subcomando shell de modelos; o CLI exibiu help geral. |
| `bun test packages/server/src/agents/stream-process.test.ts packages/server/src/agents/engines/opencode.test.ts` | OK, 58 testes passando. |

## Erros encontrados

1. `gemini` direto no PowerShell pode resolver para `gemini.ps1` e falhar com execution policy.
   - Workaround manual: usar `gemini.cmd`.
   - No app: `Bun.spawn(["gemini", ...])` funcionou fora do sandbox.

2. `-p @arquivo` nao injeta o conteudo do arquivo no Gemini CLI 0.41.1.
   - O CLI recebeu literalmente `@D:/tmp/...`.
   - Isso disparou interpretacao de contexto e tools da extensao Jules.
   - Risco antigo: o engine podia executar uma tarefa diferente da solicitada.
   - Correcao aplicada: usar `stdin` e `-p " "` para headless.

3. O parser antigo emitia mensagens do usuario como stdout.
   - O evento real e `{"type":"message","role":"user","content":"..."}`.
   - Correcao aplicada: somente `role:"assistant"` vira stdout.

4. Capacidade do modelo pode falhar transitoriamente.
   - Houve 429 `MODEL_CAPACITY_EXHAUSTED` em tentativas com modelo automatico e `gemini-2.5-flash`.
   - O CLI fez retry e concluiu alguns testes com sucesso.
   - Isso e risco operacional externo, nao bug do engine.

5. O Gemini CLI carrega contexto/extensoes locais e consome muitos tokens mesmo em prompt curto.
   - Observado input na faixa de 14k a 16k tokens em smoke simples.
   - Tambem houve warning de conflito de skill `react-native-dev`.
   - Isso deve ser monitorado se custo/latencia forem relevantes.

6. `gemini skills list --all` mostrou uma falha nativa apos imprimir a lista.
   - A lista foi emitida antes do erro.
   - Erro observado: assertion `!(handle->flags & UV_HANDLE_CLOSING)` em Windows.
   - Para automacao, preferir `gemini skills list` sem `--all` ou parser tolerante a exit code quando stdout ja contem a lista.

## Skills

Conseguimos obter a lista de skills pelo proprio Gemini CLI:

```powershell
gemini.cmd skills list
gemini.cmd skills list --all
```

Tambem conseguimos injetar/adicionar skills para o Gemini usando os mecanismos oficiais:

- User scope: `~/.gemini/skills/` ou alias `~/.agents/skills/`.
- Workspace scope: `.gemini/skills/` ou alias `.agents/skills/`.
- Link local para desenvolvimento: `gemini skills link <path>`.
- Instalar de repositorio/local package: `gemini skills install <source>`.
- Habilitar/desabilitar: `gemini skills enable <name>` / `gemini skills disable <name>`.

Em sessao interativa, o Gemini usa `/skills list`, `/skills reload`, `/skills enable`,
`/skills disable` e `/skills link`. O modelo ativa uma skill sob demanda via tool
`activate_skill`.

Para injecao no system prompt customizado, a documentacao oficial expõe a variavel
`${AgentSkills}` em `GEMINI_SYSTEM_MD`, que injeta a secao completa de skills
disponiveis no prompt do CLI.

No projeto, ja existe um loader proprio para `~/.agents` em `packages/server/src/skills/loader.ts`.
Se quisermos paridade exata com Gemini CLI, precisamos complementar esse loader com:

- descoberta de `~/.gemini/skills`;
- descoberta de workspace `.gemini/skills` e `.agents/skills`;
- estado enabled/disabled do Gemini CLI, se isso for importante para a UI;
- opcionalmente, um parser de `gemini skills list` como diagnostico do runtime real.

## Modelos

Correcao de entendimento: o Gemini CLI 0.41.1 tem controle nativo de modelos
no modo interativo por slash command, mas nao por subcomando shell.

Slash commands confirmados no repositorio/documentacao nativa:

```text
/model
/model manage
/model set <model-name> [--persist]
```

No codigo nativo instalado, `/model` abre o `ModelDialog`, e `/model set` chama
`config.setModel(modelName, !persist)`. A lista exibida pelo dialog vem das
constantes de `packages/core/src/config/models.ts` e de flags de acesso/preview.

Catalogo nativo extraido do Gemini CLI 0.41.1:

```text
auto-gemini-2.5
auto-gemini-3
auto
pro
flash
flash-lite
gemini-2.5-pro
gemini-2.5-flash
gemini-2.5-flash-lite
gemini-3-pro-preview
gemini-3.1-pro-preview
gemini-3.1-pro-preview-customtools
gemini-3-flash-preview
gemini-3.1-flash-lite-preview
gemma-4-31b-it
gemma-4-26b-a4b-it
```

Observacao importante: o dialog filtra alguns modelos por acesso real
(`hasAccessToPreview`, `hasAccessToProModel`, flags Gemini 3.1/Gemma). Como nao
ha output headless estruturado para esse dialog, a automacao confiavel e manter
um catalogo nativo conhecido e validar disponibilidade no momento da execucao.

O que conseguimos obter do CLI:

- modelo efetivamente usado no evento `init` do `stream-json`, exemplo:
  `{"type":"init","model":"gemini-2.5-flash"}`;
- modelos usados/custo em `result.stats.models`;
- override manual via `-m gemini-2.5-flash`.
- troca interativa direta por `/model set gemini-2.5-flash [--persist]`.

Para listagem na aplicacao, o engine agora deve expor:

- catalogo nativo do Gemini CLI 0.41.1, baseado nas constantes do proprio CLI;
- LiteLLM: `GeminiEngine.listModels()` chama `listLiteLLMModels()` e filtra `gemini/` ou `gemini-`;
- alternativa futura: usar API oficial do Google Generative Language para listar modelos quando houver `GEMINI_API_KEY`;
- fallback estatico: lista curada de modelos conhecidos, usada mesmo quando LiteLLM estiver indisponivel.

## Ajustes aplicados

- Removido arquivo temporario `/tmp/vibe-gemini-prompt-*`.
- Removido uso de `-p @promptFile`.
- Mantido `stdin:"pipe"` para preservar o tipo esperado por `streamProcess`.
- Escrito o prompt em `proc.stdin` e fechado com `proc.stdin.end()`.
- Filtrado evento `message` para emitir stdout apenas quando `role === "assistant"`.

## Validacao de build

`bun install` foi executado porque nao havia `node_modules`.

`bun run typecheck` ainda falha no pacote server por erros pre-existentes de API de tasks
(`db.tasks.getById` / `db.tasks.create` nao existem no tipo atual). A falha especifica
do Gemini introduzida durante o ajuste (`Subprocess<Blob,...>`) foi corrigida; a
reexecucao nao mostrou erro novo em `gemini.ts`.

## Comando recomendado pelo engine

Forma final esperada pelo projeto:

```ts
const args = ["gemini", "--yolo", "--output-format", "stream-json"];
if (model) args.push("-m", model);
if (resumeSessionId) args.push("-r", resumeSessionId);
args.push("-p", " ");

const proc = Bun.spawn(args, {
  cwd: workdir,
  stdout: "pipe",
  stderr: "pipe",
  stdin: "pipe",
  env,
});

proc.stdin.write(prompt);
proc.stdin.end();
```

## Conclusao

Gemini CLI esta manipulavel pelo projeto para execucao headless, streaming, yolo,
modelo customizado, resume, parsing de tools e custo. O ponto que impedia compatibilidade
total era a passagem de prompt por `@arquivo`; isso foi substituido por `stdin`.

## Output e visualizacao React

O output recuperavel do Gemini CLI vem de `--output-format stream-json`, que emite
JSONL no stdout. Cada linha e um evento independente. O projeto ja consome esse
stream em `packages/server/src/agents/engines/gemini.ts`, transforma em `AgentEvent`,
persiste logs e envia WebSocket para `AgentOutput.tsx`.

### Payload real observado

Smoke simples:

```json
{"type":"init","timestamp":"2026-05-06T19:53:25.222Z","session_id":"b437a15b-f072-4f30-a443-b11163a28ff9","model":"gemini-2.5-flash"}
{"type":"message","timestamp":"2026-05-06T19:53:25.223Z","role":"user","content":"Reply with exactly OK.\r\n\n\n "}
{"type":"message","timestamp":"2026-05-06T19:53:28.723Z","role":"assistant","content":"OK","delta":true}
{"type":"result","timestamp":"2026-05-06T19:53:28.743Z","status":"success","stats":{"total_tokens":14242,"input_tokens":14193,"output_tokens":1,"cached":5384,"input":8809,"duration_ms":3521,"tool_calls":0,"models":{"gemini-2.5-flash":{"total_tokens":14242,"input_tokens":14193,"output_tokens":1,"cached":5384,"input":8809}}}}
```

Smoke com tool call:

```json
{"type":"tool_use","timestamp":"2026-05-06T19:52:27.385Z","tool_name":"run_shell_command","tool_id":"run_shell_command_1778097147385_0","parameters":{"description":"Getting the remote origin URL to identify the repository name.","command":"git config --get remote.origin.url"}}
{"type":"tool_result","timestamp":"2026-05-06T19:52:29.182Z","tool_id":"run_shell_command_1778097147385_0","status":"success"}
{"type":"tool_use","timestamp":"2026-05-06T19:52:39.801Z","tool_name":"update_topic","tool_id":"update_topic_1778097159801_0","parameters":{"title":"Awaiting User Task Description for Jules","strategic_intent":"To get the user's task description for the Jules task.","summary":"I have identified the repository name as `juninmd/vibe-code` from the git remote origin URL. To start a Jules task, I need a task description from the user. I will now prompt the user for this information."}}
{"type":"tool_result","timestamp":"2026-05-06T19:52:39.823Z","tool_id":"update_topic_1778097159801_0","status":"success","output":"## Topic: **Awaiting User Task Description for Jules**\n\n**Summary:**\nI have identified the repository name as `juninmd/vibe-code`..."}
```

Erro transitorio observado:

```json
{
  "error": {
    "code": 429,
    "message": "No capacity available for model gemini-2.5-flash on the server",
    "status": "RESOURCE_EXHAUSTED",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "MODEL_CAPACITY_EXHAUSTED",
        "domain": "cloudcode-pa.googleapis.com",
        "metadata": {
          "model": "gemini-2.5-flash"
        }
      }
    ]
  }
}
```

### Interface TypeScript sugerida

Contrato minimo para tipar o retorno do Gemini CLI:

```ts
interface GeminiCliBaseEvent {
  type?: string;
  timestamp?: string;
  session_id?: string;
}

interface GeminiCliInitEvent extends GeminiCliBaseEvent {
  type: "init";
  session_id: string;
  model: string;
}

interface GeminiCliMessageEvent extends GeminiCliBaseEvent {
  type: "message";
  role: "user" | "assistant" | string;
  content: string;
  delta?: boolean;
}

interface GeminiCliToolUseEvent extends GeminiCliBaseEvent {
  type: "tool_use" | "tool_call";
  tool_name?: string;
  name?: string;
  tool_id?: string;
  id?: string;
  parameters?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

interface GeminiCliToolResultEvent extends GeminiCliBaseEvent {
  type: "tool_result" | "tool_result_legacy";
  tool_id?: string;
  call_id?: string;
  status?: "success" | "error" | string;
  output?: unknown;
  result?: unknown;
}

interface GeminiCliResultEvent extends GeminiCliBaseEvent {
  type: "result";
  status: "success" | "error" | string;
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    input?: number;
    duration_ms?: number;
    tool_calls?: number;
    models?: Record<
      string,
      {
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        cached?: number;
        input?: number;
      }
    >;
  };
}

type GeminiCliStreamEvent =
  | GeminiCliInitEvent
  | GeminiCliMessageEvent
  | GeminiCliToolUseEvent
  | GeminiCliToolResultEvent
  | GeminiCliResultEvent
  | (GeminiCliBaseEvent & Record<string, unknown>);
```

### Como recuperar no projeto

Fluxo atual:

```text
Gemini CLI stdout JSONL
  -> streamProcess()
  -> GeminiEngine parseLine()
  -> AgentEvent
  -> handleAgentEvent()
  -> db.logs + WebSocket
  -> AgentOutput.tsx
```

Rotas/canais usados:

- live: WebSocket `agent_logs_batch`, `agent_tool_use`, `agent_tool_result`, `run_updated`;
- historico: `GET /api/runs/:id/logs`;
- custo/modelos: `run.costStats`, atualizado por evento `result.stats`.

### Visualizacao otimizada recomendada

Hoje `AgentOutput.tsx` funciona como terminal/log viewer virtualizado. Para uma
visualizacao otimizada do Gemini CLI, a UI deveria ter dois modos:

1. **Resposta**
   - concatenar apenas eventos `message` com `role: "assistant"`;
   - renderizar Markdown sanitizado;
   - esconder `message role=user` por padrao;
   - mostrar modelo, duracao, tokens e exit code no topo.

2. **Timeline tecnica**
   - `init`: card de inicio com `session_id` e `model`;
   - `message assistant`: bloco de texto/markdown;
   - `tool_use`: card compacto com nome da tool, id e parametros;
   - `tool_result`: card colapsavel com status, output truncado e botao expandir;
   - `result`: card final com total tokens, input/output, cached, tool calls, modelos usados;
   - stderr/erros: card vermelho com mensagem e hint operacional.

Sugestao de shape interno para a UI:

```ts
type GeminiTimelineItem =
  | { kind: "session"; timestamp?: string; sessionId: string; model: string }
  | { kind: "assistant_message"; timestamp?: string; content: string; delta?: boolean }
  | {
      kind: "tool_use";
      timestamp?: string;
      toolId: string;
      toolName: string;
      parameters?: Record<string, unknown>;
    }
  | {
      kind: "tool_result";
      timestamp?: string;
      toolId: string;
      status: "success" | "error";
      output?: string;
    }
  | { kind: "usage"; timestamp?: string; stats: GeminiCliResultEvent["stats"] }
  | { kind: "error"; timestamp?: string; message: string; raw?: unknown };
```

Essa timeline pode coexistir com o log bruto atual: o log bruto continua essencial
para debug, mas a timeline torna a execucao do Gemini inspecionavel sem depender
de leitura linha a linha.
