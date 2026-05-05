import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRunsRouter } from "./runs";

type Db = ReturnType<typeof createDb>;

function makeDb(): Db {
  return createDb(":memory:");
}

function seedRunWithLogs(db: Db) {
  const repo = db.repos.create({ url: "https://github.com/test/repo.git" });
  const task = db.tasks.create({ title: "Run logs", repoId: repo.id });
  const run = db.runs.create(task.id, "claude-code");
  db.logs.create(run.id, "stdout", "first");
  const second = db.logs.create(run.id, "stderr", "second");
  return { run, secondId: second.id };
}

function buildApp(db: Db) {
  const app = new Hono();
  app.route("/api/runs", createRunsRouter(db));
  return app;
}

describe("GET /api/runs/:id/logs", () => {
  it("returns all logs for a run", async () => {
    const db = makeDb();
    const { run } = seedRunWithLogs(db);

    const res = await buildApp(db).request(`/api/runs/${run.id}/logs`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(2);
    expect(body.data[0].content).toBe("first");
    expect(body.data[1].content).toBe("second");
  });

  it("supports incremental reads using after", async () => {
    const db = makeDb();
    const { run, secondId } = seedRunWithLogs(db);

    const res = await buildApp(db).request(`/api/runs/${run.id}/logs?after=${secondId - 1}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].content).toBe("second");
  });

  it("returns not_found when run does not exist", async () => {
    const db = makeDb();

    const res = await buildApp(db).request("/api/runs/missing/logs");
    expect(res.status).toBe(404);
    const body = await res.json();

    expect(body.error).toBe("not_found");
  });
});
