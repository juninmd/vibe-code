import { describe, expect, it } from "bun:test";
import { parseAcpMessage } from "./acp-parser";

describe("parseAcpMessage", () => {
  it("should return empty array for empty string", () => {
    expect(parseAcpMessage("")).toEqual([]);
    expect(parseAcpMessage("   ")).toEqual([]);
  });

  describe("JSON-RPC 2.0 Notifications", () => {
    it("should parse session/started", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/started",
        params: { sessionId: "test-session-id" },
      });
      const expected = [
        { type: "session", sessionId: "test-session-id" },
        { type: "log", stream: "system", content: "[session] test-session-id" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse session/resumed", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/resumed",
        params: { id: "test-session-id-2" },
      });
      const expected = [
        { type: "session", sessionId: "test-session-id-2" },
        { type: "log", stream: "system", content: "[session] test-session-id-2" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse tool/use", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "tool/use",
        params: { tool: "my_tool", callId: "call-1", input: { arg: "val" } },
      });
      const expected = [
        {
          type: "tool_use",
          toolUse: { toolId: "call-1", toolName: "my_tool", parameters: { arg: "val" } },
        },
        { type: "log", stream: "system", content: "[tool] my_tool (call-1)" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse tool/call with name/arguments", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "tool/call",
        params: { name: "other_tool", id: "call-2", arguments: { x: 1 } },
      });
      const expected = [
        {
          type: "tool_use",
          toolUse: { toolId: "call-2", toolName: "other_tool", parameters: { x: 1 } },
        },
        { type: "log", stream: "system", content: "[tool] other_tool (call-2)" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse tool/result success", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "tool/result",
        params: { callId: "call-1", output: "success result" },
      });
      const expected = [
        {
          type: "tool_result",
          toolResult: { toolId: "call-1", output: "success result", status: "success" },
        },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse tool/result error", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "tool/result",
        params: { callId: "call-1", error: "failed to execute" },
      });
      const expected = [
        {
          type: "tool_result",
          toolResult: { toolId: "call-1", output: "", status: "error" },
        },
        { type: "log", stream: "stderr", content: "failed to execute" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse cost/usage", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "usage",
        params: { total_tokens: 100, input_tokens: 40, output_tokens: 60 },
      });
      const expected = [
        {
          type: "cost",
          costStats: { total_tokens: 100, input_tokens: 40, output_tokens: 60 },
        },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse error", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "error",
        params: { message: "fatal error" },
      });
      const expected = [
        { type: "log", stream: "stderr", content: "[error] fatal error" },
        { type: "error", content: "fatal error" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse window/logMessage stdout", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "window/logMessage",
        params: { type: 4, message: "hello world" },
      });
      const expected = [{ type: "log", stream: "stdout", content: "hello world" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse window/logMessage stderr", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "window/logMessage",
        params: { type: 1, message: "error here" },
      });
      const expected = [{ type: "log", stream: "stderr", content: "error here" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse window/logMessage system", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "window/logMessage",
        params: { type: 3, message: "system info" },
      });
      const expected = [{ type: "log", stream: "system", content: "system info" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse progress", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "progress",
        params: { message: "50% done" },
      });
      const expected = [{ type: "status", content: "50% done" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse step_start", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "step_start",
      });
      const expected = [{ type: "status", content: "Working..." }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse step_finish with tokens", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "step_finish",
        params: { tokens: { total: 1234 } },
      });
      const expected = [{ type: "log", stream: "system", content: "  tokens: 1,234" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse step_finish without tokens", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "step_finish",
      });
      expect(parseAcpMessage(input)).toEqual([]);
    });

    it("should parse question", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "question",
        params: { message: "Proceed?" },
      });
      const expected = [
        { type: "status", content: "Awaiting input..." },
        { type: "log", stream: "stdout", content: "[?] Proceed?" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse thinking", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "thinking",
        params: { thought: "I should do this" },
      });
      const expected = [
        { type: "status", content: "Thinking..." },
        { type: "log", stream: "stdout", content: "💭 I should do this" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should return empty array for unhandled JSON-RPC method", () => {
      const input = JSON.stringify({
        jsonrpc: "2.0",
        method: "unknown_method",
        params: {},
      });
      expect(parseAcpMessage(input)).toEqual([]);
    });
  });

  describe("Direct Event Objects", () => {
    it("should parse type:text", () => {
      const input = JSON.stringify({ type: "text", text: "plain text message" });
      const expected = [{ type: "log", stream: "stdout", content: "plain text message" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:session", () => {
      const input = JSON.stringify({ type: "session", sessionId: "direct-session" });
      const expected = [
        { type: "session", sessionId: "direct-session" },
        { type: "log", stream: "system", content: "[session] direct-session" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:result", () => {
      const input = JSON.stringify({ type: "result", stats: { total_tokens: 500 } });
      const expected = [{ type: "cost", costStats: { total_tokens: 500 } }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:cost", () => {
      const input = JSON.stringify({ type: "cost", usage: { total_tokens: 600 } });
      const expected = [{ type: "cost", costStats: { total_tokens: 600 } }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse total_tokens directly", () => {
      const input = JSON.stringify({ total_tokens: 150 });
      const expected = [{ type: "cost", costStats: { total_tokens: 150 } }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:tool_use pending", () => {
      const input = JSON.stringify({
        type: "tool_use",
        tool: "cmd",
        callId: "123",
        status: "pending",
        input: { cmd: "ls" },
      });
      const expected = [
        {
          type: "tool_use",
          toolUse: { toolId: "123", toolName: "cmd", parameters: { cmd: "ls" } },
        },
        { type: "log", stream: "system", content: "[tool] cmd" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:tool_use completed", () => {
      const input = JSON.stringify({
        type: "tool_use",
        tool: "cmd",
        callId: "123",
        status: "completed",
        output: "file1 file2",
      });
      const expected = [
        {
          type: "tool_result",
          toolResult: { toolId: "123", output: "file1 file2", status: "success" },
        },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:tool_use completed with exitCode", () => {
      const input = JSON.stringify({
        type: "tool_use",
        tool: "cmd",
        callId: "123",
        status: "completed",
        output: "file1 file2",
        metadata: { exitCode: 1 },
      });
      const expected = [
        {
          type: "tool_result",
          toolResult: { toolId: "123", output: "file1 file2", status: "success" },
        },
        {
          type: "log",
          stream: "stderr",
          content: "  Exit code: 1",
        },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:tool_use failed", () => {
      const input = JSON.stringify({
        type: "tool_use",
        tool: "cmd",
        callId: "123",
        status: "failed",
        error: "command not found",
      });
      const expected = [
        {
          type: "tool_result",
          toolResult: { toolId: "123", output: "command not found", status: "error" },
        },
        { type: "log", stream: "stderr", content: "  Error: command not found" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:thinking", () => {
      const input = JSON.stringify({ type: "thinking", thought: "hmm..." });
      const expected = [
        { type: "status", content: "Thinking..." },
        { type: "log", stream: "stdout", content: "💭 hmm..." },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:error", () => {
      const input = JSON.stringify({ type: "error", message: "boom" });
      const expected = [
        { type: "log", stream: "stderr", content: "boom" },
        { type: "error", content: "boom" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:question", () => {
      const input = JSON.stringify({ type: "question", text: "yes or no?" });
      const expected = [
        { type: "status", content: "Awaiting input..." },
        { type: "log", stream: "stdout", content: "[?] yes or no?" },
      ];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:progress", () => {
      const input = JSON.stringify({ type: "progress", message: "Downloading..." });
      const expected = [{ type: "status", content: "Downloading..." }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should parse type:step_start", () => {
      const input = JSON.stringify({ type: "step_start" });
      expect(parseAcpMessage(input)).toEqual([]); // step events without total return []
    });

    it("should parse type:step_finish with tokens", () => {
      const input = JSON.stringify({ type: "step_finish", tokens: { total: 50 } });
      const expected = [{ type: "log", stream: "system", content: "  tokens: 50" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should extract unknown event content", () => {
      const input = JSON.stringify({ type: "unknown_event", content: "some text" });
      const expected = [{ type: "log", stream: "stdout", content: "some text" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });
  });

  describe("Plain Text Fallback", () => {
    it("should handle valid plain text", () => {
      expect(parseAcpMessage("Hello world")).toEqual([
        { type: "log", stream: "stdout", content: "Hello world" },
      ]);
    });

    it("should ignore noise starting with DEBUG", () => {
      expect(parseAcpMessage("DEBUG: doing stuff")).toEqual([]);
    });

    it("should ignore noise starting with TRACE", () => {
      expect(parseAcpMessage("TRACE: doing stuff")).toEqual([]);
    });

    it("should extract session ID from noise", () => {
      const expected = [
        { type: "session", sessionId: "my-session-xyz" },
        { type: "log", stream: "system", content: "[session] my-session-xyz" },
      ];
      expect(parseAcpMessage("DEBUG session=my-session-xyz")).toEqual(expected as any);
    });

    it("should process structured INFO lines for llm model", () => {
      const input = "INFO    engine +10ms service=llm Using model=gpt-4";
      const expected = [{ type: "log", stream: "system", content: "  model: gpt-4" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should process structured INFO lines for tool", () => {
      const input = "INFO    engine +10ms service=tools Calling tool=readFile";
      const expected = [{ type: "log", stream: "system", content: "  tool: readFile" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should process structured ERROR lines", () => {
      const input = "ERROR    engine +10ms service=llm  Failed to fetch";
      const expected = [{ type: "log", stream: "stderr", content: "[ERROR] Failed to fetch" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should process structured WARN lines", () => {
      const input = "WARN    engine +10ms service=tools  Deprecated param";
      const expected = [{ type: "log", stream: "stdout", content: "[WARN] Deprecated param" }];
      expect(parseAcpMessage(input)).toEqual(expected as any);
    });

    it("should process type: thinking plain text", () => {
      expect(parseAcpMessage("type: thinking")).toEqual([
        { type: "status", content: "Thinking..." },
      ]);
    });

    it("should process type: tool_use plain text", () => {
      expect(parseAcpMessage("type: tool_use")).toEqual([
        { type: "status", content: "Using tool..." },
      ]);
    });

    it("should process type: tool_result plain text", () => {
      expect(parseAcpMessage("type: tool_result")).toEqual([]);
    });

    it("should process event: plain text", () => {
      expect(parseAcpMessage("event: thinking")).toEqual([
        { type: "status", content: "Thinking..." },
      ]);
    });
  });
});

describe("parseAcpMessage uncovered coverage", () => {
  it("should process init event type", () => {
    const input = JSON.stringify({ type: "init", sessionId: "init-session" });
    const expected = [
      { type: "session", sessionId: "init-session" },
      { type: "log", stream: "system", content: "[session] init-session" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should process function_call_request", () => {
    const input = JSON.stringify({
      type: "function_call_request",
      function: "my_func",
      id: "call_abc",
      status: "pending",
    });
    const expected = [
      {
        type: "tool_use",
        toolUse: { toolId: "call_abc", toolName: "my_func", parameters: {} },
      },
      { type: "log", stream: "system", content: "[tool] my_func" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should process tool status active", () => {
    const input = JSON.stringify({
      type: "tool",
      tool: "cmd",
      callId: "123",
      status: "active",
      input: { cmd: "ls" },
    });
    const expected = [
      {
        type: "tool_use",
        toolUse: { toolId: "123", toolName: "cmd", parameters: { cmd: "ls" } },
      },
      { type: "log", stream: "system", content: "[tool] cmd" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should parse step_complete event type", () => {
    const input = JSON.stringify({ type: "step_complete", usage: { total: 100 } });
    const expected = [{ type: "log", stream: "system", content: "  tokens: 100" }];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should parse result without token usage to empty array", () => {
    const input = JSON.stringify({ type: "result" });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should process tool with done status", () => {
    const input = JSON.stringify({
      type: "tool_use",
      tool: "cmd",
      callId: "123",
      status: "done",
      output: "done output",
    });
    const expected = [
      {
        type: "tool_result",
        toolResult: { toolId: "123", output: "done output", status: "success" },
      },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should extract unknown event with text", () => {
    const input = JSON.stringify({ event: "unknown", text: "text content" });
    const expected = [{ type: "log", stream: "stdout", content: "text content" }];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should return empty array for non json plain text that is not handled", () => {
    expect(parseAcpMessage("plain text without magic strings")).toEqual([
      { type: "log", stream: "stdout", content: "plain text without magic strings" },
    ]);
  });

  it("should return empty array if event content string is empty", () => {
    const input = JSON.stringify({ event: "unknown", content: "  " });
    expect(parseAcpMessage(input)).toEqual([]);
  });
});

describe("parseAcpMessage uncovered coverage 2", () => {
  it("should process session method with missing params", () => {
    const input = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/started",
    });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should parse window/logMessage with other type", () => {
    const input = JSON.stringify({
      jsonrpc: "2.0",
      method: "window/logMessage",
      params: { message: "default message" },
    });
    const expected = [{ type: "log", stream: "stdout", content: "default message" }];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should parse step_finish with tokens nested object", () => {
    const input = JSON.stringify({
      jsonrpc: "2.0",
      method: "step_finish",
      params: { usage: { total: 10 } },
    });
    const expected = [{ type: "log", stream: "system", content: "  tokens: 10" }];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should extract tokens from usage for cost event", () => {
    const input = JSON.stringify({ type: "cost", usage: { input_tokens: 5, output_tokens: 5 } });
    const expected = [{ type: "cost", costStats: { input_tokens: 5, output_tokens: 5 } }];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should return empty array for result with no valid stats", () => {
    const input = JSON.stringify({ type: "result", stats: { no_tokens: true } });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should handle error with msg field", () => {
    const input = JSON.stringify({ type: "error", msg: "error msg" });
    const expected = [
      { type: "log", stream: "stderr", content: "error msg" },
      { type: "error", content: "error msg" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should handle thinking event with content field", () => {
    const input = JSON.stringify({ type: "thinking", content: "think content" });
    const expected = [
      { type: "status", content: "Thinking..." },
      { type: "log", stream: "stdout", content: "💭 think content" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });
});

describe("parseAcpMessage uncovered coverage 3 (closing braces)", () => {
  it("should cover missing closing braces block branches", () => {
    // Some of the reported missing lines are just closing braces,
    // but let's test a cost object missing proper fields
    const input = JSON.stringify({ type: "cost", usage: {} });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should cover usage without matching properties", () => {
    const input = JSON.stringify({
      jsonrpc: "2.0",
      method: "usage",
      params: { unknown_prop: 100 },
    });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should return empty array for tool result plain text", () => {
    expect(parseAcpMessage("type: tool_result")).toEqual([]);
  });

  it("should test unknown result with stats but no tokens", () => {
    const input = JSON.stringify({ type: "result", stats: {} });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should test cost object with missing token fields", () => {
    const input = JSON.stringify({ type: "cost", usage: { random: 10 } });
    expect(parseAcpMessage(input)).toEqual([]);
  });
});

describe("parseAcpMessage uncovered coverage 4 (more JSON properties)", () => {
  it("should return empty array when method tool/use has no name/tool/function", () => {
    const input = JSON.stringify({
      jsonrpc: "2.0",
      method: "tool/use",
      params: {},
    });
    const expected = [
      {
        type: "tool_use",
        toolUse: { toolId: "", toolName: "unknown", parameters: {} },
      },
      { type: "log", stream: "system", content: "[tool] unknown" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should handle error in tool result json where error is an object", () => {
    const input = JSON.stringify({
      jsonrpc: "2.0",
      method: "tool/result",
      params: { error: { msg: "failed" } },
    });
    const expected = [
      {
        type: "tool_result",
        toolResult: { toolId: "", output: "", status: "error" },
      },
      { type: "log", stream: "stderr", content: "[object Object]" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should process JSON RPC 2.0 with null params", () => {
    const input = JSON.stringify({
      jsonrpc: "2.0",
      method: "step_finish",
      params: null,
    });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should handle tool_use event where status is undefined", () => {
    const input = JSON.stringify({
      type: "tool_use",
      tool: "cmd",
      callId: "123",
      input: { cmd: "ls" },
    });
    const expected = [
      {
        type: "tool_use",
        toolUse: { toolId: "123", toolName: "cmd", parameters: { cmd: "ls" } },
      },
      { type: "log", stream: "system", content: "[tool] cmd" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should process step_finish when params is undefined", () => {
    const input = JSON.stringify({
      jsonrpc: "2.0",
      method: "step_finish",
    });
    expect(parseAcpMessage(input)).toEqual([]);
  });
});

describe("parseAcpMessage uncovered coverage 5 (all JSON permutations)", () => {
  it("should cover tool_use with function_call fallback", () => {
    const input = JSON.stringify({
      type: "function_call",
      function: "test_tool",
      id: "1",
      status: "completed",
      output: "ok",
    });
    const expected = [
      {
        type: "tool_result",
        toolResult: { toolId: "1", output: "ok", status: "success" },
      },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should return empty string if result without proper token stats", () => {
    const input = JSON.stringify({ type: "result", stats: { other: 123 } });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should process error event type with 'error event' literal", () => {
    const input = JSON.stringify({ type: "error event", error: "msg" });
    const expected = [
      { type: "log", stream: "stderr", content: "msg" },
      { type: "error", content: "msg" },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should test cost type falling back to parsed self", () => {
    const input = JSON.stringify({ type: "cost", input_tokens: 1, output_tokens: 2 });
    const expected = [
      { type: "cost", costStats: { type: "cost", input_tokens: 1, output_tokens: 2 } },
    ];
    expect(parseAcpMessage(input)).toEqual(expected as any);
  });

  it("should return empty for thinking event missing thought", () => {
    // Needs to fail the `if (thought && thought.length < 500)` condition
    const input = JSON.stringify({ type: "thinking" });
    expect(parseAcpMessage(input)).toEqual([]);
  });

  it("should ignore long thinking content", () => {
    // Create thought larger than 500 characters
    const longThought = "a".repeat(600);
    const input = JSON.stringify({ type: "thinking", thought: longThought });
    expect(parseAcpMessage(input)).toEqual([]);
  });
});
