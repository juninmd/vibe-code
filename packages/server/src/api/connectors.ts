import { Hono } from "hono";
import { z } from "zod";
import {
  addBacklogComment,
  fetchBacklog,
  sendSlackNotification,
  type TrackerConfig,
} from "../connectors/backlog";

const kinds = ["jira", "linear", "notion", "clickup", "asana", "trello", "monday"] as const;

const configSchema = z.object({
  kind: z.enum(kinds),
  token: z.string().min(1),
  scope: z.string().optional(),
  extra: z.string().optional(),
});

/** Stateless backlog connectors: credentials come in the request body (never stored here). */
export function createConnectorsRouter(fetchFn: typeof fetch = fetch) {
  const app = new Hono();

  app.post("/backlog", async (c) => {
    const parsed = configSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    try {
      return c.json({ items: await fetchBacklog(parsed.data as TrackerConfig, fetchFn) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  app.post("/comment", async (c) => {
    const schema = z.object({
      config: configSchema,
      externalId: z.string().min(1),
      text: z.string().min(1),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const ok = await addBacklogComment(
      parsed.data.config as TrackerConfig,
      parsed.data.externalId,
      parsed.data.text,
      fetchFn
    );
    return c.json({ ok }, ok ? 200 : 502);
  });

  app.post("/slack", async (c) => {
    const parsed = z
      .object({ webhookUrl: z.string().url(), message: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const ok = await sendSlackNotification(parsed.data.webhookUrl, parsed.data.message, fetchFn);
    return c.json({ ok }, ok ? 200 : 502);
  });

  return app;
}
