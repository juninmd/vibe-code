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

    const stderrIndex = events.findIndex((event) => event === stderrLog);
    const readIndex = events.findIndex((event) => event === readLog);
    const finalTextIndex = events.findIndex((event) => event === finalText);

    expect(stderrIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeGreaterThan(stderrIndex);
    expect(finalTextIndex).toBeGreaterThan(readIndex);
  });
});
