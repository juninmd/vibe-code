import { describe, expect, it } from "bun:test";
import { OpenCodeEngine } from "./opencode";

class CommandInspectingOpenCodeEngine extends OpenCodeEngine {
  getCommand(model: string, workdir: string, resumeSessionId?: string): string[] {
    return this.buildCommand(model, workdir, resumeSessionId);
  }

  getStdinModeForTest(): "pipe" | "ignore" {
    return this.getStdinMode();
  }
}

describe("OpenCodeEngine.buildCommand", () => {
  it("passes correct base arguments without prompt (prompt sent via stdin)", () => {
    const engine = new CommandInspectingOpenCodeEngine();
    const command = engine.getCommand("opencode/minimax-m2.5-free", "/tmp/workdir");

    expect(command).toEqual([
      "opencode",
      "acp",
      "--model",
      "opencode/minimax-m2.5-free",
      "--dir",
      "/tmp/workdir",
    ]);
    expect(command).not.toContain("--file");
    expect(command).not.toContain("--prompt");
  });

  it("includes --session when resumeSessionId is provided", () => {
    const engine = new CommandInspectingOpenCodeEngine();
    const command = engine.getCommand("opencode/minimax-m2.5-free", "/tmp/workdir", "session-123");

    expect(command).toContain("--session");
    expect(command).toContain("session-123");
  });

  it("uses pipe stdin mode on all platforms (stdin is closed immediately on Windows)", () => {
    const engine = new CommandInspectingOpenCodeEngine();
    expect(engine.getStdinModeForTest()).toBe("pipe");
  });
});
