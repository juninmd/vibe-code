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
