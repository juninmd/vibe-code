import { describe, expect, it } from "bun:test";
import { OpenCodeEngine } from "./opencode";

describe("OpenCodeEngine Advanced Contract Tests", () => {
  const engine = new OpenCodeEngine();

  it("surfaces non-zero exit code even if status is 'completed' (snapshot real)", () => {
    // Snapshot from: opencode trying to use 'del' on bash (fails with 127)
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "del test.txt" },
          output: "bash: del: command not found",
          metadata: { exit: 127 }
        }
      }
    });

    const events = engine.parseLine(line);
    
    // Check that we captured the exit code error
    const stderrLog = events.find(e => e.stream === "stderr" && e.content?.includes("127"));
    expect(stderrLog).toBeDefined();
    expect(stderrLog?.content).toBe("  Command exited with code 127");
  });

  it("handles complex file writing contract (write tool)", () => {
    // Snapshot captured from: opencode creating 'contrato_roubado.txt'
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "write",
        state: {
          status: "completed",
          input: { filePath: "test.txt", content: "DNA" },
          output: "Wrote file successfully."
        }
      }
    });

    const events = engine.parseLine(line);
    expect(events.find(e => e.content?.includes("Saved"))).toBeDefined();
  });
});
