import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Db } from "../db";
import type { SkillsLoader } from "../skills/loader";

export function createTemplatesRouter(_db: Db, skillsLoader: SkillsLoader) {
  const app = new Hono();

  // GET /api/templates — List available templates in ~/.vibe-code/templates
  app.get("/", async (c) => {
    const templatesDir = join(homedir(), ".vibe-code", "templates");
    await mkdir(templatesDir, { recursive: true });

    try {
      const files = await readdir(templatesDir);
      const templates = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
      return c.json({ data: templates });
    } catch (_err) {
      return c.json({ error: "Failed to list templates" }, 500);
    }
  });

  // POST /api/templates/export — Bundle current skills/rules into a template
  app.post("/export", async (c) => {
    try {
      const { name } = await c.req.json();
      if (!name) return c.json({ error: "Name is required" }, 400);

      const index = await skillsLoader.load();
      const templatesDir = join(homedir(), ".vibe-code", "templates");
      await mkdir(templatesDir, { recursive: true });

      // Bundle contents
      const bundle: any = {
        name,
        exportedAt: new Date().toISOString(),
        skills: [],
        rules: [],
        agents: [],
        workflows: [],
      };

      for (const s of index.skills) {
        if (s.filePath.startsWith("virtual://")) continue;
        const content = await readFile(s.filePath, "utf8");
        bundle.skills.push({ ...s, content });
      }

      for (const r of index.rules) {
        const content = await readFile(r.filePath, "utf8");
        bundle.rules.push({ ...r, content });
      }

      for (const a of index.agents) {
        const content = await readFile(a.filePath, "utf8");
        bundle.agents.push({ ...a, content });
      }

      for (const w of index.workflows) {
        const content = await readFile(w.filePath, "utf8");
        bundle.workflows.push({ ...w, content });
      }

      await writeFile(join(templatesDir, `${name}.json`), JSON.stringify(bundle, null, 2));
      return c.json({ data: { ok: true, name } });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // POST /api/templates/import — Restore a template into ~/.agents
  app.post("/import", async (c) => {
    try {
      const { name } = await c.req.json();
      if (!name) return c.json({ error: "Name is required" }, 400);

      const templatesDir = join(homedir(), ".vibe-code", "templates");
      const bundleRaw = await readFile(join(templatesDir, `${name}.json`), "utf8");
      const bundle = JSON.parse(bundleRaw);

      const agentsDir = join(homedir(), ".agents");
      await mkdir(join(agentsDir, "skills"), { recursive: true });
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await mkdir(join(agentsDir, "workflows"), { recursive: true });

      for (const s of bundle.skills) {
        const target = join(agentsDir, "skills", s.name, "SKILL.md");
        await mkdir(join(agentsDir, "skills", s.name), { recursive: true });
        await writeFile(target, s.content);
      }

      for (const r of bundle.rules) {
        const target = join(agentsDir, "rules", `${r.name}.instructions.md`);
        await writeFile(target, r.content);
      }

      for (const a of bundle.agents) {
        const target = join(agentsDir, "agents", `${a.name}.agent.md`);
        await writeFile(target, a.content);
      }

      for (const w of bundle.workflows) {
        const target = join(agentsDir, "workflows", `${w.name}.prompt.md`);
        await writeFile(target, w.content);
      }

      skillsLoader.invalidate();
      return c.json({ data: { ok: true, imported: name } });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}
