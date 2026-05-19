import { describe, expect, it } from "bun:test";
import { parseAcpMessage } from "./acp-parser";

describe("parseAcpMessage", () => {
  it("should ignore debug messages", () => {
    const events = parseAcpMessage("DEBUG: Some generic debug text");
    expect(events).toEqual([]);
  });

  it("should ignore trace messages", () => {
    const events = parseAcpMessage("TRACE: Something");
    expect(events).toEqual([]);
  });

  it("should extract structured info (tool)", () => {
    const events = parseAcpMessage("INFO xyz +100ms service=tools tool=bash something");
    expect(events).toEqual([{ type: "log", stream: "system", content: "  tool: bash" }]);
  });

  it("should return plain text as stdout", () => {
    const events = parseAcpMessage("Hello world");
    expect(events).toEqual([{ type: "log", stream: "stdout", content: "Hello world" }]);
  });

  it("should handle error string", () => {
    const events = parseAcpMessage('{"type": "error", "message": "Failed to run"}');
    expect(events).toEqual([
      { type: "log", stream: "stderr", content: "Failed to run" },
      { type: "error", content: "Failed to run" },
    ]);
  });
});
