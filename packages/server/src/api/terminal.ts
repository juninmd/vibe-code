import { HARNESS_ENGINES } from "@vibe-code/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import {
  asForbiddenResponse,
  enforceTaskAccess,
  resolveAccessContext,
} from "../security/access-control";
import { type TerminalController, TerminalError } from "../terminal/controller";

const startSchema = z.object({
  engine: z.enum([...HARNESS_ENGINES, "shell"]).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  skills: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
});

const skillsSchema = z.object({
  skills: z.array(z.string().trim().min(1).max(200)).max(50),
});

const STATUS: Record<TerminalError["code"], 400 | 404 | 409 | 500> = {
  not_found: 404,
  bad_request: 400,
  unavailable: 409,
  failed: 500,
};

/** `/api/terminal/:taskId/*` — start/stop the interactive agent terminal of a task. */
export function createTerminalRouter(db: Db, controller: TerminalController) {
  const router = new Hono();

  router.use("/:taskId/*", async (c, next) => {
    const access = await resolveAccessContext(c, db);
    if (!access.ok || !access.context) {
      const decision = access.error;
      if (decision) return c.json(asForbiddenResponse(decision), decision.status);
      return c.json({ error: "unauthorized", message: "Access denied" }, 403);
    }
    const decision = enforceTaskAccess(db, access.context, c.req.param("taskId"));
    if (decision) return c.json(asForbiddenResponse(decision), decision.status);
    return next();
  });

  const fail = (c: Context, error: unknown) => {
    if (error instanceof TerminalError) {
      return c.json({ error: error.code, message: error.message }, STATUS[error.code]);
    }
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: "terminal_error", message }, 500);
  };

  router.get("/:taskId/state", async (c) => {
    try {
      return c.json({ data: await controller.state(c.req.param("taskId")) });
    } catch (error) {
      return fail(c, error);
    }
  });

  router.post("/:taskId/start", async (c) => {
    const parsed = startSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    try {
      return c.json({ data: await controller.start(c.req.param("taskId"), parsed.data) });
    } catch (error) {
      return fail(c, error);
    }
  });

  router.post("/:taskId/stop", async (c) => {
    const stopped = controller.stop(c.req.param("taskId"));
    return c.json({ data: { stopped } });
  });

  router.put("/:taskId/skills", async (c) => {
    const parsed = skillsSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    try {
      return c.json({
        data: await controller.setSkills(c.req.param("taskId"), parsed.data.skills),
      });
    } catch (error) {
      return fail(c, error);
    }
  });

  router.post("/:taskId/finish", async (c) => {
    try {
      return c.json({ data: await controller.finish(c.req.param("taskId")) });
    } catch (error) {
      return fail(c, error);
    }
  });

  return router;
}
