import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GrokEngine } from "./grok";

describe("GrokEngine", () => {
  const originalSpawn = Bun.spawn;
  let spawnCalls: any[] = [];
  let mockSpawnResult: any = null;

  beforeEach(() => {
    spawnCalls = [];
    (Bun as any).spawn = (args: any, options: any) => {
      spawnCalls.push({ args, options });
      return (
        mockSpawnResult || {
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: new Response("1.0.0").body,
          stderr: new Response("").body,
          kill() {},
        }
      );
    };
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    mockSpawnResult = null;
  });

  it("isAvailable returns true on success", async () => {
    const engine = new GrokEngine();
    mockSpawnResult = {
      exited: Promise.resolve(0),
      exitCode: 0,
    };
    const available = await engine.isAvailable();
    expect(available).toBe(true);
    expect(spawnCalls[0].args).toEqual(["grok", "--version"]);
  });

  it("isAvailable returns false on failure", async () => {
    const engine = new GrokEngine();
    mockSpawnResult = {
      exited: Promise.resolve(1),
      exitCode: 1,
    };
    const available = await engine.isAvailable();
    expect(available).toBe(false);
  });

  it("getVersion returns version string", async () => {
    const engine = new GrokEngine();
    mockSpawnResult = {
      exited: Promise.resolve(0),
      exitCode: 0,
      stdout: new Response("grok version 1.2.3\n").body,
      stderr: new Response("").body,
    };
    const version = await engine.getVersion();
    expect(version).toBe("grok version 1.2.3");
  });

  it("listModels returns grok-build", async () => {
    const engine = new GrokEngine();
    const models = await engine.listModels();
    expect(models).toEqual(["grok-build"]);
  });

  it("execute runs grok CLI and yields events from streaming json stdout", async () => {
    const engine = new GrokEngine();

    // Prepare streaming outputs
    const stdoutLines = `${[
      JSON.stringify({ type: "thought", data: "thinking..." }),
      JSON.stringify({ type: "text", data: "hello world" }),
      JSON.stringify({ type: "end", sessionId: "session-abc-123" }),
    ].join("\n")}\n`;

    mockSpawnResult = {
      exited: Promise.resolve(0),
      exitCode: 0,
      stdout: new Response(stdoutLines).body,
      stderr: new Response("").body,
      kill() {},
    };

    const events: any[] = [];
    for await (const event of engine.execute("test prompt", "/work/dir", {
      runId: "run-1",
      resumeSessionId: "prev-session",
    })) {
      events.push(event);
    }

    // Verify calls
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].args).toContain("grok");
    expect(spawnCalls[0].args).toContain("--cwd");
    expect(spawnCalls[0].args).toContain("/work/dir");
    expect(spawnCalls[0].args).toContain("--resume");
    expect(spawnCalls[0].args).toContain("prev-session");
    expect(spawnCalls[0].args).toContain("test prompt");

    // Verify parsed events
    // Grok starting log (system log) + parsed stdout lines + complete event
    expect(events.some((e) => e.type === "log" && e.content.includes("Starting"))).toBe(true);
    expect(events.some((e) => e.type === "log" && e.content === "thinking...")).toBe(true);
    expect(events.some((e) => e.type === "log" && e.content === "hello world")).toBe(true);
    expect(events.some((e) => e.type === "session" && e.sessionId === "session-abc-123")).toBe(
      true
    );
    expect(events.some((e) => e.type === "complete" && e.exitCode === 0)).toBe(true);
  });
});
