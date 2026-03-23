import { describe, it, expect, beforeEach } from "bun:test";
import { createDb } from "./index";

type Db = ReturnType<typeof createDb>;

function makeDb(): Db {
  return createDb(":memory:");
}

function seedRepo(db: Db, url = "https://github.com/test/repo.git") {
  const repo = db.repos.create({ url });
  db.repos.updateStatus(repo.id, "ready", "/path/repo.git");
  return db.repos.getById(repo.id)!;
}

describe("Repository queries", () => {
  it("creates a repo in pending status by default", () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/owner/repo.git" });
    expect(repo.status).toBe("pending");
    expect(repo.localPath).toBeNull();
  });

  it("updates status to ready with local path", () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/owner/repo.git" });
    db.repos.updateStatus(repo.id, "ready", "/some/path.git");
    const updated = db.repos.getById(repo.id)!;
    expect(updated.status).toBe("ready");
    expect(updated.localPath).toBe("/some/path.git");
  });

  it("lists all repos", () => {
    const db = makeDb();
    db.repos.create({ url: "https://github.com/a/r1.git" });
    db.repos.create({ url: "https://github.com/b/r2.git" });
    expect(db.repos.list().length).toBe(2);
  });

  it("extracts repo name from URL", () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/owner/my-project.git" });
    expect(repo.name).toBe("my-project");
  });
});

describe("Task queries", () => {
  let db: Db;
  let repoId: string;

  beforeEach(() => {
    db = makeDb();
    repoId = seedRepo(db).id;
  });

  it("creates task with backlog status", () => {
    const task = db.tasks.create({ title: "My task", repoId });
    expect(task.status).toBe("backlog");
    expect(task.title).toBe("My task");
    expect(task.description).toBe("");
    expect(task.prUrl).toBeNull();
    expect(task.branchName).toBeNull();
  });

  it("creates task with description", () => {
    const task = db.tasks.create({
      title: "Feature",
      description: "Add login page",
      repoId,
    });
    expect(task.description).toBe("Add login page");
  });

  it("creates task with engine preference", () => {
    const task = db.tasks.create({ title: "Task", repoId, engine: "claude-code" });
    expect(task.engine).toBe("claude-code");
  });

  it("lists all tasks", () => {
    db.tasks.create({ title: "Task 1", repoId });
    db.tasks.create({ title: "Task 2", repoId });
    expect(db.tasks.list().length).toBe(2);
  });

  it("lists tasks filtered by repo", () => {
    const otherRepoId = seedRepo(db, "https://github.com/other/repo.git").id;
    db.tasks.create({ title: "Mine", repoId });
    db.tasks.create({ title: "Other", repoId: otherRepoId });
    const mine = db.tasks.list(repoId);
    expect(mine.length).toBe(1);
    expect(mine[0].title).toBe("Mine");
  });

  it("updates task status", () => {
    const task = db.tasks.create({ title: "T", repoId });
    const updated = db.tasks.update(task.id, { status: "in_progress" });
    expect(updated?.status).toBe("in_progress");
    expect(db.tasks.getById(task.id)?.status).toBe("in_progress");
  });

  it("updates specific fields via updateField", () => {
    const task = db.tasks.create({ title: "T", repoId });
    db.tasks.updateField(task.id, "pr_url", "https://github.com/owner/repo/pull/1");
    const updated = db.tasks.getById(task.id)!;
    expect(updated.prUrl).toBe("https://github.com/owner/repo/pull/1");
  });

  it("updateField sets branch_name", () => {
    const task = db.tasks.create({ title: "T", repoId });
    db.tasks.updateField(task.id, "branch_name", "vibe-code/abc/my-task");
    expect(db.tasks.getById(task.id)?.branchName).toBe("vibe-code/abc/my-task");
  });

  it("deletes task", () => {
    const task = db.tasks.create({ title: "T", repoId });
    db.tasks.remove(task.id);
    expect(db.tasks.getById(task.id)).toBeNull();
  });

  it("returns null for non-existent task", () => {
    expect(db.tasks.getById("non-existent-id")).toBeNull();
  });
});

describe("AgentRun queries", () => {
  let db: Db;
  let taskId: string;

  beforeEach(() => {
    db = makeDb();
    const repoId = seedRepo(db).id;
    taskId = db.tasks.create({ title: "Task", repoId }).id;
  });

  it("creates a run in queued status", () => {
    const run = db.runs.create(taskId, "claude-code");
    expect(run.status).toBe("queued");
    expect(run.engine).toBe("claude-code");
    expect(run.taskId).toBe(taskId);
    expect(run.exitCode).toBeNull();
  });

  it("updates run status to running with started_at", () => {
    const run = db.runs.create(taskId, "claude-code");
    const now = new Date().toISOString();
    db.runs.updateStatus(run.id, "running", { started_at: now });
    const updated = db.runs.getById(run.id)!;
    expect(updated.status).toBe("running");
    expect(updated.startedAt).toBe(now);
  });

  it("updates run status to completed with exit_code", () => {
    const run = db.runs.create(taskId, "claude-code");
    db.runs.updateStatus(run.id, "completed", {
      finished_at: new Date().toISOString(),
      exit_code: 0,
    });
    const updated = db.runs.getById(run.id)!;
    expect(updated.status).toBe("completed");
    expect(updated.exitCode).toBe(0);
  });

  it("updates run status to failed with error_message", () => {
    const run = db.runs.create(taskId, "claude-code");
    db.runs.updateStatus(run.id, "failed", { error_message: "Something went wrong" });
    const updated = db.runs.getById(run.id)!;
    expect(updated.status).toBe("failed");
    expect(updated.errorMessage).toBe("Something went wrong");
  });

  it("getLatestByTask returns the most recently created run", () => {
    db.runs.create(taskId, "aider");
    const run2 = db.runs.create(taskId, "opencode");
    const latest = db.runs.getLatestByTask(taskId);
    expect(latest?.id).toBe(run2.id);
    expect(latest?.engine).toBe("opencode");
  });

  it("listByTask returns all runs for a task", () => {
    db.runs.create(taskId, "claude-code");
    db.runs.create(taskId, "aider");
    expect(db.runs.listByTask(taskId).length).toBe(2);
  });

  it("returns null for latest run of task with no runs", () => {
    expect(db.runs.getLatestByTask(taskId)).toBeNull();
  });
});

describe("AgentLog queries", () => {
  let db: Db;
  let runId: string;

  beforeEach(() => {
    db = makeDb();
    const repoId = seedRepo(db).id;
    const taskId = db.tasks.create({ title: "Task", repoId }).id;
    runId = db.runs.create(taskId, "claude-code").id;
  });

  it("creates and retrieves logs for a run", () => {
    db.logs.create(runId, "stdout", "Hello world");
    db.logs.create(runId, "stderr", "Error message");
    const logs = db.logs.listByRun(runId);
    expect(logs.length).toBe(2);
    expect(logs[0].content).toBe("Hello world");
    expect(logs[0].stream).toBe("stdout");
    expect(logs[1].stream).toBe("stderr");
  });

  it("logs are ordered by insertion (id ASC)", () => {
    db.logs.create(runId, "stdout", "first");
    db.logs.create(runId, "stdout", "second");
    db.logs.create(runId, "stdout", "third");
    const logs = db.logs.listByRun(runId);
    expect(logs[0].content).toBe("first");
    expect(logs[2].content).toBe("third");
  });

  it("returns empty array for run with no logs", () => {
    expect(db.logs.listByRun(runId).length).toBe(0);
  });

  it("supports all stream types", () => {
    db.logs.create(runId, "stdout", "out");
    db.logs.create(runId, "stderr", "err");
    db.logs.create(runId, "system", "sys");
    db.logs.create(runId, "stdin", "in");
    const logs = db.logs.listByRun(runId);
    const streams = logs.map((l) => l.stream);
    expect(streams).toContain("stdout");
    expect(streams).toContain("stderr");
    expect(streams).toContain("system");
    expect(streams).toContain("stdin");
  });
});
