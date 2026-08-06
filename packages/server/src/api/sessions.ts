import type { SessionSource } from "@vibe-code/shared";
import { SESSION_SOURCES } from "@vibe-code/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionService } from "../sessions/session-service";

const listQuerySchema = z.object({
  source: z.enum(SESSION_SOURCES as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  refresh: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export function createSessionsRouter(sessions: SessionService) {
  const router = new Hono();

  /** Kanban projection of every local CLI session the server can read. */
  router.get("/", async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "invalid_query", message: parsed.error.message }, 400);
    }

    try {
      const board = await sessions.list({
        source: parsed.data.source as SessionSource | undefined,
        limit: parsed.data.limit,
        refresh: parsed.data.refresh,
      });
      return c.json({ data: board });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "session_scan_failed", message }, 500);
    }
  });

  return router;
}
