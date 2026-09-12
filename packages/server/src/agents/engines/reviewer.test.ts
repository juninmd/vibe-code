import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { PERSONA_LABELS, runPersonaReview } from "./reviewer";

function createMockStream(text: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe.skip("reviewer engine", () => {
  beforeEach(() => {
    spyOn(fsPromises, "mkdtemp").mockResolvedValue("/tmp/vibe-review-123");
    spyOn(fsPromises, "writeFile").mockResolvedValue(undefined);
    spyOn(fsPromises, "rm").mockResolvedValue(undefined);
  });

  afterEach(() => {
    mock.restore();
  });

  test("PERSONA_LABELS exists", () => {
    expect(PERSONA_LABELS.frontend).toBe("Frontend");
  });

  test("runPersonaReview handles successful gemini execution", async () => {
    spyOn(Bun, "spawn").mockImplementation((args: any) => {
      if (args[0] === "git") {
        return {
          stdout: createMockStream("diff --git a/file b/file\n"),
          stderr: createMockStream(""),
          exited: Promise.resolve(0),
        } as any;
      }
      return {
        stdout: createMockStream("WARNING: Some issue\nBLOCKER: critical issue"),
        stderr: createMockStream(""),
        exited: Promise.resolve(0),
      } as any;
    });

    const result = await runPersonaReview({
      persona: "security",
      worktreePath: "/tmp/worktree",
      taskTitle: "Test task",
      taskDescription: "Description",
      defaultBranch: "main",
      reviewEngine: "gemini",
      reviewModel: "gemini-1.5-pro",
      litellmKey: "",
      litellmBaseUrl: "",
      nativeGeminiKey: "fake-key",
    });

    expect(result.persona).toBe("security");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("INFO: [reviewer:gemini]");
    expect(result.content).toContain("WARNING: Some issue");
    expect(result.content).toContain("BLOCKER: critical issue");
  });

  test("runPersonaReview handles successful claude execution", async () => {
    spyOn(Bun, "spawn").mockImplementation((args: any) => {
      if (args[0] === "git") {
        return {
          stdout: createMockStream("diff --git a/file b/file\n"),
          stderr: createMockStream(""),
          exited: Promise.resolve(0),
        } as any;
      }
      return {
        stdout: createMockStream("LGTM"),
        stderr: createMockStream(""),
        exited: Promise.resolve(0),
      } as any;
    });

    const result = await runPersonaReview({
      persona: "frontend",
      worktreePath: "/tmp/worktree",
      taskTitle: "Frontend task",
      taskDescription: "",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "litellm-key",
      litellmBaseUrl: "http://litellm",
    });

    expect(result.persona).toBe("frontend");
    expect(result.hasBlocker).toBe(false);
    expect(result.content).toBe("LGTM");
  });

  test("runPersonaReview handles execution failure", async () => {
    spyOn(Bun, "spawn").mockImplementation((args: any) => {
      if (args[0] === "git") {
        return {
          stdout: createMockStream("diff --git a/file b/file\n"),
          stderr: createMockStream(""),
          exited: Promise.resolve(0),
        } as any;
      }
      return {
        stdout: createMockStream(""),
        stderr: createMockStream("Command failed"),
        exited: Promise.resolve(1),
      } as any;
    });

    const result = await runPersonaReview({
      persona: "backend",
      worktreePath: "/tmp/worktree",
      taskTitle: "Backend task",
      taskDescription: "",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain(
      "BLOCKER: [reviewer] Backend review failed (claude) with exit code 1"
    );
  });
});
