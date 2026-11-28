import { describe, expect, it } from "bun:test";
import { nanoid } from "nanoid";
import { createDb } from "./index";

describe("Database queries extra coverage", () => {
  it("task operations", () => {
    const db = createDb(":memory:");

    db.workspaces.create({ slug: "ws1", name: "w" });
    const ws = db.workspaces.getBySlug("ws1");
    db.repos.create({
      workspaceId: ws?.id,
      url: "u",

      defaultBranch: "b",
    });

    const repos = db.repos.list(ws?.id);
    const repo1Id = repos[0].id;

    const _taskId = nanoid(16);
    db.tasks.create({
      repoId: repo1Id,
      title: "Task",
      status: "done",
      description: "Desc",
    });

    const _failedId = nanoid(16);
    db.tasks.create({
      repoId: repo1Id,
      title: "Task2",
      status: "failed",
      description: "Desc",
    });

    const cleared = db.tasks.clearFailed(repo1Id);
    expect(cleared).toBe(1);

    const clearedAll = db.tasks.clearFailed();
    expect(clearedAll).toBe(0);

    const archivedCount = db.tasks.archiveDone(repo1Id);
    expect(archivedCount).toBe(1);

    const archivedCountAll = db.tasks.archiveDone();
    expect(archivedCountAll).toBe(0); // already archived

    db.close();
  });

  it("repo operations", () => {
    const db = createDb(":memory:");

    db.workspaces.create({ slug: "ws_r", name: "w" });
    const ws = db.workspaces.getBySlug("ws_r");

    const r = db.repos.create({
      workspaceId: ws?.id,
      url: "github.com/a/b",

      defaultBranch: "main",

      provider: "github",
    });
    expect(r.name).toBe("b");

    const r2 = db.repos.getById(r.id);
    expect(r2?.name).toBe("b");

    const list = db.repos.listByIds([r.id]);
    expect(list.length).toBe(1);
    expect(db.repos.listByIds([]).length).toBe(0);

    db.repos.updateStatus(r.id, "cloning", null, null);
    const r3 = db.repos.getById(r.id);
    expect(r3?.status).toBe("cloning");

    db.repos.remove(r.id);
    expect(db.repos.getById(r.id)).toBeNull();

    db.close();
  });
});
