import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { type TerminalController, TerminalError } from "../terminal/controller";
import { createTerminalRouter } from "./terminal";

function buildApp(overrides: Partial<Record<keyof TerminalController, unknown>> = {}) {
  const db = createDb(":memory:");
  db.settings.set("auth_enabled", "false");
  const repo = db.repos.create({ url: "https://github.com/test/repo.git" });
  const task = db.tasks.create({ title: "T", description: "D", repoId: repo.id });
  const calls: unknown[] = [];
  const controller = {
    state: async (taskId: string) => ({
      taskId,
      live: false,
      runId: null,
      engine: null,
      skills: [],
      cwd: null,
    }),
    start: async (taskId: string, req: unknown) => {
      calls.push({ taskId, req });
      return { taskId, live: true, runId: "r1", engine: "claude-code", skills: [], cwd: "/w" };
    },
    stop: () => true,
    setSkills: async () => ({}),
    finish: async () => ({}),
    ...overrides,
  } as unknown as TerminalController;
  const app = new Hono();
  app.route("/api/terminal", createTerminalRouter(db, controller));
  return { app, task, calls };
}

const post = (app: Hono, path: string, body?: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("/api/terminal", () => {
  it("returns the terminal state of a task", async () => {
    const { app, task } = buildApp();
    const res = await app.request(`/api/terminal/${task.id}/state`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.live).toBe(false);
  });

  it("starts a session with a validated body", async () => {
    const { app, task, calls } = buildApp();
    const res = await post(app, `/api/terminal/${task.id}/start`, {
      engine: "opencode",
      skills: ["tdd"],
      cols: 100,
      rows: 30,
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { taskId: task.id, req: { engine: "opencode", skills: ["tdd"], cols: 100, rows: 30 } },
    ]);
  });

  it("accepts a plain shell and an empty body", async () => {
    const { app, task } = buildApp();
    expect((await post(app, `/api/terminal/${task.id}/start`, { engine: "shell" })).status).toBe(
      200
    );
    expect((await post(app, `/api/terminal/${task.id}/start`)).status).toBe(200);
  });

  it("rejects unknown engines and absurd sizes", async () => {
    const { app, task } = buildApp();
    expect((await post(app, `/api/terminal/${task.id}/start`, { engine: "rm -rf" })).status).toBe(
      400
    );
    expect((await post(app, `/api/terminal/${task.id}/start`, { cols: 100000 })).status).toBe(400);
  });

  it("maps controller errors to HTTP statuses", async () => {
    const { app, task } = buildApp({
      start: async () => {
        throw new TerminalError("unavailable", "claude is not installed");
      },
    });
    const res = await post(app, `/api/terminal/${task.id}/start`, {});
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain("claude is not installed");
  });

  it("does not expose terminals of unknown tasks", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/terminal/does-not-exist/state");
    expect([403, 404]).toContain(res.status);
  });
});
