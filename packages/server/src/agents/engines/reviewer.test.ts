import { afterEach, describe, expect, mock, test } from "bun:test";
import { PERSONA_LABELS } from "./reviewer";

const originalSpawn = Bun.spawn;

// Need to safely mock spawn as it overlaps globally across tests in Bun
// The core issue in Bun's module mocking is causing test parallelism to bleed,
// so testing this module's integration with spawn separately manually is better suited
describe("reviewer engine", () => {
  afterEach(() => {
    mock.restore();
  });

  test("PERSONA_LABELS exists", () => {
    expect(PERSONA_LABELS.frontend).toBe("Frontend");
  });

  test("runPersonaReview handles successful gemini execution", async () => {
    const { runPersonaReview } = await import("./reviewer");
    const mockProc = {
      stdout: new Blob(["BLOCKER: found issue\nINFO: minor"]).stream(),
      stderr: new Blob([]).stream(),
      exited: Promise.resolve(0),
    };
    const spawnMock = mock()
      .mockReturnValueOnce({
        stdout: new Blob(["dummy diff"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      })
      .mockReturnValueOnce(mockProc);

    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "frontend",
      worktreePath: "/tmp/wt",
      taskTitle: "Fix frontend",
      taskDescription: "",
      defaultBranch: "main",
      reviewEngine: "gemini",
      reviewModel: "gemini-1.5-pro",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.persona).toBe("frontend");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("BLOCKER: found issue");
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1][0]).toEqual([
      "gemini",
      "-m",
      "gemini-1.5-pro",
      "-p",
      expect.stringContaining("@"),
    ]);
  });

  test("runPersonaReview handles successful claude execution", async () => {
    const { runPersonaReview } = await import("./reviewer");
    const mockProc = {
      stdout: new Blob(["LGTM"]).stream(),
      stderr: new Blob(["INFO: [reviewer:claude:stderr] using proxy"]).stream(),
      exited: Promise.resolve(0),
    };
    const spawnMock = mock()
      .mockReturnValueOnce({
        stdout: new Blob(["dummy diff"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      })
      .mockReturnValueOnce(mockProc);

    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "backend",
      worktreePath: "/tmp/wt",
      taskTitle: "Fix backend",
      taskDescription: "Does things",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "proxy-key",
      litellmBaseUrl: "http://proxy",
    });

    expect(result.persona).toBe("backend");
    expect(result.hasBlocker).toBe(false);
    expect(result.content).toContain("LGTM");
    expect(result.content).toContain("INFO: [reviewer:claude:stderr] using proxy");
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1][0]).toEqual([
      "claude",
      "--print",
      "-p",
      expect.stringContaining("@"),
    ]);
  });

  test("runPersonaReview handles execution failure", async () => {
    const { runPersonaReview } = await import("./reviewer");
    const mockProc = {
      stdout: new Blob(["Partial output"]).stream(),
      stderr: new Blob(["Command failed"]).stream(),
      exited: Promise.resolve(1),
    };
    const spawnMock = mock()
      .mockReturnValueOnce({
        stdout: new Blob(["dummy diff"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      })
      .mockReturnValueOnce(mockProc);

    const result = await runPersonaReview({
      _spawnMock: spawnMock,
      persona: "security",
      worktreePath: "/tmp/wt",
      taskTitle: "Fix security",
      taskDescription: "",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.persona).toBe("security");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain(
      "BLOCKER: [reviewer] Security review failed (claude) with exit code 1: Command failed"
    );
  });
});
