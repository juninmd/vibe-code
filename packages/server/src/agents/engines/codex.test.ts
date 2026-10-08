import { beforeEach, describe, expect, it, mock } from "bun:test";
import { CodexEngine } from "./codex";

describe("CodexEngine", () => {
  let engine: CodexEngine;

  beforeEach(() => {
    engine = new CodexEngine();
    mock.restore();
  });

  it("isAvailable returns true on success", async () => {
    (Bun as any).spawn = mock().mockImplementation(() => {
      return { exited: Promise.resolve(), exitCode: 0 };
    });
    expect(await engine.isAvailable()).toBe(true);
  });

  it("isAvailable returns false on failure", async () => {
    (Bun as any).spawn = mock().mockImplementation(() => {
      return { exited: Promise.resolve(), exitCode: 1 };
    });
    expect(await engine.isAvailable()).toBe(false);
  });

  it("getVersion returns version string", async () => {
    (Bun as any).spawn = mock().mockImplementation(() => {
      return {
        exited: Promise.resolve(),
        exitCode: 0,
        stdout: new Blob(["codex 1.0.0\n"]).stream(),
      };
    });
    expect(await engine.getVersion()).toBe("codex 1.0.0");
  });

  it("getVersion returns null on non-zero exit code", async () => {
    (Bun as any).spawn = mock().mockImplementation(() => {
      return {
        exited: Promise.resolve(),
        exitCode: 1,
      };
    });
    expect(await engine.getVersion()).toBe(null);
  });

  it("abort kills the process and deletes from map", () => {
    const killMock = mock();
    (engine as any).processes.set("run1", { kill: killMock, pid: 123 });
    engine.abort("run1");
    expect(killMock).toHaveBeenCalled();
    expect((engine as any).processes.has("run1")).toBe(false);
  });

  it("sendInput writes to stdin if available", () => {
    let written = "";
    let flushed = false;
    const processMock = {
      stdin: {
        write: (data: string) => (written += data),
        flush: () => (flushed = true),
      },
    };
    (engine as any).processes.set("run1", processMock);

    expect(engine.sendInput("run1", "hello")).toBe(true);
    expect(written).toBe("hello\n");
    expect(flushed).toBe(true);
  });

  it("sendInput returns false if process or stdin missing", () => {
    expect(engine.sendInput("unknown", "hello")).toBe(false);

    (engine as any).processes.set("run2", {});
    expect(engine.sendInput("run2", "hello")).toBe(false);
  });
});
