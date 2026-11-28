import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db";
import { ArtifactError, ArtifactStore, artifactLimits } from "./store";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup(env: Record<string, string> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "vibe-artifacts-"));
  roots.push(dataDir);
  const worktree = join(dataDir, "worktree");
  await mkdir(worktree, { recursive: true });
  const db = createDb(":memory:");
  const workspace = db.workspaces.create({ name: "W", slug: `w-${Math.random()}` });
  const repo = db.repos.create({ url: `https://github.com/acme/r-${Math.random()}.git` });
  const task = db.tasks.create({ title: "Session", repoId: repo.id });
  const run = db.runs.create(task.id, "opencode");
  const store = new ArtifactStore(db, artifactLimits(dataDir, env));
  return { dataDir, worktree, db, task, run, store, workspace };
}

describe("artifact store", () => {
  it("copies a session file under the root with size, mime and checksum", async () => {
    const { worktree, db, task, run, store } = await setup();
    await mkdir(join(worktree, "docs"), { recursive: true });
    await writeFile(join(worktree, "docs", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const artifact = await store.registerFile({
      taskId: task.id,
      runId: run.id,
      sourcePath: "docs/shot.png",
      allowedRoot: worktree,
      title: "Print",
    });

    expect(artifact.fileName).toBe("shot.png");
    expect(artifact.mimeType).toBe("image/png");
    expect(artifact.sizeBytes).toBe(4);
    expect(artifact.sha256).toHaveLength(64);
    expect(artifact.storagePath).toContain(task.id);
    expect(artifact.expiresAt).toBeTruthy();
    expect(artifact.accountId).toBeUndefined();

    const opened = await store.open(task.id, artifact.id);
    expect(opened.inline).toBe(true);
    expect(opened.size).toBe(4);
    expect(await Bun.file(opened.absolutePath).arrayBuffer()).toEqual(
      await Bun.file(join(worktree, "docs", "shot.png")).arrayBuffer()
    );
    db.close();
  });

  it("refuses a source outside the session workspace", async () => {
    const { dataDir, worktree, db, task, store } = await setup();
    await writeFile(join(dataDir, "secret.txt"), "private");
    await expect(
      store.registerFile({
        taskId: task.id,
        sourcePath: join(dataDir, "secret.txt"),
        allowedRoot: worktree,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    db.close();
  });

  it("refuses a symlink that points outside the workspace", async () => {
    const { dataDir, worktree, db, task, store } = await setup();
    await writeFile(join(dataDir, "private.txt"), "private");
    try {
      await symlink(join(dataDir, "private.txt"), join(worktree, "leak.txt"));
    } catch {
      return; // Windows without symlink permission: covered on CI/Linux
    }
    await expect(
      store.registerFile({ taskId: task.id, sourcePath: "leak.txt", allowedRoot: worktree })
    ).rejects.toMatchObject({ code: "forbidden" });
    db.close();
  });

  it("enforces the per-file limit and the account quota", async () => {
    const { worktree, db, task, store } = await setup({
      VIBE_CODE_ARTIFACT_MAX_BYTES: "10",
      VIBE_CODE_ARTIFACT_QUOTA_BYTES: "15",
    });
    await writeFile(join(worktree, "big.txt"), "x".repeat(11));
    await expect(
      store.registerFile({ taskId: task.id, sourcePath: "big.txt", allowedRoot: worktree })
    ).rejects.toMatchObject({ code: "too_large" });

    await writeFile(join(worktree, "a.txt"), "1234567890");
    await writeFile(join(worktree, "b.txt"), "1234567890");
    await store.registerFile({
      taskId: task.id,
      accountId: "acc-1",
      sourcePath: "a.txt",
      allowedRoot: worktree,
    });
    await expect(
      store.registerFile({
        taskId: task.id,
        accountId: "acc-1",
        sourcePath: "b.txt",
        allowedRoot: worktree,
      })
    ).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(store.usage("acc-1").usedBytes).toBe(10);
    db.close();
  });

  it("serves as attachment for non-image types", async () => {
    const { worktree, db, task, store } = await setup();
    await writeFile(join(worktree, "report.pdf"), "%PDF");
    const artifact = await store.registerFile({
      taskId: task.id,
      sourcePath: "report.pdf",
      allowedRoot: worktree,
    });
    const opened = await store.open(task.id, artifact.id);
    expect(opened.mimeType).toBe("application/pdf");
    expect(opened.inline).toBe(false);
    db.close();
  });

  it("rejects a forged storage path and expired artifacts", async () => {
    const { worktree, dataDir, db, task, store } = await setup();
    await writeFile(join(worktree, "a.txt"), "ok");
    const artifact = await store.registerFile({
      taskId: task.id,
      sourcePath: "a.txt",
      allowedRoot: worktree,
    });

    db.raw
      .prepare("UPDATE task_artifacts SET storage_path = ? WHERE id = ?")
      .run("../outside.txt", artifact.id);
    await expect(store.open(task.id, artifact.id)).rejects.toMatchObject({ code: "not_found" });

    db.raw
      .prepare("UPDATE task_artifacts SET storage_path = ?, expires_at = ? WHERE id = ?")
      .run(artifact.storagePath as string, "2000-01-01T00:00:00.000Z", artifact.id);
    await expect(store.open(task.id, artifact.id)).rejects.toMatchObject({ code: "expired" });

    // A symlink planted at the stored path is not followed.
    const target = join(store.limits.root, ...(artifact.storagePath as string).split("/"));
    await rm(target, { force: true });
    try {
      await symlink(join(dataDir, "secret.txt"), target);
      await writeFile(join(dataDir, "secret.txt"), "private");
      db.raw.prepare("UPDATE task_artifacts SET expires_at = NULL WHERE id = ?").run(artifact.id);
      await expect(store.open(task.id, artifact.id)).rejects.toMatchObject({ code: "forbidden" });
    } catch {
      // symlink unavailable on this host
    }
    db.close();
  });

  it("cleans up expired rows and files", async () => {
    const { worktree, db, task, store } = await setup();
    await writeFile(join(worktree, "a.txt"), "ok");
    const artifact = await store.registerFile({
      taskId: task.id,
      sourcePath: "a.txt",
      allowedRoot: worktree,
    });
    db.raw
      .prepare("UPDATE task_artifacts SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", artifact.id);

    expect(await store.cleanupExpired()).toBe(1);
    expect(db.artifacts.getById(task.id, artifact.id)).toBeNull();
    expect(
      await Bun.file(
        join(store.limits.root, ...(artifact.storagePath as string).split("/"))
      ).exists()
    ).toBe(false);
    db.close();
  });
});
