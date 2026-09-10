import { describe, expect, it } from "vitest";
import type { AgentLog } from "@vibe-code/shared";
import { pickTaskStage } from "./task-stage";

const mkLog = (content: string, stream: AgentLog["stream"] = "stdout"): AgentLog => ({
  id: Math.random(),
  runId: "r1",
  stream,
  content,
  timestamp: new Date().toISOString(),
});

describe("pickTaskStage", () => {
  it("reports queued for queued status regardless of logs", () => {
    expect(pickTaskStage("queued", []).key).toBe("queued");
    expect(pickTaskStage("queued", [mkLog("Reading file.ts")]).key).toBe("queued");
  });

  it("reports starting_up when in_progress with no logs yet", () => {
    expect(pickTaskStage("in_progress", []).key).toBe("starting_up");
  });

  it("detects reading files from OpenCode-humanized prefix", () => {
    expect(pickTaskStage("in_progress", [mkLog("Reading src/main.ts")]).key).toBe("reading_files");
  });

  it("detects running command", () => {
    expect(pickTaskStage("in_progress", [mkLog("Running: bun test")]).key).toBe("running_command");
  });

  it("detects searching code from grep/glob prefix", () => {
    expect(pickTaskStage("in_progress", [mkLog('Searching "foo" in src')]).key).toBe(
      "searching_code"
    );
  });

  it("detects making edits", () => {
    expect(pickTaskStage("in_progress", [mkLog("Editing pkg/x.ts")]).key).toBe("making_edits");
  });

  it("detects git operations", () => {
    expect(pickTaskStage("in_progress", [mkLog("Git: commit")]).key).toBe("git_operation");
  });

  it("skips heartbeat system logs and falls back to thinking", () => {
    expect(
      pickTaskStage("in_progress", [
        mkLog("Still running... 30s", "system"),
        mkLog("heartbeat", "system"),
      ]).key
    ).toBe("thinking");
  });

  it("treats arbitrary stdout text as typing", () => {
    expect(pickTaskStage("in_progress", [mkLog("Here is the answer.")]).key).toBe("typing");
  });

  it("uses the latest meaningful log when tail has stderr noise", () => {
    expect(
      pickTaskStage("in_progress", [mkLog("Reading src/main.ts"), mkLog("some warning", "stderr")])
        .key
    ).toBe("reading_files");
  });
});
