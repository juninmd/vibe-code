import { describe, expect, it, mock, spyOn, afterEach, beforeEach } from "bun:test";
import { PERSONA_LABELS, runPersonaReview } from "./reviewer";

const originalSpawn = Bun.spawn;

describe("reviewer engine", () => {
  beforeEach(() => {
    mock.restore();
    Bun.spawn = originalSpawn;
  });

  afterEach(() => {
    mock.restore();
    Bun.spawn = originalSpawn;
  });

  it("PERSONA_LABELS exists", () => {
    expect(PERSONA_LABELS.frontend).toBe("Frontend");
  });

  it("runPersonaReview handles execution failure", async () => {
    // We override Bun.spawn using spyOn but wrap it to not leak state
    // We only mock if it matches "claude" or "gemini" or "git diff"
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((cmd: string[], opts?: any) => {
      if (cmd[0] === "git" && cmd[1] === "diff") {
         return {
           exited: Promise.resolve(0),
           stdout: new Blob(["mocked git diff"]).stream(),
           stderr: new Blob([""]).stream()
         } as any;
      }

      if (cmd[0] === "claude" || cmd[0] === "gemini") {
        return {
          stdout: new Blob([""]).stream(),
          stderr: new Blob(["error output"]).stream(),
          exited: Promise.resolve(1),
          kill: () => {},
          ref: () => {},
          unref: () => {}
        } as any;
      }

      return originalSpawn(cmd, opts);
    });

    const result = await runPersonaReview({
      persona: "frontend",
      worktreePath: "/tmp",
      taskTitle: "Test",
      taskDescription: "Desc",
      defaultBranch: "main",
      litellmKey: "",
      litellmBaseUrl: "",
    });

    expect(result.hasBlocker).toBe(true);
    expect(result.content).toContain("BLOCKER:");
    expect(result.content).toContain("error output");
    expect(result.persona).toBe("frontend");
    expect(spawnMock).toHaveBeenCalled();
  });
});
