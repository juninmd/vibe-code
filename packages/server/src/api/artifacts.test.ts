import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { ArtifactStore, artifactLimits } from "../artifacts/store";
import { createDb } from "../db";
import { createTasksRouter } from "./tasks";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "vibe-artifacts-api-"));
  roots.push(dataDir);
  const worktree = join(dataDir, "worktree");
  await mkdir(join(worktree, "docs"), { recursive: true });
  const db = createDb(":memory:");
  db.settings.set("auth_enabled", "false");
  const repo = db.repos.create({ url: `https://github.com/acme/r-${Math.random()}.git` });
  const task = db.tasks.create({ title: "Session", repoId: repo.id });
  const run = db.runs.create(task.id, "opencode");
  db.runs.updateStatus(run.id, "completed", { worktree_path: worktree });
  const other = db.tasks.create({ title: "Other", repoId: repo.id });
  const store = new ArtifactStore(db, artifactLimits(dataDir));
  const app = new Hono();
  app.route("/api/tasks", createTasksRouter(db, {} as never, undefined, undefined, store));
  return { db, task, other, worktree, store, app };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

describe("artifacts API", () => {
  it("stores an upload and streams an image inline", async () => {
    const { app, task } = await setup();
    const upload = await app.request(`/api/tasks/${task.id}/artifacts/upload`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-file-name": "print.png" },
      body: PNG,
    });
    expect(upload.status).toBe(201);
    const artifact = (await upload.json()).data;
    expect(artifact.downloadUrl).toContain(`/api/tasks/${task.id}/artifacts/`);
    expect(artifact.expiresAt).toBeTruthy();

    const file = await app.request(artifact.downloadUrl);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-disposition")).toContain("inline");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it("downloads other types as an attachment", async () => {
    const { app, task } = await setup();
    const upload = await app.request(`/api/tasks/${task.id}/artifacts/upload`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-file-name": "report.pdf" },
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });
    const artifact = (await upload.json()).data;
    const file = await app.request(artifact.downloadUrl);
    expect(file.headers.get("content-disposition")).toContain("attachment");
    expect(file.headers.get("content-disposition")).toContain("report.pdf");
  });

  it("registers a file from the session worktree", async () => {
    const { app, task, worktree } = await setup();
    await writeFile(join(worktree, "docs", "shot.png"), PNG);
    const res = await app.request(`/api/tasks/${task.id}/artifacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "docs/shot.png", title: "Print" }),
    });
    expect(res.status).toBe(201);
    const artifact = (await res.json()).data;
    expect(artifact.title).toBe("Print");
    const file = await app.request(artifact.downloadUrl);
    expect(file.status).toBe(200);
  });

  it("refuses a path outside the worktree", async () => {
    const { app, task } = await setup();
    const res = await app.request(`/api/tasks/${task.id}/artifacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../../etc/passwd" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("does not leak an artifact through another task id", async () => {
    const { app, task, other } = await setup();
    const upload = await app.request(`/api/tasks/${task.id}/artifacts/upload`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-file-name": "print.png" },
      body: PNG,
    });
    const artifact = (await upload.json()).data;
    const file = await app.request(`/api/tasks/${other.id}/artifacts/${artifact.id}/file`);
    expect(file.status).toBe(404);
  });

  it("exposes storage usage with the listing", async () => {
    const { app, task } = await setup();
    await app.request(`/api/tasks/${task.id}/artifacts/upload`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-file-name": "print.png" },
      body: PNG,
    });
    const list = await app.request(`/api/tasks/${task.id}/artifacts`);
    const body = await list.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].downloadUrl).toContain("/file");
    expect(body.storage.usedBytes).toBe(PNG.byteLength);
  });
});
