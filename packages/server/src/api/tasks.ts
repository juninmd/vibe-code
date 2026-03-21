import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import type { Orchestrator } from "../agents/orchestrator";

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  repoId: z.string().min(1),
  engine: z.string().optional(),
  priority: z.number().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["backlog", "in_progress", "review", "done", "failed"]).optional(),
  columnOrder: z.number().optional(),
  engine: z.string().optional(),
});

const launchTaskSchema = z.object({
  engine: z.string().optional(),
});

export function createTasksRouter(db: Db, orchestrator: Orchestrator) {
  const router = new Hono();

  router.get("/", (c) => {
    const repoId = c.req.query("repo_id");
    const status = c.req.query("status");
    const tasks = db.tasks.list(repoId, status);

    // Attach latest run info
    const tasksWithRuns = tasks.map((task) => {
      const latestRun = db.runs.getLatestByTask(task.id);
      const repo = db.repos.getById(task.repoId);
      return { ...task, latestRun: latestRun ?? undefined, repo: repo ?? undefined };
    });

    return c.json({ data: tasksWithRuns });
  });

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const repo = db.repos.getById(parsed.data.repoId);
    if (!repo) {
      return c.json({ error: "not_found", message: "Repository not found" }, 404);
    }

    const task = db.tasks.create(parsed.data);
    return c.json({ data: task }, 201);
  });

  router.get("/:id", (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    const latestRun = db.runs.getLatestByTask(task.id);
    const repo = db.repos.getById(task.repoId);
    return c.json({ data: { ...task, latestRun: latestRun ?? undefined, repo: repo ?? undefined } });
  });

  router.patch("/:id", async (c) => {
    const body = await c.req.json();
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const task = db.tasks.update(c.req.param("id"), parsed.data);
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    return c.json({ data: task });
  });

  router.delete("/:id", (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    db.tasks.remove(c.req.param("id"));
    return c.json({ data: { ok: true } });
  });

  router.post("/:id/launch", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    if (task.status !== "backlog" && task.status !== "failed") {
      return c.json({ error: "invalid_state", message: `Cannot launch task in "${task.status}" status` }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = launchTaskSchema.safeParse(body);
    const engineOverride = parsed.success ? parsed.data.engine : undefined;

    try {
      const run = await orchestrator.launch(task, engineOverride);
      return c.json({ data: run }, 202);
    } catch (err: any) {
      return c.json({ error: "launch_failed", message: err.message }, 500);
    }
  });

  router.post("/:id/cancel", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    try {
      await orchestrator.cancel(task.id);
      return c.json({ data: { ok: true } });
    } catch (err: any) {
      return c.json({ error: "cancel_failed", message: err.message }, 500);
    }
  });

  router.post("/:id/retry", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    if (task.status !== "failed") {
      return c.json({ error: "invalid_state", message: "Can only retry failed tasks" }, 400);
    }

    try {
      const run = await orchestrator.launch(task);
      return c.json({ data: run }, 202);
    } catch (err: any) {
      return c.json({ error: "retry_failed", message: err.message }, 500);
    }
  });

  router.get("/:id/runs", (c) => {
    const runs = db.runs.listByTask(c.req.param("id"));
    return c.json({ data: runs });
  });

  return router;
}
