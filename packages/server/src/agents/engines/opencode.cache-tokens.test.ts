import { describe, expect, it } from "bun:test";
import { OpenCodeEngine } from "./opencode";

describe("step_finish cache token accumulation", () => {
  const engine = new OpenCodeEngine();

  it("emits cost event with cache.read mapped to costStats.cached", () => {
    const line = JSON.stringify({
      type: "step_finish",
      part: { tokens: { input: 1000, output: 500, cache: { read: 800, write: 200 } } },
    });
    const events = engine.parseLine(line);
    const cost = events.find((e) => e.type === "cost");
    expect(cost).toBeDefined();
    expect(cost?.costStats?.input_tokens).toBe(1000);
    expect(cost?.costStats?.output_tokens).toBe(500);
    expect(cost?.costStats?.cached).toBe(800);
    expect(cost?.costStats?.total_tokens).toBe(1500);
    const log = events.find(
      (e) => e.type === "log" && e.stream === "system" && e.content?.includes("cache r:800")
    );
    expect(log).toBeDefined();
  });

  it("emits cost event without cache when not provided", () => {
    const line = JSON.stringify({
      type: "step_finish",
      part: { tokens: { input: 100, output: 50 } },
    });
    const events = engine.parseLine(line);
    const cost = events.find((e) => e.type === "cost");
    expect(cost?.costStats?.cached).toBeUndefined();
    expect(cost?.costStats?.total_tokens).toBe(150);
  });

  it("skips cost when all token fields are zero", () => {
    const line = JSON.stringify({ type: "step_finish", part: { tokens: {} } });
    const events = engine.parseLine(line);
    expect(events.find((e) => e.type === "cost")).toBeUndefined();
  });
});
