import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { PERSONA_LABELS, runPersonaReview } from "./reviewer";

describe("reviewer engine", () => {
  afterEach(() => {
    mock.restore();
  });

  test("PERSONA_LABELS exists", () => {
    expect(PERSONA_LABELS.frontend).toBe("Frontend");
  });

  async function executeReviewTest(
    persona: any,
    stdoutData: string,
    stderrData: string,
    exitCode: number,
    reviewEngine = "claude"
  ) {
    spyOn(fsPromises, "mkdtemp").mockResolvedValue("/tmp/vibe-review-test");
    spyOn(fsPromises, "writeFile").mockResolvedValue(undefined);
    spyOn(fsPromises, "rm").mockResolvedValue(undefined);

    const _mockSpawn = mock().mockImplementation((args: any) => {
      if (args[0] === "git") {
        return {
          stdout: new Blob(["diff --git a/file b/file\n"]).stream(),
          stderr: new Blob([""]).stream(),
          exited: Promise.resolve(0),
        } as any;
      }
      return {
        stdout: new Blob([stdoutData]).stream(),
        stderr: new Blob([stderrData]).stream(),
        exited: Promise.resolve(exitCode),
      } as any;
    });

    return runPersonaReview({
      persona,
      worktreePath: "/tmp/worktree",
      taskTitle: "Test task",
      taskDescription: "Description",
      defaultBranch: "main",
      reviewEngine,
      reviewModel: reviewEngine === "gemini" ? "gemini-1.5-pro" : undefined,
      litellmKey: reviewEngine === "claude" ? "litellm-key" : "",
      litellmBaseUrl: reviewEngine === "claude" ? "http://litellm" : "",
      nativeGeminiKey: reviewEngine === "gemini" ? "fake-key" : undefined,
      _spawnMock: _mockSpawn,
    });
  }

  test("runPersonaReview handles successful gemini execution", async () => {
    const result = await executeReviewTest(
      "security",
      "WARNING: Some issue\nBLOCKER: critical issue\n",
      "",
      0,
      "gemini"
    );
    expect(result.persona).toBe("security");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("INFO: [reviewer:gemini]");
    expect(result.content).toContain("WARNING: Some issue");
    expect(result.content).toContain("BLOCKER: critical issue");
  });

  test("runPersonaReview handles successful claude execution", async () => {
    const result = await executeReviewTest("frontend", "LGTM\n", "", 0, "claude");
    expect(result.persona).toBe("frontend");
    expect(result.hasBlocker).toBe(false);
    expect(result.content).toBe("LGTM");
  });

  test("runPersonaReview handles execution failure", async () => {
    const result = await executeReviewTest("backend", "", "Command failed\n", 1, "claude");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain(
      "BLOCKER: [reviewer] Backend review failed (claude) with exit code 1"
    );
  });
});
