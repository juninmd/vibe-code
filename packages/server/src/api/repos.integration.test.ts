/**
 * Integration tests for the repos API router.
 * Uses a real SQLite :memory: database and a stubbed GitService/BroadcastHub.
 */
import { describe, expect, it } from "bun:test";
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
