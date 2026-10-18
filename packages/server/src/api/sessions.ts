import type { SessionSource } from "@vibe-code/shared";
import { SESSION_SOURCES } from "@vibe-code/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionService } from "../sessions/session-service";
import { externalTerminalId, type TerminalController, TerminalError } from "../terminal/controller";

const listQuerySchema = z.object({
  source: z.enum(SESSION_SOURCES as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  refresh: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const sourceSchema = z.enum(SESSION_SOURCES as [string, ...string[]]);

const terminalStartSchema = z.object({
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
});

const STATUS: Record<TerminalError["code"], 400 | 404 | 409 | 500> = {
  not_found: 404,
  bad_request: 400,
  unavailable: 409,
  failed: 500,
};

export function createSessionsRouter(sessions: SessionService, terminals: TerminalController) {
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

  // ─── Terminal of a session started outside vibe-code ────────────────────────
  // The app cannot attach to a PTY it did not spawn: starting a terminal here opens
  // a fresh one in the session's own directory and resumes it in its CLI.
  //
  // Trust model: these CLI stores belong to the *host*, not to a workspace — the same
  // reason `GET /api/sessions` is not workspace-scoped. These routes are therefore guarded
  // by the global `/api/*` authentication only, exactly like the board they extend. That is
  // deliberate for the single-operator control plane this server is: one human owns every
  // session the machine can see. A deployment with mutually untrusted operators per
  // workspace would have to map the session stores to workspaces first — do not expose it
  // that way.

  /** Whether the app currently holds a terminal for this external session. */
  router.get("/:source/:sessionId/terminal", (c) => {
    const source = sourceSchema.safeParse(c.req.param("source"));
    if (!source.success) return c.json({ error: "invalid_source", message: "Unknown CLI" }, 400);
    const id = externalTerminalId(source.data as SessionSource, c.req.param("sessionId"));
    const live = terminals.listExternal().find((session) => session.id === id) ?? null;
    return c.json({ data: live });
  });

  router.post("/:source/:sessionId/terminal", async (c) => {
    const source = sourceSchema.safeParse(c.req.param("source"));
    if (!source.success) return c.json({ error: "invalid_source", message: "Unknown CLI" }, 400);

    const body = terminalStartSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: "validation", message: body.error.message }, 400);
    }

    const session = await sessions
      .find(source.data as SessionSource, c.req.param("sessionId"))
      .catch(() => null);
    if (!session) return c.json({ error: "not_found", message: "Session not found" }, 404);
    if (!session.cwd) {
      return c.json(
        { error: "bad_request", message: "This session has no known working directory" },
        400
      );
    }

    try {
      const opened = await terminals.startExternal({
        source: source.data as SessionSource,
        sessionId: session.sessionId,
        cwd: session.cwd,
        cols: body.data.cols,
        rows: body.data.rows,
      });
      return c.json({ data: { id: opened.id, cwd: opened.cwd } });
    } catch (error) {
      if (error instanceof TerminalError) {
        return c.json({ error: error.code, message: error.message }, STATUS[error.code]);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "terminal_error", message }, 500);
    }
  });

  router.delete("/:source/:sessionId/terminal", (c) => {
    const source = sourceSchema.safeParse(c.req.param("source"));
    if (!source.success) return c.json({ error: "invalid_source", message: "Unknown CLI" }, 400);
    const id = externalTerminalId(source.data as SessionSource, c.req.param("sessionId"));
    return c.json({ data: { stopped: terminals.stopExternal(id) } });
  });

  return router;
}
