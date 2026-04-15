import { Hono } from "hono";
import type { Db } from "../db";

export function createRunsRouter(db: Db) {
  const router = new Hono();

  router.get("/:id/logs", (c) => {
    const run = db.runs.getById(c.req.param("id"));
    if (!run) return c.json({ error: "not_found", message: "Run not found" }, 404);

    const afterParam = c.req.query("after");
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(1, Number(limitParam)), 1000) : 300;

    const logs = afterParam
      ? db.logs.listByRunAfter(run.id, Number(afterParam), limit)
      : db.logs.listByRun(run.id);

    return c.json({ data: logs });
  });

  return router;
}
