import { Hono } from "hono";
import type { SkillsLoader } from "../skills/loader";

export function createSkillsRouter(skillsLoader: SkillsLoader) {
  const app = new Hono();

  // GET /api/skills — full index of all categories
  app.get("/", async (c) => {
    const index = await skillsLoader.load();
    return c.json({ data: index });
  });

  // GET /api/skills/skills — list skills only
  app.get("/skills", async (c) => {
    const index = await skillsLoader.load();
    return c.json({ data: index.skills });
  });

  // GET /api/skills/rules — list rules only
  app.get("/rules", async (c) => {
    const index = await skillsLoader.load();
    return c.json({ data: index.rules });
  });

  // GET /api/skills/agents — list agents only
  app.get("/agents", async (c) => {
    const index = await skillsLoader.load();
    return c.json({ data: index.agents });
  });

  // GET /api/skills/workflows — list workflows only
  app.get("/workflows", async (c) => {
    const index = await skillsLoader.load();
    return c.json({ data: index.workflows });
  });

  // GET /api/skills/content?path=<filePath> — get full file content
  app.get("/content", async (c) => {
    const filePath = c.req.query("path");
    if (!filePath) {
      return c.json({ error: "Missing ?path= query parameter" }, 400);
    }
    try {
      const content = await skillsLoader.getFileContent(filePath);
      return c.json({ data: { content } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 403);
    }
  });

  // POST /api/skills/refresh — force reload
  app.post("/refresh", async (c) => {
    skillsLoader.invalidate();
    const index = await skillsLoader.load();
    return c.json({
      data: {
        skills: index.skills.length,
        rules: index.rules.length,
        agents: index.agents.length,
        workflows: index.workflows.length,
      },
    });
  });

  return app;
}
