import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { resolveAccountForIdentity } from "../accounts";
import { createDb } from "../db";
import { createProjectsRouter } from "./projects";

type Db = ReturnType<typeof createDb>;

const ENV = ["VIBE_CODE_API_KEY", "VIBE_CODE_ALLOWED_EMAILS"];

function setup() {
  const db = createDb(":memory:");
  db.settings.set("auth_enabled", "false");
  const app = new Hono();
  app.route("/api/projects", createProjectsRouter(db));
  return { db, app };
}

function repo(db: Db, workspaceId: string | null, name: string) {
  return db.repos.create({
    url: `https://github.com/acme/${name}.git`,
    workspaceId: workspaceId ?? undefined,
  });
}

function session(db: Db, accountId: string, email: string) {
  const token = `t-${Math.random()}`;
  db.raw
    .prepare(
      "INSERT INTO auth_sessions (id, github_id, username, access_token, expires_at, account_id, provider) VALUES (?, ?, ?, '', ?, ?, 'github')"
    )
    .run(
      createHash("sha256").update(token).digest("hex"),
      "gh-1",
      "user",
      "9999-01-01T00:00:00.000Z",
      accountId
    );
  return { Cookie: `vibe_session=${token}`, "Content-Type": "application/json" };
}

describe("projects", () => {
  let previous: Record<string, string | undefined> = {};
  beforeEach(() => {
    previous = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
    for (const key of ENV) delete process.env[key];
  });
  afterEach(() => {
    for (const key of ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("groups one or more repositories and lets a repo live in several projects", async () => {
    const { db, app } = setup();
    const workspace = db.workspaces.create({ name: "W", slug: "w" });
    const a = repo(db, workspace.id, "a");
    const b = repo(db, workspace.id, "b");

    const create = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Produto", repoIds: [a.id, b.id] }),
    });
    expect(create.status).toBe(201);
    const project = (await create.json()).data;
    expect(project.repoIds.sort()).toEqual([a.id, b.id].sort());

    const second = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Outro", repoIds: [a.id] }),
    });
    expect(second.status).toBe(201);
    expect(db.projects.listProjectsForRepo(a.id)).toHaveLength(2);

    const list = await app.request(`/api/projects?workspace_id=${workspace.id}`);
    expect((await list.json()).data).toHaveLength(2);
    expect(db.projects.listProjectsForRepo(b.id)).toHaveLength(1);
    db.close();
  });

  it("rejects a repository from another workspace", async () => {
    const { db, app } = setup();
    const mine = db.workspaces.create({ name: "Mine", slug: "mine" });
    const other = db.workspaces.create({ name: "Other", slug: "other" });
    const foreign = repo(db, other.id, "foreign");
    const response = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope", repoIds: [foreign.id] }),
    });
    // Operator scope picks the oldest workspace (mine) and refuses the foreign repo.
    expect(response.status).toBe(403);
    expect(db.projects.listByWorkspace(mine.id)).toHaveLength(0);
    db.close();
  });

  it("persists project and branch pair on a session", () => {
    const { db } = setup();
    const workspace = db.workspaces.create({ name: "W", slug: "w2" });
    const r = repo(db, workspace.id, "c");
    const project = db.projects.create({ workspaceId: workspace.id, name: "P" });
    db.projects.addRepo(project.id, r.id);

    const task = db.tasks.create({
      title: "Session",
      repoId: r.id,
      projectId: project.id,
      baseBranch: "release",
      startBranch: "develop",
      prTargetBranch: "release",
    });
    expect(task.projectId).toBe(project.id);
    expect(task.startBranch).toBe("develop");
    expect(task.prTargetBranch).toBe("release");
    // The worktree keeps using baseBranch, which mirrors the start branch.
    expect(task.baseBranch).toBe("develop");

    const reloaded = db.tasks.getById(task.id);
    expect(reloaded?.projectId).toBe(project.id);
    expect(reloaded?.prTargetBranch).toBe("release");
    db.close();
  });

  it("denies a project owned by another workspace to an account session", async () => {
    const { db, app } = setup();
    process.env.VIBE_CODE_API_KEY = "enabled";
    process.env.VIBE_CODE_ALLOWED_EMAILS = "jr_acn@hotmail.com";
    db.settings.set("auth_enabled", "true");
    const { account } = resolveAccountForIdentity(db, {
      provider: "github",
      subject: "gh-1",
      email: "jr_acn@hotmail.com",
      username: "user",
      displayName: null,
      avatarUrl: null,
      accessToken: "",
    });
    const mine = db.workspaces.create({
      name: "Mine",
      slug: "acc-mine",
      ownerAccountId: account.id,
    });
    const foreign = db.workspaces.create({ name: "Bob", slug: "bob", ownerAccountId: "acc-bob" });
    const foreignProject = db.projects.create({ workspaceId: foreign.id, name: "Bob's" });
    const mineProject = db.projects.create({ workspaceId: mine.id, name: "Mine" });

    const headers = session(db, account.id, "jr_acn@hotmail.com");
    const own = await app.request(`/api/projects/${mineProject.id}`, { headers });
    expect(own.status).toBe(200);
    const denied = await app.request(`/api/projects/${foreignProject.id}`, {
      headers: { ...headers, "x-workspace-id": mine.id },
    });
    expect(denied.status).toBe(403);

    const created = await app.request("/api/projects", {
      method: "POST",
      headers: { ...headers, "x-workspace-id": mine.id },
      body: JSON.stringify({ name: "New" }),
    });
    expect(created.status).toBe(201);
    expect(db.projects.listByWorkspace(mine.id)).toHaveLength(2);
    db.close();
  });
});
