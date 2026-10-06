import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db";
import { cleanupWorkspaces, listProtectedWorkspaces } from "./workspace-cleanup";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "ws-cleanup-"));
  dirs.push(root);
  const db = createDb(":memory:");
  const repo = db.repos.create({ url: "https://github.com/test/repo.git" });
  const make = async (repoName: string, runId: string) => {
    const path = join(root, repoName, runId);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "wip.txt"), "uncommitted work");
    return path;
  };
  const task = (title: string, status?: string) => {
    const created = db.tasks.create({ title, description: "", repoId: repo.id });
    if (status) db.tasks.updateField(created.id, "status", status);
    return created;
  };
  const terminalRun = (taskId: string, worktree: string) => {
    const run = db.runs.create(taskId, "claude-code");
    db.runs.updateStatus(run.id, "completed", {
      worktree_path: worktree,
      current_status: "terminal",
    });
    return run;
  };
  const headlessRun = (taskId: string, worktree: string) => {
    const run = db.runs.create(taskId, "claude-code");
    db.runs.updateStatus(run.id, "completed", { worktree_path: worktree });
    return run;
  };
  return { root, db, make, task, terminalRun, headlessRun };
}

describe("cleanupWorkspaces", () => {
  it("keeps the workspaces of unfinished terminal tasks and removes the rest", async () => {
    const { root, db, make, task, terminalRun, headlessRun } = await setup();
    const live = await make("app", "terminal-active");
    const reviewing = await make("app", "terminal-review");
    const finished = await make("app", "terminal-done");
    const stale = await make("app", "headless-old");
    const orphanRepo = await make("gone", "headless-other");

    terminalRun(task("active", "in_progress").id, live);
    terminalRun(task("review", "review").id, reviewing);
    terminalRun(task("done", "done").id, finished);
    headlessRun(task("headless").id, stale);

    const result = await cleanupWorkspaces(db, root);

    expect(result).toEqual({ removed: 3, kept: 2 });
    expect(existsSync(join(live, "wip.txt"))).toBe(true);
    expect(existsSync(join(reviewing, "wip.txt"))).toBe(true);
    expect(existsSync(finished)).toBe(false);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(orphanRepo)).toBe(false);
    expect(existsSync(join(root, "gone"))).toBe(false);
  });

  it("does nothing when the workspaces directory does not exist", async () => {
    const { db } = await setup();
    expect(await cleanupWorkspaces(db, "/definitely/not/here")).toEqual({ removed: 0, kept: 0 });
  });

  it("only protects terminal runs", async () => {
    const { db, make, task, headlessRun } = await setup();
    headlessRun(task("plain", "in_progress").id, await make("app", "r1"));
    expect(listProtectedWorkspaces(db).size).toBe(0);
  });
});
