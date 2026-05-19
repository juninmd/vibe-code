import { Hono } from "hono";
import type { AgentTemplateRegistry } from "../agents/agent-templates";

export function createAgentTemplatesRouter(registry: AgentTemplateRegistry) {
  const router = new Hono();

  router.get("/", (c) => c.json({ data: registry.list() }));

  router.get("/:slug", (c) => {
    const t = registry.get(c.req.param("slug"));
    if (!t) return c.json({ error: "not_found" }, 404);
    return c.json({ data: t });
  });

  return router;
}
