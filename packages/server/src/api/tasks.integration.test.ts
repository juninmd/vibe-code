/**
 * Integration tests for the tasks API router.
 * Uses a real SQLite :memory: database and stubbed Orchestrator/GitService.
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Orchestrator } from "../agents/orchestrator";
import { createDb } from "../db";
import type { GitService } from "../git/git-service";
import { createTasksRouter } from "./tasks";

type Db = ReturnType<typeof createDb>;

function makeDb(): Db {
  return createDb(":memory:");
}

function makeOrchestrator(): Orchestrator {
  return {
    launch: async () => ({
      id: "run-1",
      taskId: "t",
      engine: "claude-code",
      status: "queued",
      currentStatus: null,
      worktreePath: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    }),
    cancel: async () => {},
    retry: async (task: any) => ({
      id: "run-2",
      taskId: task.id,
      engine: "claude-code",
      status: "queued",
      currentStatus: null,
      worktreePath: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    }),
    sendInput: () => {},
    activeCount: 0,
  } as unknown as Orchestrator;
}

function makeGit(): GitService {
  return {} as unknown as GitService;
}

function seedRepo(db: Db) {
  const repo = db.repos.create({ url: "https://github.com/test/repo.git" });
  db.repos.updateStatus(repo.id, "ready", "/tmp/repo.git");
  const result = db.repos.getById(repo.id);
  if (!result) throw new Error("Repo not found");
  return result;
}

function buildApp(db: Db) {
  const app = new Hono();
  app.route("/api/tasks", createTasksRouter(db, makeOrchestrator(), makeGit()));
  return app;
}

describe("GET /api/tasks", () => {
  it("returns empty data array when no tasks exist", async () => {
    const app = buildApp(makeDb());
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("returns tasks list", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    db.tasks.create({ title: "Task A", repoId: repo.id });
    db.tasks.create({ title: "Task B", repoId: repo.id });

    const res = await buildApp(db).request("/api/tasks");
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.map((t: any) => t.title)).toContain("Task A");
    expect(body.data.map((t: any) => t.title)).toContain("Task B");
  });

  it("filters tasks by repo_id", async () => {
    const db = makeDb();
    const repo1 = seedRepo(db);
    const repo2 = db.repos.create({ url: "https://github.com/other/repo.git" });
    db.tasks.create({ title: "Mine", repoId: repo1.id });
    db.tasks.create({ title: "Other", repoId: repo2.id });

    const res = await buildApp(db).request(`/api/tasks?repo_id=${repo1.id}`);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Mine");
  });

  it("returns aggregated polling payload with tasks and focused task/log deltas", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "Polling task", repoId: repo.id });
    const run = db.runs.create(task.id, "opencode");
    db.runs.updateStatus(run.id, "running", { current_status: "Working..." });
    db.logs.create(run.id, "stdout", "first line");
    const second = db.logs.create(run.id, "stdout", "second line");

    const res = await buildApp(db).request(
      `/api/tasks/poll?repo_id=${repo.id}&focused_task_id=${task.id}&focused_logs_after_id=${second.id - 1}`
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.data.tasks)).toBe(true);
    expect(body.data.tasks).toHaveLength(1);
    expect(body.data.focusedTask?.id).toBe(task.id);
    expect(body.data.focusedTask?.latestRun?.status).toBe("running");
    expect(body.data.focusedLogs).toHaveLength(1);
    expect(body.data.focusedLogs[0].content).toBe("second line");
    expect(typeof body.data.serverTime).toBe("string");
  });

  it("returns empty focused details when focused task is not found", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    db.tasks.create({ title: "Any", repoId: repo.id });

    const res = await buildApp(db).request(
      `/api/tasks/poll?repo_id=${repo.id}&focused_task_id=missing-task-id&focused_logs_after_id=0`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.focusedTask).toBeNull();
    expect(body.data.focusedLogs).toEqual([]);
  });
});

describe("POST /api/tasks", () => {
  it("creates a task and returns 201", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const app = buildApp(db);

    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Task", repoId: repo.id }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.title).toBe("New Task");
    expect(body.data.status).toBe("backlog");
    expect(body.data.id).toBeDefined();
  });

  it("accepts delegated task fields", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const parent = db.tasks.create({ title: "Parent objective", repoId: repo.id, maxCost: 40 });

    const res = await buildApp(db).request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Delegated child",
        repoId: repo.id,
        parentTaskId: parent.id,
        dependsOn: [parent.id],
        maxCost: 12,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.parentTaskId).toBe(parent.id);
    expect(body.data.dependsOn).toEqual([parent.id]);
    expect(body.data.maxCost).toBe(12);
  });

  it("returns 400 when title is missing", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const res = await buildApp(db).request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: repo.id }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when repoId is missing", async () => {
    const res = await buildApp(makeDb()).request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Task without repo" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when repo does not exist", async () => {
    const res = await buildApp(makeDb()).request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Orphan task", repoId: "non-existent" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/tasks/:id", () => {
  it("returns a task by id", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "Find me", repoId: repo.id });

    const res = await buildApp(db).request(`/api/tasks/${task.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("Find me");
  });

  it("returns 404 for unknown task", async () => {
    const res = await buildApp(makeDb()).request("/api/tasks/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("builds and materializes a task plan", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({
      title: "Implement autonomous validation flow",
      repoId: repo.id,
      description:
        "- Audit the current validation loop\n- Implement deterministic validation\n- Add regression tests and docs",
      maxCost: 30,
    });

    const res = await buildApp(db).request(`/api/tasks/${task.id}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialize: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.plan.nodes).toHaveLength(3);
    expect(body.data.createdTasks).toHaveLength(3);
    expect(body.data.createdTasks[2].dependsOn.length).toBeGreaterThan(0);
    expect(db.tasks.listChildren(task.id)).toHaveLength(3);
  });
});

describe("PATCH /api/tasks/:id", () => {
  it("updates the task title", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "Old title", repoId: repo.id });

    const res = await buildApp(db).request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New title" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("New title");
  });

  it("updates the task status", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });

    const res = await buildApp(db).request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("in_progress");
  });

  it("returns 404 for unknown task", async () => {
    const res = await buildApp(makeDb()).request("/api/tasks/ghost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/tasks/:id", () => {
  it("deletes a task", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "Delete me", repoId: repo.id });

    const res = await buildApp(db).request(`/api/tasks/${task.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(db.tasks.getById(task.id)).toBeNull();
  });

  it("returns 404 for unknown task", async () => {
    const res = await buildApp(makeDb()).request("/api/tasks/ghost", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
