import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";
import type { BroadcastHub } from "../ws/broadcast";

const createRepoSchema = z.object({
  url: z.string().url("Must be a valid URL").min(1),
});

const createGitHubRepoSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().default(""),
  isPrivate: z.boolean().default(false),
});

const purgeLocalClonesSchema = z.object({
  confirm: z.literal(true),
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

  router.post("/github/create", async (c) => {
    const body = await c.req.json();
    const parsed = createGitHubRepoSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    try {
      const ghRepo = await git.createGitHubRepo(
        parsed.data.name,
        parsed.data.description,
        parsed.data.isPrivate
      );
      return c.json({ data: ghRepo });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "github_error", message: msg }, 500);
    }
  });

  router.get("/:id", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    return c.json({ data: repo });
  });

  router.get("/:id/branches", async (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    if (!repo.localPath) return c.json({ data: [repo.defaultBranch] });
    const branches = await git.listBranches(repo.localPath);
    // Ensure default branch is always first
    const sorted = [repo.defaultBranch, ...branches.filter((b) => b !== repo.defaultBranch)];
    return c.json({ data: sorted });
  });

  router.delete("/:id/local-clone", async (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    if (!repo.localPath) {
      return c.json({ error: "invalid_state", message: "Repository has no local clone" }, 400);
    }

    const runningTask = db.tasks.list(repo.id).find((task) => task.status === "in_progress");
    if (runningTask) {
      return c.json(
        { error: "conflict", message: "Cannot delete local clone while tasks are running" },
        409
      );
    }

    await git.deleteLocalRepo(repo.localPath, repo.name);
    const updated = db.repos.updateStatus(repo.id, "pending", null, null);
    if (updated) hub.broadcastAll({ type: "repo_updated", repo: updated });
    return c.json({ data: updated });
  });

  router.post("/local-clones/purge", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = purgeLocalClonesSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const repos = db.repos.list();
    let deleted = 0;
    let skipped = 0;

    for (const repo of repos) {
      if (!repo.localPath) {
        skipped++;
        continue;
      }

      const hasRunningTask = db.tasks.list(repo.id).some((task) => task.status === "in_progress");
      if (hasRunningTask) {
        skipped++;
        continue;
      }

      await git.deleteLocalRepo(repo.localPath, repo.name);
      const updated = db.repos.updateStatus(repo.id, "pending", null, null);
      if (updated) hub.broadcastAll({ type: "repo_updated", repo: updated });
      deleted++;
    }

    return c.json({ data: { deleted, skipped } });
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
