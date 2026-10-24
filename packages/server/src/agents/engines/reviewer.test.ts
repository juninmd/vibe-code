import { afterEach, describe, expect, mock, test } from "bun:test";
import { PERSONA_LABELS, runPersonaReview } from "./reviewer";

const originalSpawn = Bun.spawn;

describe("reviewer engine", () => {
  afterEach(() => {
    mock.restore();
  });

  test("PERSONA_LABELS exists", () => {
    expect(PERSONA_LABELS.frontend).toBe("Frontend");
  });

  test("runPersonaReview handles successful gemini execution", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        return {
          stdout: new Blob(["diff data"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: new Blob(["INFO: some info\nBLOCKER: gemini says blocked"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "frontend",
      worktreePath: "/tmp/worktree",
      taskTitle: "Add React UI",
      taskDescription: "Desc",
      defaultBranch: "main",
      reviewEngine: "gemini",
      reviewModel: "gemini-1.5-pro",
      litellmKey: "",
      litellmBaseUrl: "",
      nativeGeminiKey: "gemini-key",
    });

    expect(result.persona).toBe("frontend");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("BLOCKER: gemini says blocked");
    expect(result.content).toContain(
      "INFO: [reviewer:gemini] Running with IDE-related env removed"
    );
  });

  test("runPersonaReview handles successful claude execution", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        return {
          stdout: new Blob(["diff data"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: new Blob(["LGTM\nWARNING: consider changing this"]).stream(),
        stderr: new Blob(["stderr warning"]).stream(),
        exited: Promise.resolve(0),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "backend",
      worktreePath: "/tmp/worktree",
      taskTitle: "Add API",
      taskDescription: "Desc",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "litellm-key",
      litellmBaseUrl: "http://proxy",
      nativeAnthropicKey: "anthropic-key",
    });

    expect(result.persona).toBe("backend");
    expect(result.hasBlocker).toBe(false);
    expect(result.content).toContain("WARNING: consider changing this");
    expect(result.content).toContain("INFO: [reviewer:claude:stderr] stderr warning");
  });

  test("runPersonaReview handles execution failure", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        return {
          stdout: new Blob(["diff data"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: new Blob(["some output"]).stream(),
        stderr: new Blob(["fatal error occurred"]).stream(),
        exited: Promise.resolve(1),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "security",
      worktreePath: "/tmp/worktree",
      taskTitle: "Add Auth",
      taskDescription: "Desc",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.persona).toBe("security");
    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain(
      "BLOCKER: [reviewer] Security review failed (claude) with exit code 1: fatal error occurred"
    );
  });

  test("runPersonaReview handles exception during run", async () => {
    const _spawnMock = mock((_args, _options) => {
      throw new Error("Spawn crashed");
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "docs",
      worktreePath: "/tmp/worktree",
      taskTitle: "Add Docs",
      taskDescription: "Desc",
      defaultBranch: "main",
    } as any);

    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain(
      "BLOCKER: [reviewer] Docs review failed (claude): Spawn crashed"
    );
  });

  test("runPersonaReview truncates large diffs", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        const largeDiff = "a".repeat(15000);
        return {
          stdout: new Blob([largeDiff]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: new Blob(["LGTM"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "quality",
      worktreePath: "/tmp/worktree",
      taskTitle: "Large PR",
      taskDescription: "Desc",
      defaultBranch: "main",
    } as any);

    expect(result.hasBlocker).toBe(false);
  });

  test("runPersonaReview getWorktreeDiff error handling", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        throw new Error("git crashed");
      }
      return {
        stdout: new Blob(["LGTM"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "frontend",
      worktreePath: "/tmp/worktree",
      taskTitle: "Add React UI",
      taskDescription: "Desc",
      defaultBranch: "main",
      reviewEngine: "gemini",
      reviewModel: "gemini-1.5-pro",
      litellmKey: "",
      litellmBaseUrl: "",
      nativeGeminiKey: "gemini-key",
    });

    expect(result.hasBlocker).toBe(false);
  });

  test("runPersonaReview handles claude with fallback native key", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        return {
          stdout: new Blob(["diff data"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: new Blob(["LGTM"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "backend",
      worktreePath: "/tmp/worktree",
      taskTitle: "Add API",
      taskDescription: "Desc",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "",
      litellmBaseUrl: "",
      nativeAnthropicKey: "native-anthropic-key",
    });

    expect(result.persona).toBe("backend");
    const env = _spawnMock.mock.calls[1][1].env;
    expect(env.ANTHROPIC_API_KEY).toBe("native-anthropic-key");
  });

  test("runPersonaReview handles missing git diff correctly", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        throw new Error("git execution failed");
      }
      return {
        stdout: new Blob(["LGTM"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "frontend",
      worktreePath: "/tmp/fake",
      taskTitle: "Test",
      taskDescription: "Desc",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.hasBlocker).toBe(false);
  });

  test("runPersonaReview returns empty output when child produces nothing", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        return {
          stdout: new Blob(["diff data"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: new Blob([]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "frontend",
      worktreePath: "/tmp/fake",
      taskTitle: "Test",
      taskDescription: "Desc",
      defaultBranch: "main",
      reviewEngine: "claude",
      litellmKey: "",
      litellmBaseUrl: "",
    } as any);

    expect(result.content).toBe("LGTM");
  });

  test("runPersonaReview handles gemini with litellmKey", async () => {
    const _spawnMock = mock((args, _options) => {
      if (args[0] === "git") {
        return {
          stdout: new Blob(["diff data"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: new Blob(["LGTM"]).stream(),
        stderr: new Blob([]).stream(),
        exited: Promise.resolve(0),
      };
    });

    const result = await runPersonaReview({
      _spawnMock,
      persona: "frontend",
      worktreePath: "/tmp/fake",
      taskTitle: "Test",
      taskDescription: "Desc",
      defaultBranch: "main",
      reviewEngine: "gemini",
      litellmKey: "litellm-key",
      litellmBaseUrl: "http://proxy",
    } as any);

    expect(result.content).toContain(
      "INFO: [reviewer:gemini] Running with IDE-related env removed"
    );
    const env = _spawnMock.mock.calls[1][1].env;
    expect(env.GEMINI_API_KEY).toBe("litellm-key");
    expect(env.GOOGLE_GEMINI_BASE_URL).toBe("http://proxy");
  });
});
