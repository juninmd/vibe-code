import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SidecarRun {
  id: string;
  repo_url: string;
  task_id: string | null;
  prompt: string | null;
  status: string;
  logs_summary: string | null;
  created_at: string;
}

export interface SidecarLearning {
  id: number;
  repo_url: string;
  note: string;
  created_at: string;
}

export interface SidecarDb {
  insertRun(run: Omit<SidecarRun, "created_at">): void;
  updateRun(
    id: string,
    patch: Partial<Pick<SidecarRun, "task_id" | "status" | "logs_summary">>
  ): void;
  getRecentRuns(repo_url: string, limit: number): SidecarRun[];
  insertLearning(repo_url: string, note: string): void;
  getLearnings(repo_url: string): SidecarLearning[];
  close(): void;
}

export function initSidecarDb(dbPath?: string): SidecarDb {
  const path = dbPath ?? join(homedir(), ".vibe-code", "sidecar.db");
  if (path !== ":memory:") mkdirSync(join(path, ".."), { recursive: true });

  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      repo_url TEXT NOT NULL,
      task_id TEXT,
      prompt TEXT,
      status TEXT NOT NULL,
      logs_summary TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_url TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const stmts = {
    insertRun: db.prepare(
      "INSERT INTO runs (id, repo_url, task_id, prompt, status, logs_summary) VALUES (?, ?, ?, ?, ?, ?)"
    ),
    updateRun: db.prepare<unknown, [string, string | null, string | null, string]>(
      "UPDATE runs SET status = ?, task_id = COALESCE(?, task_id), logs_summary = COALESCE(?, logs_summary) WHERE id = ?"
    ),
    getRecentRuns: db.prepare<SidecarRun, [string, number]>(
      "SELECT * FROM runs WHERE repo_url = ? ORDER BY created_at DESC LIMIT ?"
    ),
    insertLearning: db.prepare("INSERT INTO learnings (repo_url, note) VALUES (?, ?)"),
    getLearnings: db.prepare<SidecarLearning, [string]>(
      "SELECT * FROM learnings WHERE repo_url = ? ORDER BY created_at DESC"
    ),
  };

  return {
    insertRun(run) {
      stmts.insertRun.run(
        run.id,
        run.repo_url,
        run.task_id,
        run.prompt,
        run.status,
        run.logs_summary
      );
    },
    updateRun(id, patch) {
      stmts.updateRun.run(
        patch.status ?? null,
        patch.task_id ?? null,
        patch.logs_summary ?? null,
        id
      );
    },
    getRecentRuns(repo_url, limit) {
      return stmts.getRecentRuns.all(repo_url, limit);
    },
    insertLearning(repo_url, note) {
      stmts.insertLearning.run(repo_url, note);
    },
    getLearnings(repo_url) {
      return stmts.getLearnings.all(repo_url);
    },
    close() {
      db.close();
    },
  };
}

export { randomUUID };
