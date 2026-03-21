import { Hono } from "hono";
import type { Db } from "../db";

export function createRunsRouter(db: Db) {
  const router = new Hono();

  router.get("/:id/logs", (c) => {
    const run = db.runs.getById(c.req.param("id"));
    if (!run) return c.json({ error: "not_found", message: "Run not found" }, 404);
    const logs = db.logs.listByRun(run.id);
    return c.json({ data: logs });
  });

  return router;
}
