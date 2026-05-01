import { join } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";
import { RepoSkillsLoader } from "../skills/repo-loader";
import type { BroadcastHub } from "../ws/broadcast";

const createRepoSchema = z.object({
  url: z.string().url("Must be a valid URL").min(1),
});

const createRemoteRepoSchema = z.object({
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
    try {
      const repos = await git.listRemoteRepos("github", 20);
      return c.json({ data: repos });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "github_error", message: msg }, 500);
    }
  });

  router.get("/github/search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ data: [] });
    try {
      const repos = await git.searchRemoteRepos("github", q, 20);
      return c.json({ data: repos });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "github_error", message: msg }, 500);
    }
  });

  router.post("/github/create", async (c) => {
    const body = await c.req.json();
    const parsed = createRemoteRepoSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    try {
      const ghRepo = await git.createRemoteRepo(
        "github",
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

  // GitLab provider routes
  router.get("/gitlab/list", async (c) => {
    try {
      const repos = await git.listRemoteRepos("gitlab", 20);
      return c.json({ data: repos });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "gitlab_error", message: msg }, 500);
    }
  });

  router.get("/gitlab/search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ data: [] });
    try {
      const repos = await git.searchRemoteRepos("gitlab", q, 20);
      return c.json({ data: repos });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "gitlab_error", message: msg }, 500);
    }
  });

  router.post("/gitlab/create", async (c) => {
    const body = await c.req.json();
    const parsed = createRemoteRepoSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    try {
      const glRepo = await git.createRemoteRepo(
        "gitlab",
        parsed.data.name,
        parsed.data.description,
        parsed.data.isPrivate
      );
      return c.json({ data: glRepo });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "gitlab_error", message: msg }, 500);
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

    const branches = await git.listRemoteBranches(repo);
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

    const runningTask = db.tasks.list(repo.id).find((task) => task.status === "in_progress");
    if (runningTask) {
      return c.json(
        { error: "conflict", message: "Cannot remove repository while tasks are running" },
        409
      );
    }

    db.repos.remove(c.req.param("id"));
    return c.json({
      data: {
        ok: true,
        scope: "local_catalog_only",
        remoteDeleted: false,
      },
    });
  });

  router.post("/:id/refresh", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    db.repos.updateStatus(repo.id, "pending");
    return c.json({ data: { ok: true } });
  });

  // GET /api/repos/:id/issues — list issues from the remote repo
  router.get("/:id/issues", async (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);

    const state = c.req.query("state") as "open" | "closed" | "all" | undefined;
    const labelsParam = c.req.query("labels");
    const labels = labelsParam ? labelsParam.split(",").filter(Boolean) : undefined;
    const limit = Number(c.req.query("limit")) || 50;

    try {
      const issues = await git.listIssues(repo.url, { state, labels, limit });
      return c.json({ data: issues });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "issues_error", message: msg }, 500);
    }
  });

  // M4.5: Review findings for a repository
  router.get("/:id/findings", (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    const limit = Number(c.req.query("limit")) || 50;
    const findings = db.findings.listByRepo(repo.id, limit);
    return c.json({ data: findings });
  });

  // M6.5: Skills scoped to a repository's .vibe-code directory
  router.get("/:id/skills", async (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    if (!repo.localPath)
      return c.json({ data: { skills: [], rules: [], agents: [], workflows: [] } });
    try {
      const loader = new RepoSkillsLoader(repo.localPath);
      const index = await loader.load();
      return c.json({ data: index });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "load_error", message: msg }, 500);
    }
  });

  router.get("/:id/manifests", async (c) => {
    const repo = db.repos.getById(c.req.param("id"));
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);
    try {
      const barePath = join(git.reposDir, repo.name);
      const loader = new RepoSkillsLoader(repo.localPath ?? barePath);
      const manifests = await loader.loadManifestsFromGit(barePath);

      // Also load worktree manifests if there's a recent run with worktreePath
      const recentRun = db.runs.listByTask(c.req.param("id"))[0];
      if (recentRun?.worktreePath) {
        try {
          const worktreeManifests = await loader.loadWorktreeManifests(recentRun.worktreePath);
          for (const [k, v] of Object.entries(worktreeManifests)) {
            manifests[k] = v;
          }
        } catch {
          // Best effort
        }
      }

      return c.json({ data: manifests });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "load_error", message: msg }, 500);
    }
  });

  return router;
}
