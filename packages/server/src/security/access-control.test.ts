import { beforeEach, describe, expect, it } from "bun:test";
import { createDb } from "../db";
import {
  type AccessContext,
  enforceRepoAccess,
  enforceRunAccess,
  enforceTaskAccess,
  sanitizeRunForExternal,
} from "./access-control";

describe("access-control", () => {
  const db = createDb(":memory:");
  let context: AccessContext;
  let repoId = "";
  let taskId = "";
  let runId = "";

  beforeEach(() => {
    db.raw.exec("DELETE FROM agent_logs");
    db.raw.exec("DELETE FROM agent_runs");
    db.raw.exec("DELETE FROM tasks");
    db.raw.exec("DELETE FROM repositories");
    db.raw.exec("DELETE FROM settings");

    const repo = db.repos.create({ url: `https://github.com/org/repo-${Date.now()}.git` });
    repoId = repo.id;
    const task = db.tasks.create({ title: "Task", repoId: repo.id });
    taskId = task.id;
    const run = db.runs.create(task.id, "claude-code");
    db.runs.updateStatus(run.id, "running", { worktree_path: "/tmp/worktree" });
    runId = run.id;

    context = {
      authEnabled: true,
      userId: "alice",
      workspaceId: "ws-1",
    };
  });

  it("denies repo access when repo is not mapped and legacy fallback is off", () => {
    const decision = enforceRepoAccess(db, context, repoId);
    expect(decision?.status).toBe(403);
    expect(decision?.code).toBe("repo_forbidden");
  });

  it("allows access when repo is mapped to workspace", () => {
    db.settings.set(`repo_workspace:${repoId}`, "ws-1");
    const decision = enforceRepoAccess(db, context, repoId);
    expect(decision).toBeNull();
  });

  it("enforces task and run ownership via repo mapping", () => {
    const deniedTask = enforceTaskAccess(db, context, taskId);
    const deniedRun = enforceRunAccess(db, context, runId);
    expect(deniedTask?.code).toBe("repo_forbidden");
    expect(deniedRun?.code).toBe("repo_forbidden");

    db.settings.set(`repo_workspace:${repoId}`, "ws-1");
    expect(enforceTaskAccess(db, context, taskId)).toBeNull();
    expect(enforceRunAccess(db, context, runId)).toBeNull();
  });

  it("redacts worktree path from external run serialization by default", () => {
    db.settings.set(`repo_workspace:${repoId}`, "ws-1");
    const run = db.runs.getById(runId);
    expect(run).not.toBeNull();
    if (!run) return;

    const redacted = sanitizeRunForExternal(db, run);
    expect(redacted.worktreePath).toBeNull();
  });
});
