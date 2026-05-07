# Claude Code

Data da validacao: 2026-05-06

Versao testada:

```bash
claude --version
```

Resultado:

```text
2.1.131 (Claude Code)
```

Fontes oficiais consultadas:

- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/agent-sdk/skills

## Resumo executivo

O Claude Code CLI e compativel com o projeto, desde que o engine trate o CLI como um processo `stream-json` e normalize os eventos para o frontend. O caminho principal para automacao e `claude -p` / `claude --print`.

O Claude Code nao possui um comando nativo equivalente a `models list` ou `/models` para enumerar todos os modelos disponiveis. A selecao de modelo e feita por `--model`, e a listagem deve ser mantida pelo projeto como catalogo nativo curado.

LiteLLM nao deve ser forçado por padrao. Deve ser ativado somente por configuracao, quando o executor fornecer chave/base LiteLLM.

## Comandos relevantes

Ajuda geral:

```bash
claude --help
```

Ajuda do modo print/headless:

```bash
claude -p --help
```

Execucao nao interativa com output estruturado:

```bash
claude -p "Reply with exactly OK." --output-format stream-json --verbose --no-session-persistence
```

Execucao com selecao de modelo:

```bash
claude -p "Reply with exactly OK." --model sonnet --output-format stream-json --verbose --no-session-persistence
```

Execucao com permissao segura para smoke tests:

```bash
claude -p "Reply with exactly OK." --output-format stream-json --verbose --no-session-persistence --permission-mode dontAsk
```

## Modelos

O help do Claude Code indica suporte a aliases como `sonnet` e `opus`, alem de nomes completos de modelo. No smoke test, o evento `system.init` retornou `model: "claude-sonnet-4-6"`.

Catalogo nativo recomendado para `listModels()`:

```ts
export const NATIVE_CLAUDE_CODE_MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];
```

Selecao:

```bash
claude -p "..." --model sonnet
```

Importante: nao buscar modelos via LiteLLM por padrao. A listagem nativa deve funcionar sem proxy.

## Skills

O Claude Code possui suporte nativo a skills em:

```text
.claude/skills/<skill-name>/SKILL.md
```

Para o projeto, o melhor fluxo e gerar dois artefatos por run:

```text
.claude/VIBE_CODE_SKILLS.md
.claude/skills/vibe-code-*/SKILL.md
```

O arquivo `VIBE_CODE_SKILLS.md` funciona como resumo legivel e ponte para o prompt. Os arquivos em `.claude/skills` permitem que o Claude Code reconheca skills no formato nativo.

Prompt adicional recomendado:

```bash
--append-system-prompt "Vibe Code selected skills are available at .claude/VIBE_CODE_SKILLS.md. Read and follow them when relevant."
```

Formato recomendado para skill gerada:

```md
---
name: vibe-code-skill-test-skill
description: |-
  Vibe Code selected skill: Smoke skill Use when this task matches the selected Vibe Code context for the current run.
---

# test-skill

Category: skill

These instructions were selected by Vibe Code for this run. Follow them when they apply to the task, repository, or validation flow.

Use this skill only for smoke testing.
```

## Output real

### Evento system/init

Payload observado no smoke:

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "example-session-id",
  "tools": ["Task", "Bash", "Glob", "Grep", "Read", "Edit", "Write"],
  "model": "claude-sonnet-4-6",
  "permissionMode": "default",
  "claude_code_version": "2.1.131",
  "agents": ["general-purpose", "statusline-setup", "output-style-setup"],
  "skills": [],
  "plugins": []
}
```

Uso no frontend:

- mostrar status de sessao;
- mostrar modelo efetivo;
- expor ferramentas disponiveis;
- registrar `session_id` para retomada se aplicavel.

### Evento assistant/text

Payload observado:

```json
{
  "type": "assistant",
  "message": {
    "content": [
      {
        "type": "text",
        "text": "OK."
      }
    ]
  }
}
```

Erro corrigido: o parser nao deve ler `parsed.content`. O texto real fica em `parsed.message.content[]`.

### Evento assistant/tool_use

Payload observado em smoke read-only com `pwd`:

```json
{
  "type": "assistant",
  "message": {
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_example",
        "name": "Bash",
        "input": {
          "command": "pwd",
          "description": "Print current working directory"
        }
      }
    ]
  }
}
```

Uso no frontend:

- renderizar como card de tool call;
- mostrar nome da tool;
- mostrar parametros formatados;
- conectar com `tool_result` por `tool_use_id`.

### Evento user/tool_result

Payload observado:

```json
{
  "type": "user",
  "message": {
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_example",
        "content": "/d/Solutions/pessoal/vibe-code",
        "is_error": false
      }
    ]
  },
  "tool_use_result": {
    "stdout": "/d/Solutions/pessoal/vibe-code",
    "stderr": "",
    "interrupted": false,
    "isImage": false
  }
}
```

Uso no frontend:

- anexar resultado ao card da tool;
- destacar `stderr` quando existir;
- marcar erro quando `is_error === true`.

### Evento result

Payload observado:

```json
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 2912,
  "duration_api_ms": 2460,
  "is_error": false,
  "result": "OK.",
  "total_cost_usd": 0.0031,
  "usage": {
    "input_tokens": 3,
    "output_tokens": 4,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 3,
      "outputTokens": 4,
      "cacheCreationInputTokens": 0,
      "cacheReadInputTokens": 0
    }
  }
}
```

Uso no frontend:

- mostrar duracao;
- mostrar custo;
- mostrar tokens por modelo;
- marcar run como concluida quando `subtype === "success"`;
- marcar erro quando `is_error === true`.

## Tipagem TypeScript

Tipos recomendados em `@vibe-code/shared`:

```ts
export type ClaudeCodeExecEvent =
  | ClaudeCodeSystemInitEvent
  | ClaudeCodeAssistantEvent
  | ClaudeCodeUserToolResultEvent
  | ClaudeCodeResultEvent
  | ClaudeCodeRateLimitEvent
  | ClaudeCodeErrorEvent;

export interface ClaudeCodeRunViewModel {
  sessionId: string | null;
  model: string | null;
  permissionMode: string | null;
  version: string | null;
  status: "idle" | "running" | "completed" | "failed";
  timeline: ClaudeCodeTimelineEvent[];
  usage: ClaudeCodeResultEvent["usage"] | null;
  modelUsage: ClaudeCodeResultEvent["modelUsage"] | null;
  totalCostUsd: number | null;
  durationMs: number | null;
  finalText: string | null;
  error: string | null;
}
```

Helper recomendado:

```ts
import {
  applyClaudeCodeEvent,
  createClaudeCodeRunViewModel,
  type ClaudeCodeExecEvent,
} from "@vibe-code/shared";

let view = createClaudeCodeRunViewModel();

function onClaudeJsonLine(line: string) {
  const event = JSON.parse(line) as ClaudeCodeExecEvent;
  view = applyClaudeCodeEvent(view, event);
  render(view);
}
```

Renderizacao sugerida:

```tsx
function ClaudeCodeTimeline({ view }: { view: ClaudeCodeRunViewModel }) {
  return (
    <div>
      <header>
        <span>{view.status}</span>
        <span>{view.model}</span>
        <span>{view.totalCostUsd}</span>
      </header>

      {view.timeline.map((item) => {
        if (item.kind === "assistant_text") {
          return <AssistantMessage key={item.id} text={item.text} />;
        }

        if (item.kind === "tool_use") {
          return (
            <ToolCall
              key={item.id}
              name={item.name}
              input={item.input}
              result={item.result}
            />
          );
        }

        if (item.kind === "tool_result") {
          return <ToolResult key={item.id} output={item.output} error={item.isError} />;
        }

        return <SystemEvent key={item.id} event={item} />;
      })}
    </div>
  );
}
```

## Normalizacao para AgentEvent

Mapeamento recomendado no engine:

```ts
if (event.type === "system" && event.subtype === "init") {
  emit({
    type: "status",
    content: "Claude Code session started",
  });
}

if (event.type === "assistant") {
  for (const block of event.message.content ?? []) {
    if (block.type === "text") {
      emit({ type: "log", stream: "stdout", content: block.text });
    }

    if (block.type === "tool_use") {
      emit({
        type: "tool_use",
        toolUse: {
          toolId: block.id,
          toolName: block.name,
          parameters: block.input,
        },
      });
    }
  }
}

if (event.type === "user") {
  const result = event.message.content?.find((block) => block.type === "tool_result");
  if (result) {
    emit({
      type: "tool_result",
      toolResult: {
        toolId: result.tool_use_id,
        output: event.tool_use_result?.stdout ?? result.content ?? "",
        status: result.is_error ? "error" : "success",
      },
    });
  }
}
```

## Smoke tests realizados

### Versao

```bash
claude --version
```

Resultado:

```text
2.1.131 (Claude Code)
```

### Smoke simples

```bash
claude -p "Reply with exactly OK." --output-format stream-json --verbose --no-session-persistence
```

Resultado esperado:

- evento `system.init`;
- evento `assistant` com texto `OK.`;
- evento `result` com `subtype: "success"`.

### Smoke read-only com tool

```bash
claude -p "Run a read-only command to print the current working directory, then reply exactly DONE." --output-format stream-json --verbose --no-session-persistence --permission-mode dontAsk
```

Resultado esperado:

- evento `assistant` com `tool_use` da tool `Bash`;
- evento `user` com `tool_result`;
- evento final `assistant` com `DONE`;
- evento `result` com custo, duracao e tokens.

### Smoke de skills no projeto

O `prepareWorkdir()` deve criar:

```text
.claude/VIBE_CODE_SKILLS.md
.claude/skills/vibe-code-skill-test-skill/SKILL.md
```

Resultado validado localmente: os dois arquivos foram criados com conteudo correto.

## Erros encontrados

1. Parser antigo lia o shape errado.

   Errado:

   ```ts
   parsed.content
   ```

   Certo:

   ```ts
   parsed.message.content
   ```

2. Engine antigo duplicava `-p`.

   O comando deve usar um unico modo `claude -p`.

3. `listModels()` dependia de LiteLLM.

   Isso nao serve para controle nativo. O projeto deve listar modelos Claude Code por catalogo interno e ativar LiteLLM somente por configuracao.

4. Prompt via stdin nao ficou confirmado.

   A execucao com prompt como argumento de `claude -p "..."` foi o caminho confirmado. Para prompts grandes, vale validar uma estrategia separada com `--input-format text` antes de trocar o engine.

## Configuracao LiteLLM

Nao ativar por padrao.

Ativar somente quando:

```ts
settings.litellm_enabled === "true"
```

E quando o executor fornecer:

```ts
options.litellmKey
options.litellmBaseUrl
```

Variaveis de ambiente somente nesse caso:

```ts
ANTHROPIC_BASE_URL=<litellmBaseUrl>
ANTHROPIC_API_KEY=<litellmKey>
```

Sem LiteLLM, usar credenciais nativas do Claude Code ou `ANTHROPIC_API_KEY` nativa configurada.

## Decisao de integracao

Para controle total do Claude Code no Vibe Code:

1. Usar `claude -p` com `--output-format stream-json --verbose`.
2. Parsear JSONL evento a evento.
3. Normalizar para `AgentEvent` no servidor.
4. Exportar tipos e reducers em `@vibe-code/shared`.
5. Renderizar no frontend por timeline tipada.
6. Gerar skills nativas em `.claude/skills`.
7. Manter `listModels()` nativo sem depender de LiteLLM.
8. Ativar LiteLLM somente por configuracao explicita.

