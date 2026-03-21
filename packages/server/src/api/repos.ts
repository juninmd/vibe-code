import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";

const createRepoSchema = z.object({
  url: z.string().min(1),
});

export function createReposRouter(db: Db, git: GitService) {
  const router = new Hono();

  router.get("/", (c) => {
    const repos = db.repos.list();
    return c.json({ data: repos });
  });

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createRepoSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    try {
      // Auto-detect default branch
      const defaultBranch = await git.detectDefaultBranch(parsed.data.url);
      const repo = db.repos.create({ url: parsed.data.url, defaultBranch });

      // Clone in background — respond immediately, update status async
      (async () => {
        try {
          db.repos.updateStatus(repo.id, "cloning");
          const localPath = await git.cloneRepo(parsed.data.url, repo.name);
          db.repos.updateStatus(repo.id, "ready", localPath);
        } catch (err: any) {
          db.repos.updateStatus(repo.id, "error", null, err.message);
        }
      })();

      return c.json({ data: { ...repo, status: "cloning" } }, 201);
    } catch (err: any) {
      if (err.message?.includes("UNIQUE")) {
        return c.json({ error: "conflict", message: "Repository already exists" }, 409);
      }
      throw err;
    }
  });

  router.get("/github/list", async (c) => {
    const repos = await git.listGitHubRepos();
    return c.json({ data: repos });
  });

  router.get("/:id", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    return c.json({ data: repo });
  });

  router.delete("/:id", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    db.repos.remove(c.req.param("id"));
    return c.json({ data: { ok: true } });
  });

  router.post("/:id/refresh", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    db.repos.updateStatus(repo.id, "pending");
    return c.json({ data: { ok: true } });
  });

  return router;
}
