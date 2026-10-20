import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./index";

describe("Database index", () => {
  let tmpDir: string;
  const opened: ReturnType<typeof createDb>[] = [];

  const createFixtureDb = (fileName: string) => {
    const db = createDb(join(tmpDir, fileName));
    opened.push(db);
    return db;
  };

  beforeEach(() => {
    // Unique directory per test: a shared fixture path races when the suite is
    // re-run in the same working tree (the previous run may still hold handles).
    tmpDir = mkdtempSync(join(tmpdir(), "vibe-db-index-"));
  });

  afterEach(() => {
    while (opened.length > 0) {
      const db = opened.pop();
      try {
        db?.close();
      } catch {}
    }
    // Windows can hold a freshly released file for a few milliseconds (indexers,
    // antivirus), so retry instead of flaking the suite. Bun's fs.rm ignores
    // maxRetries, hence the explicit loop.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 9) throw error;
        Bun.sleepSync(50);
      }
    }
  });

  it("creates db and applies migrations", () => {
    // First time creation applies full schema
    const db = createFixtureDb("test.sqlite");
    expect(db).toBeDefined();

    // Test that all migrated columns exist
    const runCols = db.raw.query("PRAGMA table_info(agent_runs)").all() as { name: string }[];
    const runColNames = runCols.map((c) => c.name);
    expect(runColNames).toContain("current_status");
    expect(runColNames).toContain("litellm_token_id");
    expect(runColNames).toContain("matched_skills");
    expect(runColNames).toContain("state_snapshot");

    const taskCols = db.raw.query("PRAGMA table_info(tasks)").all() as { name: string }[];
    const taskColNames = taskCols.map((c) => c.name);
    expect(taskColNames).toContain("model");
    expect(taskColNames).toContain("parent_task_id");
    expect(taskColNames).toContain("base_branch");

    const repoCols = db.raw.query("PRAGMA table_info(repositories)").all() as { name: string }[];
    const repoColNames = repoCols.map((c) => c.name);
    expect(repoColNames).toContain("provider");
  }, 15000);

  it("migrates from old schema", () => {
    // Seed a legacy database and always release it, even if the setup throws.
    const legacy = new Database(join(tmpDir, "old_test.sqlite"), { create: true });
    try {
      legacy.exec(`
        CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, description TEXT, repo_id TEXT, status TEXT, engine TEXT, priority INTEGER, column_order REAL, branch_name TEXT, pr_url TEXT, error_message TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE agent_runs (id TEXT PRIMARY KEY, task_id TEXT, engine TEXT, status TEXT, worktree_path TEXT, started_at TEXT, finished_at TEXT, exit_code INTEGER, error_message TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE repositories (id TEXT PRIMARY KEY, name TEXT, url TEXT, default_branch TEXT, local_path TEXT, status TEXT, error_message TEXT, created_at TEXT, updated_at TEXT);
      `);

      // Add just one field, missing the others
      legacy.exec("ALTER TABLE agent_runs ADD COLUMN current_status TEXT");
      legacy.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT");
    } finally {
      legacy.close();
    }

    const db = createFixtureDb("old_test.sqlite");

    const runCols = db.raw.query("PRAGMA table_info(agent_runs)").all() as { name: string }[];
    const runColNames = runCols.map((c) => c.name);
    expect(runColNames).toContain("litellm_token_id");
    expect(runColNames).toContain("matched_skills");
    expect(runColNames).toContain("state_snapshot");

    const taskCols = db.raw.query("PRAGMA table_info(tasks)").all() as { name: string }[];
    const taskColNames = taskCols.map((c) => c.name);
    expect(taskColNames).toContain("model");
    expect(taskColNames).toContain("base_branch");

    const repoCols = db.raw.query("PRAGMA table_info(repositories)").all() as { name: string }[];
    const repoColNames = repoCols.map((c) => c.name);
    expect(repoColNames).toContain("provider");
  }, 15000);

  it("close releases the file so the fixture directory can be removed", () => {
    const db = createFixtureDb("close_test.sqlite");
    // Cached statements (factory-time `prepare`) and ad-hoc ones (created per
    // call, e.g. updateSessionId) both keep the file locked until finalized.
    db.tasks.list();
    db.runs.updateSessionId("missing-run", "session-1");
    db.close();
    db.close();

    // Throws EBUSY on Windows when a statement still holds the file.
    expect(() => rmSync(tmpDir, { recursive: true, force: true })).not.toThrow();
  }, 15000);
});
