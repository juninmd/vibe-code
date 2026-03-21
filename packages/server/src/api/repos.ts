import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";

const createRepoSchema = z.object({
  url: z.string().min(1),
  defaultBranch: z.string().optional(),
});

export function createReposRouter(db: Db) {
  const router = new Hono();

  router.get("/", (c) => {
    const repos = db.repos.list();
    return c.json({ data: repos });
  });

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createRepoSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    try {
      const repo = db.repos.create(parsed.data);
      return c.json({ data: repo }, 201);
    } catch (err: any) {
      if (err.message?.includes("UNIQUE")) {
        return c.json({ error: "conflict", message: "Repository already exists" }, 409);
      }
      throw err;
    }
  });

  router.get("/:id", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    return c.json({ data: repo });
  });

  router.delete("/:id", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    db.repos.remove(c.req.param("id"));
    return c.json({ data: { ok: true } });
  });

  router.post("/:id/refresh", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    // Refresh will be handled by git service - mark as pending for re-clone
    db.repos.updateStatus(repo.id, "pending");
    return c.json({ data: { ok: true } });
  });

  return router;
}
