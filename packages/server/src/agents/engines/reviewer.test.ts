import { describe, expect, test } from "bun:test";
import { PERSONA_LABELS, runPersonaReview } from "./reviewer";

function createMockProcess(stdoutText: string, stderrText: string, exitCode = 0) {
  return {
    stdout: new Blob([stdoutText]).stream(),
    stderr: new Blob([stderrText]).stream(),
    exited: Promise.resolve(exitCode),
  };
}

const originalSpawn = Bun.spawn;

// Need to safely mock spawn as it overlaps globally across tests in Bun
// The core issue in Bun's module mocking is causing test parallelism to bleed,
// so testing this module's integration with spawn separately manually is better suited

describe("reviewer engine", () => {
  test("PERSONA_LABELS exists", () => {
    expect(PERSONA_LABELS.frontend).toBe("Frontend");
  });

  test("runPersonaReview handles successful gemini execution", async () => {
    let passedArgs: string[] = [];
    const spawnMock = (args: string[], _options: any) => {
      passedArgs = args;
      if (args[0] === "git") {
        return createMockProcess("diff --git a/file.txt b/file.txt", "");
      }
      return createMockProcess("INFO: looks good\nWARNING: minor issue\n", "");
    };

    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "frontend",
      worktreePath: "/tmp/worktree",
      taskTitle: "Test Task",
      taskDescription: "A description",
      defaultBranch: "main",
      reviewEngine: "gemini",
      reviewModel: "gemini-2.0-pro",
      litellmKey: "key",
      litellmBaseUrl: "url",
    });

    expect(passedArgs[0]).toBe("gemini");
    expect(passedArgs).toContain("-m");
    expect(passedArgs).toContain("gemini-2.0-pro");
    expect(result.persona).toBe("frontend");
    expect(result.hasBlocker).toBe(false);
    expect(result.content).toContain("INFO: looks good");
    expect(result.content).toContain(
      "INFO: [reviewer:gemini] Running with IDE-related env removed"
    );
  });

  test("runPersonaReview handles successful claude execution", async () => {
    let passedArgs: string[] = [];
    const spawnMock = (args: string[], _options: any) => {
      passedArgs = args;
      if (args[0] === "git") {
        return createMockProcess("diff --git a/file.txt b/file.txt", "");
      }
      return createMockProcess("BLOCKER: critical security issue\n", "");
    };

    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "security",
      worktreePath: "/tmp/worktree",
      taskTitle: "Test Task",
      taskDescription: "A description",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "key",
      litellmBaseUrl: "url",
    });

    expect(passedArgs[0]).toBe("claude");
    expect(result.persona).toBe("security");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("BLOCKER: critical security issue");
  });

  test("runPersonaReview handles execution failure", async () => {
    let _passedArgs: string[] = [];
    const spawnMock = (args: string[], _options: any) => {
      _passedArgs = args;
      if (args[0] === "git") {
        return createMockProcess("diff --git a/file.txt b/file.txt", "");
      }
      return createMockProcess("", "some cli error occurred", 1);
    };

    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "backend",
      worktreePath: "/tmp/worktree",
      taskTitle: "Test Task",
      taskDescription: "A description",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "key",
      litellmBaseUrl: "url",
    });

    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("BLOCKER: [reviewer] Backend review failed");
    expect(result.content).toContain("some cli error occurred");
  });
});
