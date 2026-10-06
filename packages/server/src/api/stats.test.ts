import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { createStatsRouter } from "./stats";

function seed(statuses: string[]) {
  const db = createDb(":memory:");
  const repo = db.repos.create({ url: "https://github.com/test/repo.git" });
  const task = db.tasks.create({ title: "t", description: "", repoId: repo.id });
  for (const status of statuses) {
    const run = db.runs.create(task.id, "claude-code");
    db.runs.updateStatus(run.id, status);
  }
  const app = new Hono();
  app.route("/api/stats", createStatsRouter(db));
  return app;
}

async function overview(statuses: string[]) {
  const res = await seed(statuses).request("/api/stats");
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { overview: Record<string, number> } }).data.overview;
}

describe("GET /api/stats overview", () => {
  it("counts only runs that finished when computing the success rate", async () => {
    const o = await overview([
      "completed",
      "completed",
      "completed",
      "failed",
      "cancelled",
      "queued",
    ]);
    expect(o.totalRuns).toBe(6);
    expect(o.completedRuns).toBe(3);
    expect(o.failedRuns).toBe(1);
    expect(o.successRate).toBe(75);
  });

  it("does not call cancelled or queued runs successful", async () => {
    const o = await overview(["cancelled", "cancelled", "queued", "running"]);
    expect(o.completedRuns).toBe(0);
    expect(o.successRate).toBe(0);
  });

  it("is all zeros for an empty install", async () => {
    const o = await overview([]);
    expect(o).toMatchObject({ totalRuns: 0, completedRuns: 0, failedRuns: 0, successRate: 0 });
  });
});
