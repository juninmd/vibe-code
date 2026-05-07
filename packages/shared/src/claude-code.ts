import type {
  ClaudeCodeAssistantEvent,
  ClaudeCodeExecEvent,
  ClaudeCodeResultEvent,
  ClaudeCodeRunViewModel,
  ClaudeCodeTimelineEvent,
} from "./types";

export function createClaudeCodeRunViewModel(
  runId: string,
  options: { model?: string; permissionMode?: string } = {}
): ClaudeCodeRunViewModel {
  return {
    runId,
    engine: "claude-code",
    model: options.model,
    permissionMode: options.permissionMode ?? "dontAsk",
    status: "starting",
    messages: [],
    tools: [],
    timeline: [],
    rawEvents: [],
  };
}

function resultUsageEvent(
  event: ClaudeCodeResultEvent
): Extract<ClaudeCodeTimelineEvent, { kind: "usage" }> {
  const inputTokens = event.usage?.input_tokens ?? 0;
  const outputTokens = event.usage?.output_tokens ?? 0;
  const cacheCreationInputTokens = event.usage?.cache_creation_input_tokens;
  const cacheReadInputTokens = event.usage?.cache_read_input_tokens;
  return {
    kind: "usage",
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    totalTokens:
      inputTokens + outputTokens + (cacheCreationInputTokens ?? 0) + (cacheReadInputTokens ?? 0),
    totalCostUsd: event.total_cost_usd,
    durationMs: event.duration_ms,
    raw: event,
  };
}

function assistantBlocks(event: ClaudeCodeAssistantEvent): ClaudeCodeTimelineEvent[] {
  const events: ClaudeCodeTimelineEvent[] = [];
  for (const block of event.message.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      events.push({
        kind: "message",
        id: event.message.id ?? event.uuid ?? "",
        role: "assistant",
        text: block.text,
        raw: event,
      });
    } else if (
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string"
    ) {
      events.push({
        kind: "tool_use",
        id: block.id,
        toolName: block.name,
        input:
          block.input && typeof block.input === "object"
            ? (block.input as Record<string, unknown>)
            : undefined,
        raw: event,
      });
    }
  }
  return events.length > 0 ? events : [{ kind: "raw", raw: event }];
}

export function claudeCodeEventToTimelineEvents(
  event: ClaudeCodeExecEvent
): ClaudeCodeTimelineEvent[] {
  if (event.type === "system" && event.subtype === "init") {
    return [{ kind: "session", sessionId: event.session_id, model: event.model, raw: event }];
  }

  if (event.type === "assistant") {
    return assistantBlocks(event);
  }

  if (event.type === "user") {
    const result = event.message.content?.find((block) => block.type === "tool_result");
    if (result) {
      const stdout = event.tool_use_result?.stdout ?? "";
      const stderr = event.tool_use_result?.stderr ?? "";
      const output = [stdout, stderr].filter(Boolean).join(stderr ? "\n" : "");
      return [
        {
          kind: "tool_result",
          id: result.tool_use_id,
          output: output || result.content || "",
          status: result.is_error ? "error" : "success",
          raw: event,
        },
      ];
    }
  }

  if (event.type === "result") {
    return [
      resultUsageEvent(event),
      { kind: "status", status: event.is_error ? "failed" : "completed", raw: event },
    ];
  }

  if (event.type === "rate_limit_event") {
    return [
      {
        kind: "rate_limit",
        utilization: event.rate_limit_info?.utilization,
        status: event.rate_limit_info?.status,
        raw: event,
      },
    ];
  }

  if (event.type === "error") {
    return [{ kind: "status", status: "failed", raw: event }];
  }

  return [{ kind: "raw", raw: event }];
}

export function applyClaudeCodeEvent(
  state: ClaudeCodeRunViewModel,
  event: ClaudeCodeExecEvent
): ClaudeCodeRunViewModel {
  const timelineEvents = claudeCodeEventToTimelineEvents(event);
  let next: ClaudeCodeRunViewModel = {
    ...state,
    rawEvents: [...state.rawEvents, event],
    timeline: [...state.timeline, ...timelineEvents],
  };

  for (const timelineEvent of timelineEvents) {
    if (timelineEvent.kind === "session") {
      next = {
        ...next,
        sessionId: timelineEvent.sessionId,
        model: timelineEvent.model ?? next.model,
        status: "running",
      };
    } else if (timelineEvent.kind === "message") {
      next = {
        ...next,
        messages: [
          ...next.messages,
          { id: timelineEvent.id, role: timelineEvent.role, text: timelineEvent.text },
        ],
      };
    } else if (timelineEvent.kind === "tool_use") {
      next = {
        ...next,
        tools: [
          ...next.tools,
          {
            id: timelineEvent.id,
            name: timelineEvent.toolName,
            input: timelineEvent.input,
            status: "in_progress",
          },
        ],
      };
    } else if (timelineEvent.kind === "tool_result") {
      const exists = next.tools.some((tool) => tool.id === timelineEvent.id);
      next = {
        ...next,
        tools: exists
          ? next.tools.map((tool) =>
              tool.id === timelineEvent.id
                ? { ...tool, output: timelineEvent.output, status: timelineEvent.status }
                : tool
            )
          : [
              ...next.tools,
              {
                id: timelineEvent.id,
                name: "tool",
                output: timelineEvent.output,
                status: timelineEvent.status,
              },
            ],
      };
    } else if (timelineEvent.kind === "usage") {
      next = {
        ...next,
        usage: {
          inputTokens: timelineEvent.inputTokens,
          cacheCreationInputTokens: timelineEvent.cacheCreationInputTokens,
          cacheReadInputTokens: timelineEvent.cacheReadInputTokens,
          outputTokens: timelineEvent.outputTokens,
          totalTokens: timelineEvent.totalTokens,
          totalCostUsd: timelineEvent.totalCostUsd,
          durationMs: timelineEvent.durationMs,
        },
      };
    } else if (timelineEvent.kind === "rate_limit") {
      next = {
        ...next,
        rateLimit: {
          utilization: timelineEvent.utilization,
          status: timelineEvent.status,
        },
      };
    } else if (timelineEvent.kind === "status") {
      next = { ...next, status: timelineEvent.status };
    }
  }

  return next;
}
