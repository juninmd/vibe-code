import { afterEach, describe, expect, mock, test } from "bun:test";
import { PERSONA_LABELS, runPersonaReview } from "./reviewer";

describe("reviewer engine", () => {
  afterEach(() => {
    mock.restore();
  });

  test("PERSONA_LABELS exists", () => {
    expect(PERSONA_LABELS.frontend).toBe("Frontend");
  });

  test("runPersonaReview handles successful gemini execution", async () => {
    const mockSpawn = mock(() => ({
      stdout: new Blob(["INFO: some info\nBLOCKER: big error\n"]).stream(),
      stderr: new Blob([""]).stream(),
      exited: Promise.resolve(0),
    }));

    const result = await runPersonaReview({
      _spawnMock: mockSpawn as any,
      persona: "frontend",
      worktreePath: "/tmp",
      taskTitle: "Test Task",
      taskDescription: "Test Description",
      defaultBranch: "main",
      reviewEngine: "gemini",
      litellmKey: "sk-lite",
      litellmBaseUrl: "http://lite",
    });

    expect(result.persona).toBe("frontend");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("INFO: some info");
    expect(result.content).toContain("BLOCKER: big error");
  });

  test("runPersonaReview handles successful claude execution", async () => {
    const mockSpawn = mock(() => ({
      stdout: new Blob(["LGTM\n"]).stream(),
      stderr: new Blob([""]).stream(),
      exited: Promise.resolve(0),
    }));

    const result = await runPersonaReview({
      _spawnMock: mockSpawn as any,
      persona: "backend",
      worktreePath: "/tmp",
      taskTitle: "Test Task",
      taskDescription: "Test Description",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "sk-lite",
      litellmBaseUrl: "http://lite",
    });

    expect(result.persona).toBe("backend");
    expect(result.hasBlocker).toBe(false);
    expect(result.content).toContain("LGTM");
  });

  test("runPersonaReview handles execution failure", async () => {
    const mockSpawn = mock(() => ({
      stdout: new Blob([""]).stream(),
      stderr: new Blob(["Fatal error\n"]).stream(),
      exited: Promise.resolve(1),
    }));

    const result = await runPersonaReview({
      _spawnMock: mockSpawn as any,
      persona: "security",
      worktreePath: "/tmp",
      taskTitle: "Test Task",
      taskDescription: "Test Description",
      defaultBranch: "main",
      reviewEngine: "gemini",
      litellmKey: "sk-lite",
      litellmBaseUrl: "http://lite",
    });

    expect(result.persona).toBe("security");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("BLOCKER: [reviewer] Security review failed (gemini) with exit code 1: Fatal error");
  });
});
