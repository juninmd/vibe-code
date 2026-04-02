import { Hono } from "hono";
import type { Orchestrator } from "../agents/orchestrator";
import type { EngineRegistry } from "../agents/registry";

export function createEnginesRouter(registry: EngineRegistry, orchestrator: Orchestrator) {
  const router = new Hono();

  router.get("/", async (c) => {
    const activeRuns = orchestrator.getActiveRunEngines();
    const engines = await registry.listEngines(activeRuns);
    return c.json({ data: engines });
  });

  router.get("/:name/models", async (c) => {
    try {
      const models = await registry.listModels(c.req.param("name"));
      return c.json({ data: models });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "list_models_failed", message: msg }, 500);
    }
  });

  return router;
}
