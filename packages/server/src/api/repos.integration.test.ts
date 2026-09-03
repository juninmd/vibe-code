/**
 * Integration tests for the repos API router.
 * Uses a real SQLite :memory: database and a stubbed GitService/BroadcastHub.
 */
import { describe, expect, it, spyOn } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import type { GitService } from "../git/git-service";
import type { BroadcastHub } from "../ws/broadcast";
import { createReposRouter } from "./repos";

type Db = ReturnType<typeof createDb>;

function makeDb(): Db {
  return createDb(":memory:");
}

function makeGit(overrides: Partial<GitService> = {}): GitService {
  return {
    isRepoSource: async (url: string) => url !== "not-a-url",
    detectDefaultBranch: async () => "main",
    cloneRepo: async (_url: string, name: string) => `/tmp/${name}.git`,
    listGitHubRepos: async () => [],
    deleteLocalRepo: async () => {},
    ...overrides,
  } as unknown as GitService;
}

function makeHub(): BroadcastHub {
  return {
    broadcastAll: () => {},
    broadcastToTask: () => {},
    addClient: () => ({ ws: {}, subscribedTasks: new Set() }),
    removeClient: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
  } as unknown as BroadcastHub;
}

function buildApp(db: Db, git = makeGit(), hub = makeHub()) {
  const app = new Hono();
  app.route("/api/repos", createReposRouter(db, git, hub));
  return app;
}

describe("GET /api/repos", () => {
  it("returns empty data array when no repos exist", async () => {
    const res = await buildApp(makeDb()).request("/api/repos");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("returns existing repos", async () => {
    const db = makeDb();
    db.repos.create({ url: "https://github.com/org/repo1.git" });
    db.repos.create({ url: "https://github.com/org/repo2.git" });

    const res = await buildApp(db).request("/api/repos");
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });

  it("adopts legacy repos with null workspace_id", async () => {
    const db = makeDb();
    // First, ensure the workspace exists so the foreign key constraint passes
    db.workspaces.create({
      id: "ws-legacy-adopt",
      name: "Legacy Workspace",
      slug: "legacy-workspace",
      description: "Test workspace",
    });
    const repo = db.repos.create({ url: "https://github.com/org/repo-legacy.git" });
    // Manually force workspace_id to null
    db.raw.prepare("UPDATE repositories SET workspace_id = NULL WHERE id = ?").run(repo.id);

    // Mock resolveAccessContext
    const security = await import("../security/access-control");
    const spy = spyOn(security, "resolveAccessContext").mockResolvedValue({
      ok: true,
      context: {
        authEnabled: true,
        userId: "user1",
        workspaceId: "ws-legacy-adopt",
      },
    });

    const app = new Hono();
    app.route("/api/repos", createReposRouter(db, makeGit(), makeHub()));

    const res = await app.request("/api/repos");
    expect(res.status).toBe(200);

    const check = db.raw
      .prepare("SELECT workspace_id FROM repositories WHERE id = ?")
      .get(repo.id) as any;
    expect(check.workspace_id).toBe("ws-legacy-adopt");
    spy.mockRestore();
  });
});

describe("POST /api/repos", () => {
  it("creates a repo and returns 201 with cloning status", async () => {
    const res = await buildApp(makeDb()).request("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/org/project.git" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("project");
    expect(body.data.status).toBe("cloning");
    expect(body.data.id).toBeDefined();
  });

  it("returns 400 for invalid URL", async () => {
    const res = await buildApp(makeDb()).request("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts a local Git path as a repository source", async () => {
    const res = await buildApp(makeDb()).request("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "D:\\Solutions\\project" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("project");
    expect(body.data.provider).toBe("manual");
  });

  it("returns 400 when url field is missing", async () => {
    const res = await buildApp(makeDb()).request("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when repo already exists", async () => {
    const db = makeDb();
    db.repos.create({ url: "https://github.com/org/dup.git" });

    const res = await buildApp(db).request("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/org/dup.git" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("conflict");
  });
});

describe("GET /api/repos/:id", () => {
  it("returns a repo by id", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/found.git" });

    const res = await buildApp(db).request(`/api/repos/${repo.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("found");
  });

  it("returns 404 for unknown repo", async () => {
    const res = await buildApp(makeDb()).request("/api/repos/does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });
});

describe("DELETE /api/repos/:id", () => {
  it("deletes a repo and returns ok", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/bye.git" });

    const res = await buildApp(db).request(`/api/repos/${repo.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(body.data.scope).toBe("local_catalog_only");
    expect(body.data.remoteDeleted).toBe(false);
    expect(db.repos.getById(repo.id)).toBeNull();
  });

  it("returns 409 when a task is in progress for the repo", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/busy-delete.git" });
    db.tasks.create({ title: "Busy delete", repoId: repo.id, status: "in_progress" });

    const res = await buildApp(db).request(`/api/repos/${repo.id}`, { method: "DELETE" });

    expect(res.status).toBe(409);
    expect(db.repos.getById(repo.id)).not.toBeNull();
  });

  it("returns 404 for unknown repo", async () => {
    const res = await buildApp(makeDb()).request("/api/repos/ghost", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/repos/:id/local-clone", () => {
  it("removes the local clone and resets the repo to pending", async () => {
    const db = makeDb();
    const deleted: Array<{ barePath: string; repoName: string }> = [];
    const repo = db.repos.create({ url: "https://github.com/org/clone.git" });
    db.repos.updateStatus(repo.id, "ready", "/tmp/clone.git");

    const res = await buildApp(
      db,
      makeGit({
        deleteLocalRepo: async (barePath: string, repoName: string) => {
          deleted.push({ barePath, repoName });
        },
      })
    ).request(`/api/repos/${repo.id}/local-clone`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(deleted).toEqual([{ barePath: "/tmp/clone.git", repoName: "clone" }]);
    expect(db.repos.getById(repo.id)?.status).toBe("pending");
    expect(db.repos.getById(repo.id)?.localPath).toBeNull();
  });

  it("returns 400 when the repo has no local clone", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/clone.git" });

    const res = await buildApp(db).request(`/api/repos/${repo.id}/local-clone`, {
      method: "DELETE",
    });

    expect(res.status).toBe(400);
  });

  it("returns 409 when a task is in progress for the repo", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/busy.git" });
    db.repos.updateStatus(repo.id, "ready", "/tmp/busy.git");
    db.tasks.create({ title: "Busy", repoId: repo.id, status: "in_progress" });

    const res = await buildApp(db).request(`/api/repos/${repo.id}/local-clone`, {
      method: "DELETE",
    });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/repos/local-clones/purge", () => {
  it("purges local clones for idle repos and skips busy or missing ones", async () => {
    const db = makeDb();
    const deleted: Array<{ barePath: string; repoName: string }> = [];

    const idle = db.repos.create({ url: "https://github.com/org/idle.git" });
    const busy = db.repos.create({ url: "https://github.com/org/busy.git" });
    const missing = db.repos.create({ url: "https://github.com/org/missing.git" });
    db.repos.updateStatus(idle.id, "ready", "/tmp/idle.git");
    db.repos.updateStatus(busy.id, "ready", "/tmp/busy.git");
    db.tasks.create({ title: "Busy", repoId: busy.id, status: "in_progress" });

    const res = await buildApp(
      db,
      makeGit({
        deleteLocalRepo: async (barePath: string, repoName: string) => {
          deleted.push({ barePath, repoName });
        },
      })
    ).request("/api/repos/local-clones/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { deleted: 1, skipped: 2 } });
    expect(deleted).toEqual([{ barePath: "/tmp/idle.git", repoName: "idle" }]);
    expect(db.repos.getById(idle.id)?.status).toBe("pending");
    expect(db.repos.getById(busy.id)?.status).toBe("ready");
    expect(db.repos.getById(missing.id)?.status).toBe("pending");
  });

  it("returns 400 without explicit confirmation", async () => {
    const res = await buildApp(makeDb()).request("/api/repos/local-clones/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/repos/:id/refresh", () => {
  it("resets repo status to pending", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/refresh.git" });
    db.repos.updateStatus(repo.id, "ready", "/tmp/repo.git");

    const res = await buildApp(db).request(`/api/repos/${repo.id}/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(db.repos.getById(repo.id)?.status).toBe("pending");
  });

  it("returns 404 for unknown repo", async () => {
    const res = await buildApp(makeDb()).request("/api/repos/ghost/refresh", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("remote operations", () => {
  it("GET /api/repos/github/list returns 500 on error", async () => {
    const db = makeDb();
    const git = makeGit({ listRemoteRepos: async () => Promise.reject(new Error("GH Error")) });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/github/list");
    expect(res.status).toBe(500);
  });
  it("GET /api/repos/github/list returns repos", async () => {
    const db = makeDb();
    const git = makeGit({ listRemoteRepos: async () => [{ id: "1", name: "test", fullName: "test/test", htmlUrl: "https://github.com", provider: "github" }] });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/github/list");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data[0].name).toBe("test");
  });
  it("GET /api/repos/github/search returns 500 on error", async () => {
    const db = makeDb();
    const git = makeGit({ searchRemoteRepos: async () => Promise.reject(new Error("GH Error")) });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/github/search?q=test");
    expect(res.status).toBe(500);
  });
  it("GET /api/repos/github/search returns repos", async () => {
    const db = makeDb();
    const git = makeGit({ searchRemoteRepos: async () => [{ id: "1", name: "test", fullName: "test/test", htmlUrl: "https://github.com", provider: "github" }] });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/github/search?q=test");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data[0].name).toBe("test");
  });
  it("POST /api/repos/github/create returns 500 on error", async () => {
    const db = makeDb();
    const git = makeGit({ createRemoteRepo: async () => Promise.reject(new Error("GH Error")) });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/github/create", { method: "POST", body: JSON.stringify({ name: "test" }) });
    expect(res.status).toBe(500);
  });
  it("POST /api/repos/github/create returns repo", async () => {
    const db = makeDb();
    const git = makeGit({ createRemoteRepo: async () => ({ id: "1", name: "test", fullName: "test/test", htmlUrl: "https://github.com", provider: "github" }) });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/github/create", { method: "POST", body: JSON.stringify({ name: "test" }) });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.name).toBe("test");
  });
  it("POST /api/repos/github/create returns 400 for bad input", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/github/create", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
  it("GET /api/repos/gitlab/list returns 500 on error", async () => {
    const db = makeDb();
    const git = makeGit({ listRemoteRepos: async () => Promise.reject(new Error("GL Error")) });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/gitlab/list");
    expect(res.status).toBe(500);
  });
  it("GET /api/repos/gitlab/list returns repos", async () => {
    const db = makeDb();
    const git = makeGit({ listRemoteRepos: async () => [{ id: "1", name: "test", fullName: "test/test", htmlUrl: "https://gitlab.com", provider: "gitlab" }] });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/gitlab/list");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data[0].name).toBe("test");
  });
  it("GET /api/repos/gitlab/search returns 500 on error", async () => {
    const db = makeDb();
    const git = makeGit({ searchRemoteRepos: async () => Promise.reject(new Error("GL Error")) });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/gitlab/search?q=test");
    expect(res.status).toBe(500);
  });
  it("GET /api/repos/gitlab/search returns repos", async () => {
    const db = makeDb();
    const git = makeGit({ searchRemoteRepos: async () => [{ id: "1", name: "test", fullName: "test/test", htmlUrl: "https://gitlab.com", provider: "gitlab" }] });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/gitlab/search?q=test");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data[0].name).toBe("test");
  });
  it("POST /api/repos/gitlab/create returns 500 on error", async () => {
    const db = makeDb();
    const git = makeGit({ createRemoteRepo: async () => Promise.reject(new Error("GL Error")) });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/gitlab/create", { method: "POST", body: JSON.stringify({ name: "test" }) });
    expect(res.status).toBe(500);
  });
  it("POST /api/repos/gitlab/create returns repo", async () => {
    const db = makeDb();
    const git = makeGit({ createRemoteRepo: async () => ({ id: "1", name: "test", fullName: "test/test", htmlUrl: "https://gitlab.com", provider: "gitlab" }) });
    const app = buildApp(db, git);
    const res = await app.request("/api/repos/gitlab/create", { method: "POST", body: JSON.stringify({ name: "test" }) });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.name).toBe("test");
  });
  it("POST /api/repos/gitlab/create returns 400 for bad input", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/gitlab/create", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
  it("GET /api/repos/github/search returns empty if no q", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/github/search");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data).toEqual([]);
  });
  it("GET /api/repos/gitlab/search returns empty if no q", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/gitlab/search");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data).toEqual([]);
  });
});

describe("GET /api/repos/:id/branches", () => {
  it("returns branches for repo", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/repo.git" });
    const git = makeGit({ listRemoteBranches: async () => ["feature1", "main"] });
    const app = buildApp(db, git);

    const res = await app.request(`/api/repos/${repo.id}/branches`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.data).toEqual(["main", "feature1"]);
  });

  it("returns 404 for unknown repo", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/ghost/branches");
    expect(res.status).toBe(404);
  });

  it("returns 500 on git error", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/repo.git" });
    const git = makeGit({ listRemoteBranches: async () => Promise.reject(new Error("Git Error")) });
    const app = buildApp(db, git);

    const res = await app.request(`/api/repos/${repo.id}/branches`);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/repos/:id/issues", () => {
  it("returns issues", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/repo.git" });
    const git = makeGit({ listIssues: async () => [{ number: 1, title: "Issue 1" } as any] });
    const app = buildApp(db, git);
    const res = await app.request(`/api/repos/${repo.id}/issues?state=open&labels=bug,enhancement`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.data.length).toBe(1);
  });

  it("returns 404 for unknown repo", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/ghost/issues");
    expect(res.status).toBe(404);
  });

  it("returns 500 on error", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/repo.git" });
    const git = makeGit({ listIssues: async () => Promise.reject(new Error("Issues error")) });
    const app = buildApp(db, git);
    const res = await app.request(`/api/repos/${repo.id}/issues`);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/repos/:id/findings", () => {
  it("returns findings", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/repo.git" });
    const task = db.tasks.create({ repoId: repo.id, branchName: "main", title: "test", description: "desc", engine: "opencode" });
    const run = db.runs.create(task.id, "opencode", "test");
    db.findings.create({ repoId: repo.id, runId: run.id, taskId: task.id, persona: "frontend", content: "issue", severity: "warning" });
    const app = buildApp(db);
    const res = await app.request(`/api/repos/${repo.id}/findings?limit=10`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.data.length).toBe(1);
  });

  it("returns 404 for unknown repo", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/ghost/findings");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/repos/:id/skills", () => {
  it("returns empty if no localPath", async () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/org/repo.git" });
    const app = buildApp(db);
    const res = await app.request(`/api/repos/${repo.id}/skills`);
    expect(res.status).toBe(200);
  });
  it("returns 404 for unknown repo", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/ghost/skills");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/repos/:id/manifests", () => {
  it("returns 404 for unknown repo", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/repos/ghost/manifests");
    expect(res.status).toBe(404);
  });

  it("returns 500 on load error", async () => {
     const db = makeDb();
     const repo = db.repos.create({ url: "https://github.com/org/repo.git" });
     const app = buildApp(db);
     const res = await app.request(`/api/repos/${repo.id}/manifests`);
     expect(res.status).toBe(500); // Because it attempts to load from non-existent git dir probably
  });
});
