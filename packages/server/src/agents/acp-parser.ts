import type { AgentEvent } from "./engine";

/** Parse a single output line from any ACP-compatible agent engine (Claude Code, Gemini, OpenCode, etc.)
 *  Returns a list of AgentEvents extracted from the line.
 */
export function parseAcpMessage(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // ── Try JSON parse ─────────────────────────────────────────────────────────
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;

    // JSON-RPC 2.0 notifications (method + params, no id)
    if (parsed.jsonrpc === "2.0" && typeof parsed.method === "string") {
      const method = String(parsed.method);
      const params = (parsed.params ?? {}) as Record<string, unknown>;

      // session/started or session/resumed — extract session ID
      if (method === "session/started" || method === "session/resumed") {
        const sessionId = String(params.sessionId ?? params.id ?? "");
        if (sessionId) {
          return [
            { type: "session", sessionId },
            { type: "log", stream: "system", content: `[session] ${sessionId}` },
          ];
        }
      }

      // tool/use — agent is calling a tool
      if (method === "tool/use" || method === "tool/call" || method === "function/call") {
        const toolName = String(params.tool ?? params.name ?? params.function ?? "unknown");
        const callId = String(params.callId ?? params.id ?? "");
        const input = (params.input ?? params.arguments ?? {}) as Record<string, unknown>;
        return [
          { type: "tool_use", toolUse: { toolId: callId, toolName, parameters: input } },
          {
            type: "log",
            stream: "system",
            content: `[tool] ${toolName}${callId ? ` (${callId})` : ""}`,
          },
        ];
      }

      // tool/result or tool/completed — tool finished
      if (method === "tool/result" || method === "tool/completed" || method === "function/result") {
        const callId = String(params.callId ?? params.id ?? "");
        const output = params.output ?? params.result ?? "";
        const error = params.error;
        const status = error ? "error" : "success";
        const msg = error ? String(error) : "";
        return [
          { type: "tool_result", toolResult: { toolId: callId, output: String(output), status } },
          ...(msg ? [{ type: "log" as const, stream: "stderr" as const, content: msg }] : []),
        ];
      }

      // cost / usage — token usage report
      if (method === "cost" || method === "usage" || method === "tokens") {
        const costStats = params as Record<string, unknown>;
        if (costStats.total_tokens || costStats.input_tokens || costStats.output_tokens) {
          return [{ type: "cost", costStats: costStats as AgentEvent["costStats"] }];
        }
      }

      // error from the agent
      if (method === "error" || method === "tool/error") {
        const msg = String(params.message ?? params.error ?? "Unknown error");
        return [
          { type: "log", stream: "stderr", content: `[${method}] ${msg}` },
          { type: "error", content: msg },
        ];
      }

      // window/logMessage — standard log output
      if (method === "window/logMessage" && params.message) {
        const type = Number(params.type ?? 4);
        const stream: "stdout" | "stderr" | "system" =
          type === 1 || type === 2 ? "stderr" : type === 3 ? "system" : "stdout";
        return [{ type: "log", stream, content: String(params.message) }];
      }

      // progress / status update
      if (method === "progress" || method === "status" || method === "step") {
        const msg = String(params.message ?? params.text ?? params.status ?? "");
        if (msg) return [{ type: "status", content: msg }];
      }

      // step_start / step_finish
      if (method === "step_start" || method === "step_started") {
        return [{ type: "status", content: "Working..." }];
      }
      if (method === "step_finish" || method === "step_finished" || method === "step_complete") {
        const tokens = params.tokens ?? params.usage;
        if (
          tokens &&
          typeof tokens === "object" &&
          "total" in (tokens as Record<string, unknown>)
        ) {
          return [
            {
              type: "log",
              stream: "system",
              content: `  tokens: ${Number((tokens as Record<string, number>).total).toLocaleString()}`,
            },
          ];
        }
        return [];
      }

      // question / confirm / approval
      if (
        method === "question" ||
        method === "confirm" ||
        method === "approval" ||
        method === "user_input_required"
      ) {
        const msg = String(params.text ?? params.message ?? params.prompt ?? "Awaiting input...");
        return [
          { type: "status", content: "Awaiting input..." },
          { type: "log", stream: "stdout", content: `[?] ${msg}` },
        ];
      }

      // thinking / thought
      if (method === "thinking" || method === "thought") {
        const thought = String(params.thought ?? params.text ?? "");
        if (thought && thought.length < 1000) {
          return [
            { type: "status", content: "Thinking..." },
            { type: "log", stream: "stdout", content: `💭 ${thought}` },
          ];
        }
      }

      // Dismiss other methods silently
      return [];
    }

    // ── Direct event object (not JSON-RPC) ─────────────────────────────────
    const eventType = String(parsed.type ?? parsed.event ?? "");

    // text / content events
    if (
      (eventType === "text" || eventType === "content" || eventType === "message") &&
      (parsed.text || parsed.content || parsed.message)
    ) {
      const text = String(parsed.text ?? parsed.content ?? parsed.message ?? "");
      if (text.trim()) return [{ type: "log", stream: "stdout", content: text }];
    }

    // session events
    if (eventType === "session" || parsed.sessionId || parsed.session_id || eventType === "init") {
      const sessionId = String(parsed.sessionId ?? parsed.id ?? parsed.session_id ?? "");
      if (sessionId) {
        return [
          { type: "session", sessionId },
          { type: "log", stream: "system", content: `[session] ${sessionId}` },
        ];
      }
    }

    // result / completion events — extract token stats
    if (eventType === "result") {
      const stats = parsed.stats as Record<string, unknown> | undefined;
      if (stats?.total_tokens) {
        return [{ type: "cost", costStats: stats as AgentEvent["costStats"] }];
      }
    }

    // cost events
    if (eventType === "cost" || parsed.total_tokens) {
      const costStats = (parsed.costStats ?? parsed.usage ?? parsed) as Record<string, unknown>;
      if (costStats.total_tokens || costStats.input_tokens || costStats.output_tokens) {
        return [{ type: "cost", costStats: costStats as AgentEvent["costStats"] }];
      }
    }

    // tool_use / tool_call events
    if (
      eventType === "tool_use" ||
      eventType === "tool" ||
      eventType === "tool_call" ||
      eventType === "function_call" ||
      eventType === "function_call_request"
    ) {
      const toolName = String(parsed.tool ?? parsed.name ?? parsed.function ?? "unknown");
      const callId = String(parsed.callId ?? parsed.id ?? parsed.call_id ?? "");
      const state = (parsed.state ?? parsed.arguments ?? parsed.input ?? {}) as Record<
        string,
        unknown
      >;
      const status = String(parsed.status ?? state.status ?? "calling");
      const input = state.input ?? state.arguments ?? state ?? parsed;
      const output = state.output ?? parsed.output ?? parsed.result;
      const error = state.error ?? parsed.error;

      if (status === "calling" || status === "pending" || !status || status === "active") {
        return [
          {
            type: "tool_use",
            toolUse: { toolId: callId, toolName, parameters: input as Record<string, unknown> },
          },
          { type: "log", stream: "system", content: `[tool] ${toolName}` },
        ];
      }
      if (status === "completed" || status === "success" || status === "done") {
        const exitCode = (state.metadata ?? parsed.metadata ?? {}) as Record<string, unknown>;
        return [
          {
            type: "tool_result",
            toolResult: {
              toolId: callId,
              output: typeof output === "string" ? output : JSON.stringify(output ?? ""),
              status: error ? "error" : "success",
            },
          },
          ...(exitCode.exitCode != null && Number(exitCode.exitCode) !== 0
            ? [
                {
                  type: "log" as const,
                  stream: "stderr" as const,
                  content: `  Exit code: ${exitCode.exitCode}`,
                },
              ]
            : []),
        ];
      }
      if (status === "failed" || status === "error" || error) {
        const msg = String(error ?? state.error ?? parsed.errorMessage ?? "Failed");
        return [
          { type: "tool_result", toolResult: { toolId: callId, output: msg, status: "error" } },
          { type: "log", stream: "stderr", content: `  Error: ${msg}` },
        ];
      }
    }

    // thinking events
    if (eventType === "thinking" || eventType === "thought") {
      const thought = String(parsed.thought ?? parsed.text ?? parsed.content ?? "");
      if (thought && thought.length < 500) {
        return [
          { type: "status", content: "Thinking..." },
          { type: "log", stream: "stdout", content: `💭 ${thought}` },
        ];
      }
    }

    // error events
    if (eventType === "error" || eventType === "error event") {
      const msg = String(parsed.message ?? parsed.error ?? parsed.msg ?? "Unknown error");
      return [
        { type: "log", stream: "stderr", content: msg },
        { type: "error", content: msg },
      ];
    }

    // question / confirm / approval events
    if (
      eventType === "question" ||
      eventType === "confirm" ||
      eventType === "approval" ||
      eventType === "user_input_required"
    ) {
      const msg = String(parsed.text ?? parsed.content ?? parsed.message ?? "Awaiting input...");
      return [
        { type: "status", content: "Awaiting input..." },
        { type: "log", stream: "stdout", content: `[?] ${msg}` },
      ];
    }

    // progress / status events
    if (eventType === "progress" || eventType === "status_update") {
      const msg = String(parsed.message ?? parsed.text ?? parsed.status ?? "");
      if (msg) return [{ type: "status", content: msg }];
    }

    // step events
    if (
      eventType === "step_start" ||
      eventType === "step_finish" ||
      eventType === "step_complete"
    ) {
      const tokens = (parsed.tokens ?? parsed.usage ?? {}) as Record<string, number>;
      if (tokens?.total) {
        return [
          { type: "log", stream: "system", content: `  tokens: ${tokens.total.toLocaleString()}` },
        ];
      }
      return [];
    }

    // Unknown event — try extracting any text content
    const content = parsed.content ?? parsed.text ?? parsed.message;
    if (typeof content === "string" && content.trim()) {
      return [{ type: "log", stream: "stdout", content }];
    }

    return [];
  } catch {
    // Not JSON — treat as plain text output
  }

  // ── Plain text fallback ───────────────────────────────────────────────────
  // Skip noise patterns that are not useful
  if (
    trimmed.startsWith("DEBUG") ||
    trimmed.startsWith("TRACE") ||
    trimmed.match(/^\d{4}-\d{2}-\d{2}T.*\[DEBUG\]/) ||
    trimmed.match(/^\[debug\]/i) ||
    trimmed.match(/^DBG /) ||
    trimmed.includes("model loaded") ||
    trimmed.includes("initialized") ||
    trimmed.includes("cleanup") ||
    trimmed.includes("provider:") ||
    trimmed.includes("session:")
  ) {
    // Still show session IDs if present
    const sessionMatch = trimmed.match(/session[=:]\s*([a-zA-Z0-9_-]+)/);
    if (sessionMatch) {
      return [
        { type: "session", sessionId: sessionMatch[1] },
        { type: "log", stream: "system", content: `[session] ${sessionMatch[1]}` },
      ];
    }
    return [];
  }

  // Structured INFO lines from OpenCode/Gemini logs
  const infoMatch = trimmed.match(
    /^(INFO|WARN|ERROR|DEBUG)\s+\S+\s+\+\d+ms\s+service=(\S+)\s+(.*)/
  );
  if (infoMatch) {
    const [, level, service, rest] = infoMatch;
    if (service === "llm") {
      const modelMatch = rest.match(/model[=:]([^\s,]+)/);
      if (modelMatch)
        return [{ type: "log", stream: "system", content: `  model: ${modelMatch[1]}` }];
    }
    if (service === "tools") {
      const toolMatch = rest.match(/tool[=:]([^\s,]+)/);
      if (toolMatch) return [{ type: "log", stream: "system", content: `  tool: ${toolMatch[1]}` }];
    }
    if (level === "ERROR" || level === "WARN") {
      const msg = rest.replace(/\w+=\S+\s*/g, "").trim();
      if (msg)
        return [
          {
            type: "log",
            stream: level === "ERROR" ? "stderr" : "stdout",
            content: `[${level}] ${msg}`,
          },
        ];
    }
    return [];
  }

  // Gemini ACP-style "type: value" plain text
  if (trimmed.startsWith("type:") || trimmed.startsWith("event:")) {
    const value = trimmed.split(":").slice(1).join(":").trim();
    if (value === "thinking") return [{ type: "status", content: "Thinking..." }];
    if (value === "tool_use") return [{ type: "status", content: "Using tool..." }];
    if (value === "tool_result") return [];
  }

  // Generic plain text — return as stdout
  return [{ type: "log", stream: "stdout", content: trimmed }];
}
