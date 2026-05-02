import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "./index";

describe("Database index", () => {
  const tmpDir = join(process.cwd(), "tmp_test_db");

  beforeEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("creates db and applies migrations", () => {
    const dbPath = join(tmpDir, "test.sqlite");

    // First time creation applies full schema
    const db = createDb(dbPath);
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
    const dbPath = join(tmpDir, "old_test.sqlite");
    const tmpDb = require("bun:sqlite").Database.open(dbPath);

    tmpDb.exec(`
      CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, description TEXT, repo_id TEXT, status TEXT, engine TEXT, priority INTEGER, column_order REAL, branch_name TEXT, pr_url TEXT, error_message TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE agent_runs (id TEXT PRIMARY KEY, task_id TEXT, engine TEXT, status TEXT, worktree_path TEXT, started_at TEXT, finished_at TEXT, exit_code INTEGER, error_message TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE repositories (id TEXT PRIMARY KEY, name TEXT, url TEXT, default_branch TEXT, local_path TEXT, status TEXT, error_message TEXT, created_at TEXT, updated_at TEXT);
    `);

    // Add just one field, missing the others
    tmpDb.exec("ALTER TABLE agent_runs ADD COLUMN current_status TEXT");
    tmpDb.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT");

    tmpDb.close();

    const db = createDb(dbPath);

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
});
