import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";
import type { BroadcastHub } from "../ws/broadcast";

const createRepoSchema = z.object({
  url: z.string().url("Must be a valid URL").min(1),
});

export function createReposRouter(db: Db, git: GitService, hub: BroadcastHub) {
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
          const cloning = db.repos.updateStatus(repo.id, "cloning");
          if (cloning) hub.broadcastAll({ type: "repo_updated", repo: cloning });
          const localPath = await git.cloneRepo(parsed.data.url, repo.name);
          const ready = db.repos.updateStatus(repo.id, "ready", localPath);
          if (ready) hub.broadcastAll({ type: "repo_updated", repo: ready });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const failed = db.repos.updateStatus(repo.id, "error", null, msg);
          if (failed) hub.broadcastAll({ type: "repo_updated", repo: failed });
        }
      })();

      return c.json({ data: { ...repo, status: "cloning" } }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg?.includes("UNIQUE")) {
        return c.json({ error: "conflict", message: "Repository already exists" }, 409);
      }
      throw err as Error;
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
