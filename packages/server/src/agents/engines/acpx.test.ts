import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AcpxEngine } from "./acpx";

describe("AcpxEngine", () => {
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
    const engine = new AcpxEngine();
    mockSpawnResult = {
      exited: Promise.resolve(0),
      exitCode: 0,
    };
    const available = await engine.isAvailable();
    expect(available).toBe(true);
    expect(spawnCalls[0].args).toEqual(["acpx", "--version"]);
  });

  it("isAvailable returns false on failure", async () => {
    const engine = new AcpxEngine();
    mockSpawnResult = {
      exited: Promise.resolve(1),
      exitCode: 1,
    };
    const available = await engine.isAvailable();
    expect(available).toBe(false);
  });

  it("getVersion returns version string", async () => {
    const engine = new AcpxEngine();
    mockSpawnResult = {
      exited: Promise.resolve(0),
      exitCode: 0,
      stdout: new Response("acpx version 2.1.0\n").body,
      stderr: new Response("").body,
    };
    const version = await engine.getVersion();
    expect(version).toBe("acpx version 2.1.0");
  });

  it("listModels returns models", async () => {
    const engine = new AcpxEngine();
    const models = await engine.listModels();
    expect(models).toEqual(["claude", "codex"]);
  });

  it("execute runs acpx and handles all acpx.* event types", async () => {
    const engine = new AcpxEngine();

    const acpxLines = `${[
      JSON.stringify({ type: "acpx.session", sessionId: "sess-123" }),
      JSON.stringify({ type: "acpx.text_delta", text: "Writing code..." }),
      JSON.stringify({
        type: "acpx.tool_call",
        name: "edit_file",
        id: "call-99",
        input: { path: "index.ts" },
      }),
      JSON.stringify({
        type: "acpx.tool_result",
        id: "call-99",
        output: "Success",
      }),
      JSON.stringify({ type: "acpx.status", text: "Running checks" }),
      JSON.stringify({ type: "acpx.result", summary: "Task completed successfully" }),
      JSON.stringify({ type: "acpx.error", message: "Something failed" }),
    ].join("\n")}\n`;

    mockSpawnResult = {
      exited: Promise.resolve(0),
      exitCode: 0,
      stdout: new Response(acpxLines).body,
      stderr: new Response("").body,
      kill() {},
    };

    const events: any[] = [];
    for await (const event of engine.execute("implement auth", "/app", {
      runId: "run-2",
      resumeSessionId: "sess-old",
      model: "claude",
      env: {
        ACPX_AGENT: "my-custom-agent",
        ACPX_PERMISSION_MODE: "approve-all",
      },
    })) {
      events.push(event);
    }

    // Check args
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].args).toContain("acpx");
    expect(spawnCalls[0].args).toContain("--cwd");
    expect(spawnCalls[0].args).toContain("/app");
    expect(spawnCalls[0].args).toContain("--agent");
    expect(spawnCalls[0].args).toContain("my-custom-agent");
    expect(spawnCalls[0].args).toContain("--permission-mode");
    expect(spawnCalls[0].args).toContain("approve-all");
    expect(spawnCalls[0].args).toContain("--resume");
    expect(spawnCalls[0].args).toContain("sess-old");
    expect(spawnCalls[0].args).toContain("--model");
    expect(spawnCalls[0].args).toContain("claude");
    expect(spawnCalls[0].args).toContain("implement auth");

    // Check parsed events
    expect(events.some((e) => e.type === "session" && e.sessionId === "sess-123")).toBe(true);
    expect(events.some((e) => e.type === "log" && e.content === "Writing code...")).toBe(true);

    const toolUseEvent = events.find((e) => e.type === "tool_use");
    expect(toolUseEvent).toBeDefined();
    expect(toolUseEvent.toolUse.toolName).toBe("edit_file");
    expect(toolUseEvent.toolUse.toolId).toBe("call-99");
    expect(toolUseEvent.toolUse.parameters).toEqual({ path: "index.ts" });

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent.toolResult.toolId).toBe("call-99");
    expect(toolResultEvent.toolResult.output).toBe("Success");
    expect(toolResultEvent.toolResult.status).toBe("success");

    expect(events.some((e) => e.type === "status" && e.content === "Running checks")).toBe(true);
    expect(
      events.some((e) => e.type === "status" && e.content === "Task completed successfully")
    ).toBe(true);
    expect(events.some((e) => e.type === "error" && e.content === "Something failed")).toBe(true);
    expect(events.some((e) => e.type === "complete" && e.exitCode === 0)).toBe(true);
  });
});
