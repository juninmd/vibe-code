import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runnerDataDir } from "../agents/runners/k8s/pod-spec";
import { GitService } from "./git-service";

describe("GitService.removeWorktree", () => {
  it("also deletes the OpenCode sessions a runner pod kept for that worktree", async () => {
    const base = await mkdtemp(join(tmpdir(), "vibe-runner-data-"));
    try {
      const git = new GitService(base);
      const wt = join(base, "workspaces", "app", "run-1");
      const other = join(base, "workspaces", "app", "run-2");
      await mkdir(wt, { recursive: true });
      await mkdir(runnerDataDir(base, wt), { recursive: true });
      await mkdir(runnerDataDir(base, other), { recursive: true });

      await git.removeWorktree(join(base, "repos", "missing.git"), wt);

      expect(existsSync(runnerDataDir(base, wt))).toBe(false);
      expect(existsSync(runnerDataDir(base, other))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
