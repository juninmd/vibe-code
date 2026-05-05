import { Hono } from "hono";
import type { Db } from "../db";
import {
  asForbiddenResponse,
  enforceRunAccess,
  resolveAccessContext,
} from "../security/access-control";

export function createRunsRouter(db: Db) {
  const router = new Hono();

  router.get("/:id/logs", async (c) => {
    const access = await resolveAccessContext(c, db);
    if (!access.ok || !access.context) {
      const decision = access.error;
      if (decision) return c.json(asForbiddenResponse(decision), decision.status);
      return c.json({ error: "unauthorized", message: "Access denied" }, 403);
    }

    const runId = c.req.param("id");
    const decision = enforceRunAccess(db, access.context, runId);
    if (decision) return c.json(asForbiddenResponse(decision), decision.status);

    const run = db.runs.getById(runId);
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
