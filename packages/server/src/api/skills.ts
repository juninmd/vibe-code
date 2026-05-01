import { Hono } from "hono";
import type { SkillsLoader } from "../skills/loader";
import type { SkillRegistryService } from "../skills/registry";

export function createSkillsRouter(
  skillsLoader: SkillsLoader,
  skillRegistry: SkillRegistryService
) {
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

  // GET /api/skills/manifests — load global manifest files (AGENTS.md, CLAUDE.md, GEMINI.md, etc.)
  app.get("/manifests", async (c) => {
    const manifests = await skillsLoader.loadManifests();
    return c.json({ data: manifests });
  });

  // GET /api/skills/registry — list installed registry skills
  app.get("/registry", async (c) => {
    const list = await skillRegistry.listInstalled();
    return c.json({ data: list });
  });

  // POST /api/skills/registry/install — install from GitHub
  app.post("/registry/install", async (c) => {
    const { repoPath } = await c.req.json();
    if (!repoPath) {
      return c.json({ error: "Missing repoPath" }, 400);
    }
    try {
      const result = await skillRegistry.installFromGitHub(repoPath);
      skillsLoader.invalidate(); // Force reload
      return c.json({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // DELETE /api/skills/registry/:name — uninstall
  app.delete("/registry/:name", async (c) => {
    const name = c.req.param("name");
    try {
      await skillRegistry.uninstall(name);
      skillsLoader.invalidate();
      return c.json({ data: { success: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
