import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "../engine";
import { OpenCodeEngine } from "./opencode";
import { manualWriteGuardFixture } from "./opencode.fixtures";

function replayFixture(lines: string[]): AgentEvent[] {
  const engine = new OpenCodeEngine();
  return lines.flatMap((line) => engine.parseLine(line));
}

describe("OpenCodeEngine replay fixtures", () => {
  it("replays the real write-guard flow captured from the CLI", () => {
    const events = replayFixture(manualWriteGuardFixture.lines);

    expect(events.filter((event) => event.type === "status")).toHaveLength(3);
    expect(events.filter((event) => event.stream === "system")).toHaveLength(3);

    const stderrLog = events.find(
      (event) => event.stream === "stderr" && event.content?.includes("must read file")
    );
    const readLog = events.find(
      (event) => event.stream === "stdout" && event.content?.includes("lines read")
    );
    const finalText = events.find(
      (event) =>
        event.stream === "stdout" &&
        event.content?.includes("already exists with the exact content")
    );

    expect(stderrLog?.content).toContain("hello.txt before overwriting it");
    expect(readLog?.content).toBe("    5 lines read");
    expect(finalText?.content).toContain("No changes needed.");

    const stderrIndex = stderrLog ? events.indexOf(stderrLog) : -1;
    const readIndex = readLog ? events.indexOf(readLog) : -1;
    const finalTextIndex = finalText ? events.indexOf(finalText) : -1;

    expect(stderrIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeGreaterThan(stderrIndex);
    expect(finalTextIndex).toBeGreaterThan(readIndex);
  });
});
