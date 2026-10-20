import { describe, expect, it } from "bun:test";
import { parseAcpMessage } from "../acp-parser";

describe("parseAcpMessage", () => {
  it("should handle plain text fallback for DEBUG logs with session match", () => {
    const events = parseAcpMessage("DEBUG message session: session-123-abc");
    expect(events).toEqual([
      { type: "session", sessionId: "session-123-abc" },
      { type: "log", stream: "system", content: "[session] session-123-abc" },
    ]);
  });

  it("should handle structured LLM INFO lines", () => {
    const events = parseAcpMessage("INFO Something +12ms service=llm model=gpt-4");
    expect(events).toEqual([{ type: "log", stream: "system", content: "  model: gpt-4" }]);
  });

  it("should handle structured tools INFO lines", () => {
    const events = parseAcpMessage("INFO Something +12ms service=tools tool=bash_run");
    expect(events).toEqual([{ type: "log", stream: "system", content: "  tool: bash_run" }]);
  });

  it("should handle structured ERROR lines", () => {
    const events = parseAcpMessage("ERROR Something +12ms service=worker some message key=val");
    expect(events).toEqual([{ type: "log", stream: "stderr", content: "[ERROR] some message" }]);
  });

  it("should handle structured WARN lines", () => {
    const events = parseAcpMessage("WARN Something +12ms service=worker some warning key=val");
    expect(events).toEqual([{ type: "log", stream: "stdout", content: "[WARN] some warning" }]);
  });

  it("should return empty for other structured lines", () => {
    const events = parseAcpMessage("INFO Something +12ms service=worker other message");
    expect(events).toEqual([]);
  });

  it("should handle Gemini ACP plain text thinking", () => {
    expect(parseAcpMessage("type: thinking")).toEqual([{ type: "status", content: "Thinking..." }]);
    expect(parseAcpMessage("event: tool_use")).toEqual([
      { type: "status", content: "Using tool..." },
    ]);
    expect(parseAcpMessage("type: tool_result")).toEqual([]);
  });

  describe("Direct Event Objects", () => {
    it("should parse type:tool_use failed", () => {
      const json = JSON.stringify({
        type: "tool_use",
        name: "test_tool",
        callId: "1",
        state: { status: "failed", error: "some error" },
      });
      expect(parseAcpMessage(json)).toEqual([
        { type: "tool_result", toolResult: { toolId: "1", output: "some error", status: "error" } },
        { type: "log", stream: "stderr", content: "  Error: some error" },
      ]);
    });

    it("should parse JSON-RPC params.tokens object", () => {
      // The implementation actually requires jsonrpc property to parse it as json-rpc
      const json = JSON.stringify({
        jsonrpc: "2.0",
        method: "step_finish",
        params: { tokens: { total: 100 } },
      });
      expect(parseAcpMessage(json)).toEqual([
        { type: "log", stream: "system", content: "  tokens: 100" },
      ]);
    });
  });
});
