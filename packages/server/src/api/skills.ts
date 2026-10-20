import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import { GitHubPluginCatalog } from "../skills/github-catalog";
import type { SkillsLoader } from "../skills/loader";
import type { SkillRegistryService } from "../skills/registry";

export function createSkillsRouter(
  skillsLoader: SkillsLoader,
  skillRegistry: SkillRegistryService,
  db: Db
) {
  const app = new Hono();
  let catalogToken: string | undefined;
  let catalogService: GitHubPluginCatalog | undefined;
  const github = () => {
    const token = db.settings.get("github_token") || process.env.GITHUB_TOKEN;
    if (!catalogService || token !== catalogToken) {
      catalogToken = token;
      catalogService = new GitHubPluginCatalog(token);
    }
    return catalogService;
  };
  const sourceSchema = z.object({
    repo: z.string().trim().min(3).max(200),
    ref: z.string().trim().max(200).optional(),
  });

  app.get("/remote/catalog", async (c) => {
    const input = sourceSchema.safeParse(c.req.query());
    if (!input.success) return c.json({ error: "Repositório inválido." }, 400);
    try {
      return c.json({ data: await github().discover(input.data.repo, input.data.ref) });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Falha ao consultar GitHub." },
        400
      );
    }
  });
  app.post("/remote/import", async (c) => {
    const input = sourceSchema
      .extend({ commit: z.string().regex(/^[a-f0-9]{40}$/i), path: z.string().min(1).max(500) })
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Selecione um plugin válido do catálogo." }, 400);
    try {
      const bundle = await github().bundle(input.data.repo, input.data.commit, input.data.path);
      return c.json({ data: await skillRegistry.stageBundle(bundle) });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Falha ao importar plugin." },
        400
      );
    }
  });
  app.get("/registry/:id/content", async (c) => {
    try {
      return c.json({ data: { content: await skillRegistry.content(c.req.param("id")) } });
    } catch {
      return c.json({ error: "Plugin não encontrado." }, 404);
    }
  });

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
    const { repoPath, ref, assetPath } = await c.req.json();
    if (!repoPath) {
      return c.json({ error: "Missing repoPath" }, 400);
    }
    try {
      const result = await skillRegistry.installFromGitHub({ repoPath, ref, assetPath });
      return c.json({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/registry/:id/approve", async (c) => {
    try {
      const result = await skillRegistry.approve(c.req.param("id"));
      skillsLoader.invalidate();
      return c.json({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/registry/:id/reject", async (c) => {
    try {
      const result = await skillRegistry.reject(c.req.param("id"));
      return c.json({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/hygiene", async (c) => {
    const cached = db.settings.get("system_hygiene_report");
    if (cached) {
      try {
        return c.json({ data: JSON.parse(cached) });
      } catch {
        /* fall through */
      }
    }
    return c.json({ data: await skillRegistry.generateHygieneReport(db) });
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
