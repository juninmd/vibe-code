import { Database } from "bun:sqlite";

export function initDatabase(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name           TEXT NOT NULL,
      url            TEXT NOT NULL UNIQUE,
      default_branch TEXT NOT NULL DEFAULT 'main',
      local_path     TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      error_message  TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      title          TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      repo_id        TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      status         TEXT NOT NULL DEFAULT 'backlog',
      engine         TEXT,
      priority       INTEGER NOT NULL DEFAULT 0,
      column_order   REAL NOT NULL DEFAULT 0,
      branch_name    TEXT,
      pr_url         TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      engine         TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'queued',
      current_status TEXT,
      worktree_path  TEXT,
      started_at     TEXT,
      finished_at    TEXT,
      exit_code      INTEGER,
      error_message  TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id         TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      stream         TEXT NOT NULL DEFAULT 'stdout',
      content        TEXT NOT NULL,
      timestamp      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_repo_id ON tasks(repo_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_run_id ON agent_logs(run_id);
  `);

  return db;
}
