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
    expect((await res.json()).data.ok).toBe(true);
    expect(db.repos.getById(repo.id)).toBeNull();
  });

  it("returns 404 for unknown repo", async () => {
    const res = await buildApp(makeDb()).request("/api/repos/ghost", { method: "DELETE" });
    expect(res.status).toBe(404);
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
