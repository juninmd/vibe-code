import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as cp from "node:child_process";
import { CopilotEngine } from "./copilot";

describe("CopilotEngine", () => {
  let engine: CopilotEngine;

  beforeEach(() => {
    engine = new CopilotEngine();
    mock.restore();
    delete process.env.COPILOT_CLI_PATH;
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  it("isAvailable returns true on success", async () => {
    spyOn(cp, "execSync").mockReturnValue("/tmp/npm/root");
    (Bun as any).spawn = mock().mockImplementation(() => {
      return { exited: Promise.resolve(), exitCode: 0 };
    });
    expect(await engine.isAvailable()).toBe(true);
  });

  it("isAvailable returns false on failure", async () => {
    spyOn(cp, "execSync").mockReturnValue("/tmp/npm/root");
    (Bun as any).spawn = mock().mockImplementation(() => {
      return { exited: Promise.resolve(), exitCode: 1 };
    });
    expect(await engine.isAvailable()).toBe(false);
  });

  it("getVersion returns version string", async () => {
    spyOn(cp, "execSync").mockReturnValue("/tmp/npm/root");
    (Bun as any).spawn = mock().mockImplementation(() => {
      return {
        exited: Promise.resolve(),
        exitCode: 0,
        stdout: new Blob(["copilot 1.2.3\n"]).stream(),
      };
    });
    expect(await engine.getVersion()).toBe("copilot 1.2.3");
  });

  it("getVersion returns null on non-zero exit code", async () => {
    spyOn(cp, "execSync").mockReturnValue("/tmp/npm/root");
    (Bun as any).spawn = mock().mockImplementation(() => {
      return {
        exited: Promise.resolve(),
        exitCode: 1,
      };
    });
    expect(await engine.getVersion()).toBe(null);
  });

  it("getSetupIssue returns error if not available", async () => {
    engine.isAvailable = async () => false;
    expect(await engine.getSetupIssue()).toContain("Copilot CLI não instalado");
  });

  it("getSetupIssue returns error if no token is configured", async () => {
    engine.isAvailable = async () => true;
    expect(await engine.getSetupIssue()).toContain("COPILOT_GITHUB_TOKEN não configurado");
  });

  it("getSetupIssue returns null if available and token exists", async () => {
    engine.isAvailable = async () => true;
    process.env.GH_TOKEN = "xyz";
    expect(await engine.getSetupIssue()).toBe(null);
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
