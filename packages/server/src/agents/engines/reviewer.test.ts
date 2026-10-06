import { afterEach, describe, expect, mock, test } from "bun:test";
import { PERSONA_LABELS, runPersonaReview } from "./reviewer";

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
    const mockSpawn = mock().mockImplementation((cmd: string[], options?: any) => {
      if (cmd[0] === "git") {
        return {
          stdout: new Blob(["+ const a = 1;"]).stream(),
          stderr: new Blob([""]).stream(),
          exited: Promise.resolve(0),
        };
      }

      if (cmd[0] === "gemini") {
        expect(options.env).toBeDefined();
        expect(options.env.GEMINI_API_KEY).toBe("test-gemini-key");
        expect(options.env.GOOGLE_GEMINI_BASE_URL).toBe("http://litellm");

        return {
          stdout: new Blob(["This is a test review\nBLOCKER: Missing typings"]).stream(),
          stderr: new Blob([""]).stream(),
          exited: Promise.resolve(0),
        };
      }
    });

    const result = await runPersonaReview({
      _spawnMock: mockSpawn,
      persona: "frontend",
      worktreePath: "/tmp/mock-worktree",
      taskTitle: "Test Task",
      taskDescription: "Test Description",
      defaultBranch: "main",
      reviewEngine: "gemini",
      reviewModel: "gemini-pro",
      litellmKey: "test-gemini-key",
      litellmBaseUrl: "http://litellm",
    });

    expect(result.persona).toBe("frontend");
    expect(result.content).toContain("This is a test review");
    expect(result.content).toContain("BLOCKER: Missing typings");
    expect(result.hasBlocker).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  test("runPersonaReview handles successful claude execution", async () => {
    const mockSpawn = mock().mockImplementation((cmd: string[], options?: any) => {
      if (cmd[0] === "git") {
        return {
          stdout: new Blob(["+ const b = 2;"]).stream(),
          stderr: new Blob([""]).stream(),
          exited: Promise.resolve(0),
        };
      }

      if (cmd[0] === "claude") {
        expect(options.env).toBeDefined();
        expect(options.env.ANTHROPIC_API_KEY).toBe("native-claude-key");

        return {
          stdout: new Blob(["All looks good\nLGTM"]).stream(),
          stderr: new Blob([""]).stream(),
          exited: Promise.resolve(0),
        };
      }
    });

    const result = await runPersonaReview({
      _spawnMock: mockSpawn,
      persona: "backend",
      worktreePath: "/tmp/mock-worktree",
      taskTitle: "Test Backend Task",
      taskDescription: "Test Description",
      defaultBranch: "main",
      reviewEngine: "claude-code",
      litellmKey: "", // Use native key fallback
      litellmBaseUrl: "",
      nativeAnthropicKey: "native-claude-key",
    });

    expect(result.persona).toBe("backend");
    expect(result.content).toContain("All looks good");
    expect(result.content).toContain("LGTM");
    expect(result.hasBlocker).toBe(false);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  test("runPersonaReview handles execution failure", async () => {
    const mockSpawn = mock().mockImplementation((cmd: string[], _options?: any) => {
      if (cmd[0] === "git") {
        return {
          stdout: new Blob(["+ const c = 3;"]).stream(),
          stderr: new Blob([""]).stream(),
          exited: Promise.resolve(0),
        };
      }

      if (cmd[0] === "claude") {
        return {
          stdout: new Blob([""]).stream(),
          stderr: new Blob(["Command failed"]).stream(),
          exited: Promise.resolve(1), // Non-zero exit code
        };
      }
    });

    const result = await runPersonaReview({
      _spawnMock: mockSpawn,
      persona: "security",
      worktreePath: "/tmp/mock-worktree",
      taskTitle: "Test Fail Task",
      taskDescription: "Test Description",
      defaultBranch: "main",
      reviewEngine: "claude-code",
      litellmKey: "test-claude-key",
      litellmBaseUrl: "http://litellm",
    });

    expect(result.persona).toBe("security");
    expect(result.content).toContain("INFO: [reviewer:claude:stderr] Command failed");
    expect(result.content).toContain(
      "BLOCKER: [reviewer] Security review failed (claude) with exit code 1"
    );
    expect(result.hasBlocker).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });
});
