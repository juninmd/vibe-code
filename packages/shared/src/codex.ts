import type {
  CodexExecEvent,
  CodexRunViewModel,
  CodexTimelineEvent,
  CodexTurnCompletedEvent,
} from "./types";

export function createCodexRunViewModel(
  runId: string,
  options: {
    model?: string;
    sandbox?: CodexRunViewModel["sandbox"];
  } = {}
): CodexRunViewModel {
  return {
    runId,
    engine: "codex",
    model: options.model,
    sandbox: options.sandbox ?? "workspace-write",
    status: "starting",
    messages: [],
    tools: [],
    timeline: [],
    rawEvents: [],
  };
}

function usageTimelineEvent(
  event: CodexTurnCompletedEvent
): Extract<CodexTimelineEvent, { kind: "usage" }> {
  const inputTokens = event.usage.input_tokens ?? 0;
  const outputTokens = event.usage.output_tokens ?? 0;
  return {
    kind: "usage",
    inputTokens,
    cachedInputTokens: event.usage.cached_input_tokens,
    outputTokens,
    reasoningOutputTokens: event.usage.reasoning_output_tokens,
    totalTokens: inputTokens + outputTokens,
    raw: event,
  };
}

export function codexEventToTimelineEvent(event: CodexExecEvent): CodexTimelineEvent {
  if (event.type === "thread.started") {
    return { kind: "session", threadId: event.thread_id, raw: event };
  }

  if (event.type === "turn.started") {
    return { kind: "status", status: "running", raw: event };
  }

  if (event.type === "turn.completed") {
    return usageTimelineEvent(event);
  }

  if (event.type === "error" || event.type === "turn.error" || event.type === "turn.failed") {
    return { kind: "status", status: "failed", raw: event };
  }

  if (event.type === "item.started") {
    const id = event.item.id ?? "";
    if (event.item.type === "command_execution" || event.item.type === "commandExecution") {
      const command = typeof event.item.command === "string" ? event.item.command : undefined;
      return {
        kind: "tool_use",
        id,
        toolName: "exec_command",
        command,
        raw: event,
      };
    }
    if (event.item.type === "file_change" || event.item.type === "fileChange") {
      return { kind: "tool_use", id, toolName: "patch_apply", raw: event };
    }
  }

  if (event.type === "item.completed") {
    const id = event.item.id ?? "";
    if (event.item.type === "agent_message") {
      const text = typeof event.item.text === "string" ? event.item.text : "";
      return {
        kind: "message",
        id,
        role: "assistant",
        text,
        raw: event,
      };
    }
    if (event.item.type === "command_execution" || event.item.type === "commandExecution") {
      const output =
        typeof event.item.aggregated_output === "string"
          ? event.item.aggregated_output
          : typeof event.item.output === "string"
            ? event.item.output
            : "";
      const exitCode = typeof event.item.exit_code === "number" ? event.item.exit_code : null;
      return {
        kind: "tool_result",
        id,
        output,
        status: exitCode === 0 ? "success" : "error",
        exitCode,
        raw: event,
      };
    }
    if (event.item.type === "file_change" || event.item.type === "fileChange") {
      return { kind: "tool_result", id, output: "", status: "success", raw: event };
    }
  }

  return { kind: "raw", raw: event };
}

export function applyCodexEvent(
  state: CodexRunViewModel,
  event: CodexExecEvent
): CodexRunViewModel {
  const timelineEvent = codexEventToTimelineEvent(event);
  const next: CodexRunViewModel = {
    ...state,
    rawEvents: [...state.rawEvents, event],
    timeline: [...state.timeline, timelineEvent],
  };

  if (timelineEvent.kind === "session") {
    return { ...next, threadId: timelineEvent.threadId, status: "running" };
  }

  if (timelineEvent.kind === "status") {
    return { ...next, status: timelineEvent.status };
  }

  if (timelineEvent.kind === "message") {
    return {
      ...next,
      messages: [
        ...state.messages,
        { id: timelineEvent.id, role: timelineEvent.role, text: timelineEvent.text },
      ],
    };
  }

  if (timelineEvent.kind === "tool_use") {
    return {
      ...next,
      tools: [
        ...state.tools,
        {
          id: timelineEvent.id,
          name: timelineEvent.toolName,
          command: timelineEvent.command,
          status: "in_progress",
        },
      ],
    };
  }

  if (timelineEvent.kind === "tool_result") {
    const existing = state.tools.some((tool) => tool.id === timelineEvent.id);
    const updatedTools = existing
      ? state.tools.map((tool) =>
          tool.id === timelineEvent.id
            ? {
                ...tool,
                output: timelineEvent.output,
                status: timelineEvent.status,
                exitCode: timelineEvent.exitCode,
              }
            : tool
        )
      : [
          ...state.tools,
          {
            id: timelineEvent.id,
            name: "exec_command",
            output: timelineEvent.output,
            status: timelineEvent.status,
            exitCode: timelineEvent.exitCode,
          },
        ];

    return { ...next, tools: updatedTools };
  }

  if (timelineEvent.kind === "usage") {
    return {
      ...next,
      status: "completed",
      usage: {
        inputTokens: timelineEvent.inputTokens,
        cachedInputTokens: timelineEvent.cachedInputTokens,
        outputTokens: timelineEvent.outputTokens,
        reasoningOutputTokens: timelineEvent.reasoningOutputTokens,
        totalTokens: timelineEvent.totalTokens,
      },
    };
  }

  return next;
}
