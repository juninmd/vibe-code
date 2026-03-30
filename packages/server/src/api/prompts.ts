import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";

const createSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  content: z.string().min(1),
  category: z.string().max(50).optional(),
});

const updateSchema = createSchema.partial();

export function createPromptsRouter(db: Db) {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json(db.prompts.list());
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const template = db.prompts.create(parsed.data);
    return c.json(template, 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const template = db.prompts.update(id, parsed.data);
    if (!template) return c.json({ error: "Not found or is a built-in template" }, 404);
    return c.json(template);
  });

  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    const deleted = db.prompts.remove(id);
    if (!deleted) return c.json({ error: "Not found or is a built-in template" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
