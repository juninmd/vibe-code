# Codex CLI - compatibilidade com Vibe Code

Data da verificacao: 2026-05-06  
Ambiente testado: Windows PowerShell, `D:\Solutions\pessoal\vibe-code`  
CLI instalado: `codex-cli 0.128.0`

## Resultado

Codex CLI esta compativel com o projeto usando o modo nao interativo atual:

```powershell
codex --ask-for-approval never exec --json --sandbox workspace-write --skip-git-repo-check -
```

O engine do projeto foi ajustado para:

- usar `codex exec --json` em vez do caminho antigo `codex acp`;
- enviar prompt por stdin com o argumento final `-`;
- recuperar stdout como JSONL estruturado;
- mapear `agent_message`, `command_execution`, `thread.started` e `turn.completed` para `AgentEvent`;
- listar modelos via `codex debug models`, com fallback para catalogo nativo;
- suportar retomada com `codex exec resume --json <SESSION_ID> -`.
- expor o contrato inicial em `packages/server/src/agents/engines/codex-types.ts`.
- injetar skills selecionadas pelo Vibe Code como skills nativas repo-local em `.agents/skills/*/SKILL.md`.

## Fontes oficiais consultadas

- OpenAI Codex CLI: https://developers.openai.com/codex/cli
- Modo nao interativo: https://developers.openai.com/codex/noninteractive
- Repositorio nativo: https://github.com/openai/codex

Pontos oficiais relevantes:

- A documentacao descreve o Codex CLI como agente local que pode ler, alterar e executar codigo no diretorio selecionado.
- O caminho de automacao recomendado e `codex exec`.
- Para automacao/CI, a documentacao cita `CODEX_API_KEY` com `codex exec`.
- O modo nao interativo suporta `--json`, `--output-last-message` e `--output-schema`.

## Erros encontrados

### 1. `codex acp` nao e comando valido neste CLI

O engine anterior chamava:

```powershell
codex acp --message @prompt.txt
```

No CLI `0.128.0`, `codex acp --help` nao mostrou subcomando ACP real; retornou o help geral. Isso torna o engine antigo fragil/incompativel.

Correcao aplicada: usar `codex exec --json`.

### 2. `--ask-for-approval` precisa vir antes de `exec`

Falhou:

```powershell
codex exec --json --sandbox read-only --ask-for-approval never -
```

Erro:

```text
unexpected argument '--ask-for-approval'
```

Funcionou:

```powershell
codex --ask-for-approval never exec --json --sandbox read-only -
```

### 3. Prompt precisa chegar por stdin quando usamos `-`

Falhou sem pipe/stdin:

```powershell
codex --ask-for-approval never exec --json --sandbox read-only --ephemeral --skip-git-repo-check -
```

Erro:

```text
No prompt provided via stdin.
```

Funcionou:

```powershell
"Reply with exactly OK." | codex --ask-for-approval never exec --json --sandbox read-only --ephemeral --skip-git-repo-check -
```

No engine, a correcao foi escrever `prompt` em `proc.stdin` e fechar o stream.

### 4. Windows PowerShell em sandbox read-only gerou ruido de encoding

Smoke com comando read-only:

```powershell
"Run a read-only command to print the current working directory, then respond with exactly DONE." |
  codex --ask-for-approval never exec --json --sandbox read-only --ephemeral --skip-git-repo-check -
```

O comando funcionou, mas o output incluiu aviso de constrained language ao tentar setar encoding do console. O `exit_code` ainda foi `0`. A UI deve tratar tool output como payload bruto e nao assumir texto limpo.

## Acertos confirmados

### Versao e disponibilidade

```powershell
codex --version
```

Resultado:

```text
codex-cli 0.128.0
```

### Listagem de modelos

Comando nativo:

```powershell
codex debug models
```

Modelos retornados no smoke:

```text
gpt-5.5 | GPT-5.5 | medium
gpt-5.4 | gpt-5.4 | medium
gpt-5.4-mini | GPT-5.4-Mini | medium
gpt-5.3-codex | gpt-5.3-codex | medium
gpt-5.2 | gpt-5.2 | medium
codex-auto-review | Codex Auto Review | medium
```

Conclusao: conseguimos listar modelos de forma programatica com `codex debug models`. A UI pode expor esses modelos diretamente. Em sessao interativa, o usuario tambem consegue alternar modelos via `/model`, mas para nosso projeto o caminho controlavel e `debug models` + `--model`.

### Sessao e resume

Help nativo confirmado:

```powershell
codex exec resume --help
```

Formato suportado:

```text
codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
```

Para o projeto:

```powershell
codex --ask-for-approval never exec resume --json --sandbox workspace-write --skip-git-repo-check <SESSION_ID> -
```

### Output final simples

Comando:

```powershell
"Reply with exactly OK." | codex --ask-for-approval never exec --json --sandbox read-only --ephemeral --skip-git-repo-check -
```

Payload real:

```jsonl
{"type":"thread.started","thread_id":"019dff1d-59af-7f22-b3cc-d37dedb4e75d"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":24003,"cached_input_tokens":19840,"output_tokens":5,"reasoning_output_tokens":0}}
```

### Output com tool call

Comando:

```powershell
"Run a read-only command to print the current working directory, then respond with exactly DONE." |
  codex --ask-for-approval never exec --json --sandbox read-only --ephemeral --skip-git-repo-check -
```

Payload real:

```jsonl
{"type":"thread.started","thread_id":"019dff1d-a1db-78a1-a300-e9a6a7d1c60c"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"\"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command Get-Location","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"\"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command Get-Location","aggregated_output":"\r\nPath                          \r\n----                          \r\nD:\\Solutions\\pessoal\\vibe-code\r\n\r\n\r\nNao foi possivel definir a propriedade...\r\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"DONE"}}
{"type":"turn.completed","usage":{"input_tokens":48211,"cached_input_tokens":43776,"output_tokens":45,"reasoning_output_tokens":0}}
```

## Interface TypeScript recomendada

Contrato compartilhado em `packages/shared/src/types.ts` para consumir `codex exec --json`:

```ts
export interface CodexThreadStartedEvent {
  type: "thread.started";
  thread_id: string;
}

export interface CodexTurnStartedEvent {
  type: "turn.started";
}

export interface CodexItemStartedEvent {
  type: "item.started";
  item: CodexItem;
}

export interface CodexItemCompletedEvent {
  type: "item.completed";
  item: CodexItem;
}

export interface CodexTurnCompletedEvent {
  type: "turn.completed";
  usage: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
}

export interface CodexErrorEvent {
  type: string;
  error?: string | { message?: string };
  message?: string;
}

export type CodexItem =
  | {
      id?: string;
      type: "agent_message";
      text?: string;
    }
  | {
      id?: string;
      type: "command_execution" | "commandExecution";
      command?: string;
      aggregated_output?: string;
      output?: string;
      exit_code?: number | null;
      status: "in_progress" | "completed" | "failed" | string;
    }
  | {
      id: string;
      type: string;
      [key: string]: unknown;
    };

export type CodexExecEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexItemStartedEvent
  | CodexItemCompletedEvent
  | CodexTurnCompletedEvent
  | CodexErrorEvent;
```

Mapeamento para `AgentEvent` do projeto:

```ts
function toTimelineEvent(event: CodexExecEvent) {
  if (event.type === "thread.started") {
    return { kind: "session", threadId: event.thread_id };
  }

  if (event.type === "item.started" && event.item.type === "command_execution") {
    return {
      kind: "tool_use",
      id: event.item.id,
      toolName: "exec_command",
      command: event.item.command,
    };
  }

  if (event.type === "item.completed" && event.item.type === "command_execution") {
    return {
      kind: "tool_result",
      id: event.item.id,
      output: event.item.aggregated_output,
      status: event.item.exit_code === 0 ? "success" : "error",
    };
  }

  if (event.type === "item.completed" && event.item.type === "agent_message") {
    return { kind: "message", role: "assistant", text: event.item.text };
  }

  if (event.type === "turn.completed") {
    return { kind: "usage", usage: event.usage };
  }

  return { kind: "raw", event };
}
```

Tipos para renderizacao:

```ts
export type CodexTimelineEvent =
  | { kind: "session"; threadId: string; raw: CodexThreadStartedEvent }
  | { kind: "status"; status: "running" | "completed" | "failed"; raw: CodexExecEvent }
  | { kind: "message"; id: string; role: "assistant"; text: string; raw: CodexItemCompletedEvent }
  | {
      kind: "tool_use";
      id: string;
      toolName: "exec_command" | "patch_apply" | string;
      command?: string;
      raw: CodexItemStartedEvent;
    }
  | {
      kind: "tool_result";
      id: string;
      output: string;
      status: "success" | "error";
      exitCode?: number | null;
      raw: CodexItemCompletedEvent;
    }
  | {
      kind: "usage";
      inputTokens: number;
      cachedInputTokens?: number;
      outputTokens: number;
      reasoningOutputTokens?: number;
      totalTokens: number;
      raw: CodexTurnCompletedEvent;
    }
  | { kind: "raw"; raw: CodexExecEvent };

export interface CodexRunViewModel {
  runId: string;
  engine: "codex";
  model?: string;
  threadId?: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  status: "starting" | "running" | "completed" | "failed";
  messages: Array<{ id: string; role: "assistant"; text: string }>;
  tools: Array<{
    id: string;
    name: "exec_command" | "patch_apply" | string;
    command?: string;
    output?: string;
    status: "in_progress" | "success" | "error";
    exitCode?: number | null;
  }>;
  usage?: {
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
    reasoningOutputTokens?: number;
    totalTokens: number;
  };
  timeline: CodexTimelineEvent[];
  rawEvents: CodexExecEvent[];
}
```

Exemplo de reducer para o frontend:

```ts
import { applyCodexEvent, createCodexRunViewModel } from "@vibe-code/shared";
import type { CodexExecEvent } from "@vibe-code/shared";

let view = createCodexRunViewModel("codex-smoke", {
  model: "gpt-5.4-mini",
  sandbox: "workspace-write",
});

for (const event of jsonlEvents as CodexExecEvent[]) {
  view = applyCodexEvent(view, event);
}
```

Helper implementado em `packages/shared/src/codex.ts`:

- `createCodexRunViewModel(runId, options)`
- `codexEventToTimelineEvent(event)`
- `applyCodexEvent(state, event)`

## Visualizacao React recomendada

A UI nao deve renderizar apenas um terminal bruto. O `--json` permite uma visualizacao otimizada:

- Header do run: engine, modelo, `thread_id`, sandbox, estado atual.
- Timeline: mensagens do agente, inicio/fim de comandos, diffs/patches, erros.
- Painel de tool call: comando executado, saida, exit code, duracao se disponivel.
- Painel de custo: `input_tokens`, `cached_input_tokens`, `output_tokens`, total estimado.
- Aba "Raw JSONL": payload original para debug/replay.
- Indicador de retomada: guardar `thread_id` e expor acao de resume.

Exemplo de estado normalizado para React:

```ts
export interface CodexRunViewModel {
  runId: string;
  engine: "codex";
  model?: string;
  threadId?: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  status: "starting" | "running" | "completed" | "failed";
  messages: Array<{
    id: string;
    role: "assistant" | "system";
    text: string;
  }>;
  tools: Array<{
    id: string;
    name: "exec_command" | "patch_apply" | string;
    command?: string;
    output?: string;
    status: "in_progress" | "success" | "error";
  }>;
  usage?: {
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
    totalTokens: number;
  };
  rawEvents: CodexExecEvent[];
}
```

Payload real transformado:

```json
{
  "runId": "codex-smoke",
  "engine": "codex",
  "model": "gpt-5.4-mini",
  "threadId": "019dff1f-2b18-71c1-996a-5869fa99454b",
  "sandbox": "workspace-write",
  "status": "completed",
  "messages": [
    {
      "id": "item_0",
      "role": "assistant",
      "text": "OK"
    }
  ],
  "tools": [],
  "usage": {
    "inputTokens": 22321,
    "cachedInputTokens": 17792,
    "outputTokens": 29,
    "totalTokens": 22350
  }
}
```

## Skills e controle de contexto

Codex possui suporte documentado a Skills e Plugins no ecossistema do CLI. Para controle total dentro do nosso projeto, o caminho pragmatico e:

- continuar injetando contexto selecionado pelo Vibe Code no prompt principal;
- gerar skills nativas repo-local em `.agents/skills`, no formato `SKILL.md`;
- guardar no banco quais skills foram anexadas a cada run;
- mostrar na UI a lista de skills injetadas, separada da lista de skills nativas do usuario local.

Implementado no `CodexEngine.prepareWorkdir`:

```text
.agents/
  skills/
    vibe-code-rule-<nome>/
      SKILL.md
    vibe-code-skill-<nome>/
      SKILL.md
    vibe-code-agent-<nome>/
      SKILL.md
    vibe-code-workflow-<nome>/
      SKILL.md
```

Cada `SKILL.md` gerado contem:

```yaml
---
name: vibe-code-skill-exemplo
description: |-
  Vibe Code selected skill: descricao da skill...
---
```

O executor ja registra esses arquivos em `createdContextFiles`, adiciona cada caminho ao `.git/info/exclude` e remove os arquivos no cleanup do run.

Ainda nao foi confirmado um comando CLI estavel do tipo `codex skills list`. Portanto, para listagem confiavel no nosso produto, a fonte da verdade continua sendo o catalogo de skills do Vibe Code e o `matchedSkillNames` persistido no run.

## Autenticacao e LiteLLM

Para execucoes nativas:

- Codex pode usar login local do CLI.
- Para automacao, usar `CODEX_API_KEY`.
- O engine tambem injeta `OPENAI_API_KEY` por compatibilidade.

Para LiteLLM:

- LiteLLM nao deve ser default. Ele so pode ser usado quando a configuracao `litellm_enabled` estiver explicitamente `true`.
- Sem essa configuracao ativa, o Codex roda com credenciais nativas do CLI/OpenAI.
- O engine injeta `CODEX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` e `OPENAI_API_BASE`.
- Ainda precisa smoke dedicado com um proxy LiteLLM real ativo para confirmar se o Codex CLI respeita base URL customizada nesta versao.

Alteracao aplicada no projeto:

```ts
const litellmEnabled = db.settings.get("litellm_enabled") === "true";
```

Isso evita o comportamento anterior de tratar ausencia de configuracao como LiteLLM ligado.

## Smoke tests realizados

Passou:

```powershell
codex --version
codex --help
codex exec --help
codex exec resume --help
codex debug models
"Reply with exactly OK." | codex --ask-for-approval never exec --json --sandbox read-only --ephemeral --skip-git-repo-check -
```

Passou pelo engine do projeto:

```text
CodexEngine.execute("Reply with exactly OK.", cwd, { runId: "codex-smoke", model: "gpt-5.4-mini" })
```

Eventos normalizados:

```json
[
  { "type": "log", "stream": "system", "content": "[codex] Starting in D:\\Solutions\\pessoal\\vibe-code" },
  { "type": "log", "stream": "system", "content": "[codex] Run context: model=gpt-5.4-mini, runId=codex-smoke" },
  { "type": "log", "stream": "system", "content": "[codex] Process started with native Codex credentials" },
  { "type": "log", "stream": "system", "content": "[codex] Thread 019dff1f-2b18-71c1-996a-5869fa99454b" },
  { "type": "status", "content": "Codex session started" },
  { "type": "status", "content": "Codex running" },
  { "type": "log", "stream": "stdout", "content": "OK" },
  { "type": "status", "content": "Codex completed" },
  {
    "type": "cost",
    "costStats": {
      "total_tokens": 22350,
      "input_tokens": 22321,
      "output_tokens": 29,
      "cached": 17792
    }
  },
  { "type": "complete", "exitCode": 0 }
]
```

## Decisao de seguranca

Para o projeto, o default recomendado e:

```powershell
--sandbox workspace-write --ask-for-approval never
```

Isso permite ler, escrever e executar dentro do workspace, sem prompt interativo, mantendo limite de escopo. O flag `--dangerously-bypass-approvals-and-sandbox` existe, mas deve ficar reservado para ambientes externamente isolados, porque remove as barreiras do Codex.

## Pendencias

- Confirmar LiteLLM com proxy real ativo.
- Capturar payload real de `file_change`/patch quando um smoke de escrita for desejado.
- Se precisarmos listar skills nativas do Codex, aguardar/confirmar comando oficial estavel; hoje o controle confiavel e pelo catalogo de skills do Vibe Code.
