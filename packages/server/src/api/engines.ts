import { Hono } from "hono";
import type { EngineRegistry } from "../agents/registry";

export function createEnginesRouter(registry: EngineRegistry) {
  const router = new Hono();

  router.get("/", async (c) => {
    const engines = await registry.listEngines();
    return c.json({ data: engines });
  });

  return router;
}
