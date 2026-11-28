import { describe, expect, it } from "bun:test";
import { resolveAccountForIdentity } from "../accounts";
import { createDb } from "../db";
import { formatOwnershipReport, migrateOwnership } from "./ownership";

function setup() {
  const db = createDb(":memory:");
  const account = resolveAccountForIdentity(db, {
    provider: "github",
    subject: "gh-1",
    email: "jr_acn@hotmail.com",
    username: "user",
    displayName: null,
    avatarUrl: null,
    accessToken: "",
  }).account;
  const workspace = db.workspaces.create({ name: "W", slug: `w-${Math.random()}` });
  const repo = db.repos.create({
    url: `https://github.com/acme/r-${Math.random()}.git`,
    workspaceId: workspace.id,
  });
  const task = db.tasks.create({ title: "Legacy", repoId: repo.id });
  return { db, account, workspace, repo, task };
}

describe("ownership migration", () => {
  it("dry run reports unmapped workspaces without writing", () => {
    const { db, workspace, repo, task } = setup();
    const report = migrateOwnership(db, {}, { dryRun: true });
    expect(report.ready).toBe(false);
    expect(report.issues.some((issue) => issue.kind === "unmapped_workspace")).toBe(true);
    expect(db.workspaces.get(workspace.id)?.ownerAccountId).toBeUndefined();
    expect(db.tasks.getById(task.id)?.projectId).toBeNull();
    expect(db.projects.listProjectsForRepo(repo.id)).toHaveLength(0);
    db.close();
  });

  it("applies the explicit map, creates the initial project and links tasks", () => {
    const { db, account, workspace, repo, task } = setup();
    const report = migrateOwnership(db, { [workspace.id]: account.id }, { dryRun: false });
    expect(report.ready).toBe(true);
    expect(report.applied.workspaces).toBe(1);
    expect(report.applied.projectsCreated).toBe(1);
    expect(report.applied.tasksLinked).toBe(1);
    expect(db.workspaces.get(workspace.id)?.ownerAccountId).toBe(account.id);
    const projects = db.projects.listProjectsForRepo(repo.id);
    expect(projects).toHaveLength(1);
    expect(projects[0].workspaceId).toBe(workspace.id);
    expect(db.tasks.getById(task.id)?.projectId).toBe(projects[0].id);
    db.close();
  });

  it("is idempotent: a second apply writes nothing", () => {
    const { db, account, workspace } = setup();
    const mapping = { [workspace.id]: account.id };
    migrateOwnership(db, mapping, { dryRun: false });
    const second = migrateOwnership(db, mapping, { dryRun: false });
    expect(second.applied).toEqual({
      workspaces: 0,
      projectsCreated: 0,
      projectsLinked: 0,
      tasksLinked: 0,
    });
    db.close();
  });

  it("blocks the apply when an account does not exist", () => {
    const { db, workspace, task } = setup();
    const report = migrateOwnership(db, { [workspace.id]: "acc-missing" }, { dryRun: false });
    expect(report.ready).toBe(false);
    expect(report.issues.some((issue) => issue.kind === "unknown_account")).toBe(true);
    expect(report.applied.workspaces).toBe(0);
    expect(db.workspaces.get(workspace.id)?.ownerAccountId).toBeUndefined();
    expect(db.tasks.getById(task.id)?.projectId).toBeNull();
    db.close();
  });

  it("blocks on an orphan repository instead of guessing its workspace", () => {
    const { db, account, workspace } = setup();
    const orphan = db.repos.create({ url: "https://github.com/acme/orphan.git" });
    const report = migrateOwnership(db, { [workspace.id]: account.id }, { dryRun: false });
    expect(report.ready).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ kind: "orphan_repository", id: orphan.id })
    );
    expect(report.applied.workspaces).toBe(0);
    db.close();
  });

  it("reports a workspace already owned by another account", () => {
    const { db, account, workspace } = setup();
    db.raw
      .prepare("UPDATE workspaces SET owner_account_id = ? WHERE id = ?")
      .run("acc-other", workspace.id);
    const report = migrateOwnership(db, { [workspace.id]: account.id }, { dryRun: false });
    expect(report.issues.some((issue) => issue.kind === "workspace_conflict")).toBe(true);
    expect(db.workspaces.get(workspace.id)?.ownerAccountId).toBe("acc-other");
    db.close();
  });

  it("reports tasks whose repository disappeared", () => {
    const { db, account, workspace, task } = setup();
    db.raw.exec("PRAGMA foreign_keys = OFF");
    db.raw.prepare("UPDATE tasks SET repo_id = ? WHERE id = ?").run("gone-repo", task.id);
    db.raw.exec("PRAGMA foreign_keys = ON");
    const report = migrateOwnership(db, { [workspace.id]: account.id }, { dryRun: false });
    expect(report.issues).toContainEqual(
      expect.objectContaining({ kind: "orphan_task", id: task.id })
    );
    expect(report.applied.workspaces).toBe(0);
    db.close();
  });

  it("prints a readable report for the operator", () => {
    const { db, account, workspace } = setup();
    const report = migrateOwnership(db, { [workspace.id]: account.id }, { dryRun: true });
    const text = formatOwnershipReport(report);
    expect(text).toContain("ownership migration (dry run)");
    expect(text).toContain(`plan ${workspace.id} -> ${account.id}`);
    expect(text).toContain("ready=true");
    db.close();
  });
});
