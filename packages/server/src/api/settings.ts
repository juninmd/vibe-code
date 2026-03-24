import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";

const updateSettingsSchema = z.object({
  githubToken: z.string().optional(),
});

export function createSettingsRouter(db: Db) {
  const app = new Hono();

  // GET /api/settings — return current settings (token masked)
  app.get("/", (c) => {
    const token = db.settings.get("github_token");
    return c.json({
      data: {
        githubToken: token ? "•".repeat(token.length - 4) + token.slice(-4) : "",
        githubTokenSet: !!token,
      },
    });
  });

  // PUT /api/settings — update settings
  app.put("/", async (c) => {
    const body = await c.req.json();
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    if (parsed.data.githubToken !== undefined) {
      db.settings.set("github_token", parsed.data.githubToken);
    }
    return c.json({ data: { ok: true } });
  });

  return app;
}
