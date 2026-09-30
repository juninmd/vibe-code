import { afterEach, describe, expect, mock, test } from "bun:test";
import { PERSONA_LABELS, runPersonaReview } from "./reviewer";

// Need to safely mock spawn as it overlaps globally across tests in Bun
// The core issue in Bun's module mocking is causing test parallelism to bleed,
// so testing this module's integration with spawn separately manually is better suited
describe("reviewer engine", () => {
  const originalSpawn = Bun.spawn;

  afterEach(() => {
    mock.restore();
    Bun.spawn = originalSpawn;
  });

  test("PERSONA_LABELS exists", () => {
    expect(PERSONA_LABELS.frontend).toBe("Frontend");
  });

  const getSpawnMock = (
    stdoutContent: string,
    stderrContent: string = "",
    exitCode: number = 0
  ) => {
    return mock((args: string[], _options: any) => {
      // Mock for `git diff`
      if (args[0] === "git" && args[1] === "diff") {
        return {
          stdout: new Blob(["dummy diff"]).stream(),
          stderr: new Blob([""]).stream(),
          exited: Promise.resolve(0),
        };
      }

      // Mock for review engines
      return {
        stdout: new Blob([stdoutContent]).stream(),
        stderr: new Blob([stderrContent]).stream(),
        exited: Promise.resolve(exitCode),
      };
    });
  };

  test("runPersonaReview handles successful gemini execution", async () => {
    const spawnMock = getSpawnMock("Line 1\nLine 2\n");
    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "frontend",
      worktreePath: "/tmp",
      taskTitle: "task",
      taskDescription: "desc",
      defaultBranch: "main",
      reviewEngine: "gemini",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.persona).toBe("frontend");
    expect(result.hasBlocker).toBe(false);
    expect(result.content).toContain(
      "INFO: [reviewer:gemini] Running with IDE-related env removed"
    );
    expect(result.content).toContain("Line 1");
    expect(result.content).toContain("Line 2");
  });

  test("runPersonaReview handles successful claude execution", async () => {
    const spawnMock = getSpawnMock("Some block\nBLOCKER: Oh no\n");
    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "backend",
      worktreePath: "/tmp",
      taskTitle: "task",
      taskDescription: "desc",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.persona).toBe("backend");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("Some block");
    expect(result.content).toContain("BLOCKER: Oh no");
  });

  test("runPersonaReview handles execution failure", async () => {
    const spawnMock = getSpawnMock("Standard output", "Fatal error", 1);
    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "security",
      worktreePath: "/tmp",
      taskTitle: "task",
      taskDescription: "desc",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.persona).toBe("security");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("Standard output");
    expect(result.content).toContain("INFO: [reviewer:claude:stderr] Fatal error");
    expect(result.content).toContain(
      "BLOCKER: [reviewer] Security review failed (claude) with exit code 1: Fatal error"
    );
  });
});
