import { describe, expect, it, mock, spyOn, afterEach } from "bun:test";
import { KimiEngine } from "./kimi";

describe("KimiEngine", () => {
  let engine: KimiEngine;

  afterEach(() => {
    mock.restore();
    engine = new KimiEngine();
  });

  it("isAvailable returns true when command succeeds", async () => {
    engine = new KimiEngine();
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
      exitCode: 0,
    } as any);
    const result = await engine.isAvailable();
    expect(result).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0][0]).toEqual(["kimi", "--version"]);
  });

  it("isAvailable returns false when command fails", async () => {
    engine = new KimiEngine();
    spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(1),
      exitCode: 1,
    } as any);
    const result = await engine.isAvailable();
    expect(result).toBe(false);
  });

  it("isAvailable returns false on throw", async () => {
    engine = new KimiEngine();
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const result = await engine.isAvailable();
    expect(result).toBe(false);
  });

  it("getVersion returns version string on success", async () => {
    engine = new KimiEngine();
    spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
      exitCode: 0,
      stdout: new Blob(["kimi 1.0.0\n"]).stream(),
    } as any);
    const result = await engine.getVersion();
    expect(result).toBe("kimi 1.0.0");
  });

  it("getVersion returns null on non-zero exit code", async () => {
    engine = new KimiEngine();
    spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(1),
      exitCode: 1,
      stdout: new Blob([]).stream(),
    } as any);
    const result = await engine.getVersion();
    expect(result).toBe(null);
  });

  it("getVersion returns null on throw", async () => {
    engine = new KimiEngine();
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const result = await engine.getVersion();
    expect(result).toBe(null);
  });

  it("listModels returns list", async () => {
    engine = new KimiEngine();
    const models = await engine.listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  it("abort kills the process", () => {
    engine = new KimiEngine();
    const killSpy = mock();
    (engine as any).processes.set("test-run", { kill: killSpy });
    engine.abort("test-run");
    expect(killSpy).toHaveBeenCalled();
    expect((engine as any).processes.has("test-run")).toBe(false);
  });

  it("sendInput writes to stdin", () => {
    engine = new KimiEngine();
    const writeSpy = mock();
    const flushSpy = mock();
    (engine as any).processes.set("test-run", {
      stdin: { write: writeSpy, flush: flushSpy }
    });
    const result = engine.sendInput("test-run", "hello");
    expect(result).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith("hello\n");
    expect(flushSpy).toHaveBeenCalled();
  });

  it("sendInput returns false if proc missing", () => {
    engine = new KimiEngine();
    const result = engine.sendInput("test-run", "hello");
    expect(result).toBe(false);
  });

  it("execute runs the engine", async () => {
    engine = new KimiEngine();

    let spawnCalled = false;
    let spawnArgs: any;
    const procMock = {
      stdout: new Blob(['{"type":"log","log":"test"}']).stream(),
      stderr: new Blob([]).stream(),
      exited: Promise.resolve(0),
      exitCode: 0,
      kill: mock()
    };

    spyOn(Bun, "spawn").mockImplementation((args, options) => {
      spawnCalled = true;
      spawnArgs = { args, options };
      return procMock as any;
    });

    const opts = { runId: "test-run", signal: new AbortController().signal };
    const generator = engine.execute("test prompt", "/tmp", opts as any);

    const events = [];
    for await (const event of generator) {
      events.push(event);
    }

    expect(spawnCalled).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("log");

    expect(spawnArgs.args[0]).toBe("kimi");
    expect(spawnArgs.args[1]).toBe("acp");
  });
});
