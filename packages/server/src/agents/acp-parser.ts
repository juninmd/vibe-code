import type { AgentEvent } from "./engine";

export function parseAcpMessage(line: string): AgentEvent[] {
  try {
    const parsed = JSON.parse(line);

    // Check if it's a JSON-RPC message
    if (parsed.jsonrpc === "2.0") {
      // Handle notifications/methods (e.g., window/logMessage)
      if (parsed.method) {
        if (parsed.method === "window/logMessage" && parsed.params) {
          const type = parsed.params.type;
          let stream: "stdout" | "stderr" | "system" = "system";
          // Typically 1=Error, 2=Warning, 3=Info, 4=Log
          if (type === 1 || type === 2) stream = "stderr";
          else stream = "stdout";
          return [{ type: "log", stream, content: String(parsed.params.message) }];
        }

        // Codex-style item notifications (raw v2 protocol)
        const params = parsed.params ?? {};
        const item = params.item ?? {};
        const itemId = String(item.id ?? "");
        const itemType = String(item.type ?? "");

        // item/started with commandExecution = tool_use
        if (parsed.method === "item/started" && itemType === "commandExecution") {
          const command = String(item.command ?? "");
          return [
            {
              type: "tool_use",
              toolUse: { toolId: itemId, toolName: "exec_command", parameters: { command } },
            },
            {
              type: "log",
              stream: "system",
              content: `[tool] exec_command${itemId ? ` (${itemId})` : ""}`,
            },
          ];
        }

        // item/completed with commandExecution = tool_result
        if (parsed.method === "item/completed" && itemType === "commandExecution") {
          const output = String(item.aggregatedOutput ?? item.output ?? "");
          return [
            {
              type: "tool_result",
              toolResult: { toolId: itemId, output, status: "success" },
            },
            {
              type: "log",
              stream: "system",
              content: `[tool result] success${itemId ? ` (${itemId})` : ""}`,
            },
          ];
        }

        // item/started with fileChange = tool_use
        if (parsed.method === "item/started" && itemType === "fileChange") {
          return [
            {
              type: "tool_use",
              toolUse: { toolId: itemId, toolName: "patch_apply", parameters: undefined },
            },
            {
              type: "log",
              stream: "system",
              content: `[tool] patch_apply${itemId ? ` (${itemId})` : ""}`,
            },
          ];
        }

        // item/completed with fileChange = tool_result
        if (parsed.method === "item/completed" && itemType === "fileChange") {
          return [
            {
              type: "tool_result",
              toolResult: { toolId: itemId, output: "", status: "success" },
            },
            {
              type: "log",
              stream: "system",
              content: `[tool result] success${itemId ? ` (${itemId})` : ""}`,
            },
          ];
        }

        // Legacy codex/event notifications
        if (parsed.method?.startsWith("codex/event") || parsed.method === "codex/event") {
          const msg = params.msg ?? {};
          const msgType = String(msg.type ?? "");
          const callId = String(msg.call_id ?? "");

          if (msgType === "exec_command_begin") {
            return [
              {
                type: "tool_use",
                toolUse: {
                  toolId: callId,
                  toolName: "exec_command",
                  parameters: { command: msg.command },
                },
              },
              {
                type: "log",
                stream: "system",
                content: `[tool] exec_command${callId ? ` (${callId})` : ""}`,
              },
            ];
          }

          if (msgType === "exec_command_end") {
            return [
              {
                type: "tool_result",
                toolResult: { toolId: callId, output: String(msg.output ?? ""), status: "success" },
              },
              {
                type: "log",
                stream: "system",
                content: `[tool result] success${callId ? ` (${callId})` : ""}`,
              },
            ];
          }

          if (msgType === "patch_apply_begin") {
            return [
              {
                type: "tool_use",
                toolUse: { toolId: callId, toolName: "patch_apply", parameters: undefined },
              },
              {
                type: "log",
                stream: "system",
                content: `[tool] patch_apply${callId ? ` (${callId})` : ""}`,
              },
            ];
          }

          if (msgType === "patch_apply_end") {
            return [
              {
                type: "tool_result",
                toolResult: { toolId: callId, output: "", status: "success" },
              },
              {
                type: "log",
                stream: "system",
                content: `[tool result] success${callId ? ` (${callId})` : ""}`,
              },
            ];
          }
        }

        return [{ type: "log", stream: "system", content: `[acp] call: ${parsed.method}` }];
      }

      // Handle responses
      if ("result" in parsed) {
        // If result is empty/null, we might not want to log it to avoid spam, but let's log strings
        if (typeof parsed.result === "string") {
          return [{ type: "log", stream: "stdout", content: parsed.result }];
        }
        return [
          {
            type: "log",
            stream: "system",
            content: `[acp] response: ${JSON.stringify(parsed.result).slice(0, 200)}`,
          },
        ];
      }

      // Handle errors
      if (parsed.error) {
        const errorMsg = parsed.error.message || JSON.stringify(parsed.error);
        return [{ type: "log", stream: "stderr", content: `[acp error] ${errorMsg}` }];
      }

      return [
        { type: "log", stream: "system", content: `[acp] unhandled: ${JSON.stringify(parsed)}` },
      ];
    }

    // Fallback if it is valid JSON but not JSON-RPC 2.0 (e.g. LLM direct stream-json)
    if (parsed.type === "text" && parsed.text) {
      return [{ type: "log", stream: "stdout", content: parsed.text }];
    }

    // If it's some other JSON
    return [{ type: "log", stream: "stdout", content: line }];
  } catch {
    // Not valid JSON, output as raw line
    return [{ type: "log", stream: "stdout", content: line }];
  }
}
