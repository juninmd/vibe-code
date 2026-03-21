import { Database } from "bun:sqlite";
import type {
  Repository,
  Task,
  AgentRun,
  AgentLog,
  CreateRepoRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  TaskWithRun,
} from "@vibe-code/shared";

// ─── Row types (snake_case from SQLite) ──────────────────────────────────────

interface RepoRow {
  id: string;
  name: string;
  url: string;
  default_branch: string;
  local_path: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  repo_id: string;
  status: string;
  engine: string | null;
  priority: number;
  column_order: number;
  branch_name: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  task_id: string;
  engine: string;
  status: string;
  worktree_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error_message: string | null;
  created_at: string;
}

interface LogRow {
  id: number;
  run_id: string;
  stream: string;
  content: string;
  timestamp: string;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapRepo(row: RepoRow): Repository {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    defaultBranch: row.default_branch,
    localPath: row.local_path,
    status: row.status as Repository["status"],
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    repoId: row.repo_id,
    status: row.status as Task["status"],
    engine: row.engine,
    priority: row.priority,
    columnOrder: row.column_order,
    branchName: row.branch_name,
    prUrl: row.pr_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    taskId: row.task_id,
    engine: row.engine,
    status: row.status as AgentRun["status"],
    worktreePath: row.worktree_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function mapLog(row: LogRow): AgentLog {
  return {
    id: row.id,
    runId: row.run_id,
    stream: row.stream as AgentLog["stream"],
    content: row.content,
    timestamp: row.timestamp,
  };
}

// ─── Repository Queries ──────────────────────────────────────────────────────

export function createRepoQueries(db: Database) {
  const stmts = {
    list: db.prepare<RepoRow, []>("SELECT * FROM repositories ORDER BY created_at DESC"),
    getById: db.prepare<RepoRow, [string]>("SELECT * FROM repositories WHERE id = ?"),
    getByUrl: db.prepare<RepoRow, [string]>("SELECT * FROM repositories WHERE url = ?"),
    insert: db.prepare<RepoRow, [string, string, string]>(
      "INSERT INTO repositories (name, url, default_branch) VALUES (?, ?, ?) RETURNING *"
    ),
    updateStatus: db.prepare<RepoRow, [string, string | null, string | null, string]>(
      "UPDATE repositories SET status = ?, local_path = ?, error_message = ?, updated_at = datetime('now') WHERE id = ? RETURNING *"
    ),
    remove: db.prepare<null, [string]>("DELETE FROM repositories WHERE id = ?"),
  };

  return {
    list: (): Repository[] => stmts.list.all().map(mapRepo),
    getById: (id: string): Repository | null => {
      const row = stmts.getById.get(id);
      return row ? mapRepo(row) : null;
    },
    create: (req: CreateRepoRequest): Repository => {
      const name = extractRepoName(req.url);
      const row = stmts.insert.get(name, req.url, req.defaultBranch ?? "main")!;
      return mapRepo(row);
    },
    updateStatus: (id: string, status: string, localPath?: string | null, error?: string | null): Repository | null => {
      const row = stmts.updateStatus.get(status, localPath ?? null, error ?? null, id);
      return row ? mapRepo(row) : null;
    },
    remove: (id: string): void => {
      stmts.remove.run(id);
    },
  };
}

// ─── Task Queries ────────────────────────────────────────────────────────────

export function createTaskQueries(db: Database) {
  const stmts = {
    list: db.prepare<TaskRow, []>("SELECT * FROM tasks ORDER BY column_order ASC, created_at DESC"),
    listByRepo: db.prepare<TaskRow, [string]>(
      "SELECT * FROM tasks WHERE repo_id = ? ORDER BY column_order ASC, created_at DESC"
    ),
    listByStatus: db.prepare<TaskRow, [string]>(
      "SELECT * FROM tasks WHERE status = ? ORDER BY column_order ASC"
    ),
    getById: db.prepare<TaskRow, [string]>("SELECT * FROM tasks WHERE id = ?"),
    insert: db.prepare<TaskRow, [string, string, string, string | null, number]>(
      "INSERT INTO tasks (title, description, repo_id, engine, priority) VALUES (?, ?, ?, ?, ?) RETURNING *"
    ),
    update: db.prepare("UPDATE tasks SET updated_at = datetime('now')"),
    remove: db.prepare<null, [string]>("DELETE FROM tasks WHERE id = ?"),
    maxOrder: db.prepare<{ max_order: number | null }, [string]>(
      "SELECT MAX(column_order) as max_order FROM tasks WHERE status = ?"
    ),
  };

  return {
    list: (repoId?: string, status?: string): Task[] => {
      if (repoId) return stmts.listByRepo.all(repoId).map(mapTask);
      if (status) return stmts.listByStatus.all(status).map(mapTask);
      return stmts.list.all().map(mapTask);
    },
    getById: (id: string): Task | null => {
      const row = stmts.getById.get(id);
      return row ? mapTask(row) : null;
    },
    create: (req: CreateTaskRequest): Task => {
      const maxOrderRow = stmts.maxOrder.get("backlog");
      const order = (maxOrderRow?.max_order ?? 0) + 1;
      const row = db
        .prepare<TaskRow, [string, string, string, string | null, number, number]>(
          "INSERT INTO tasks (title, description, repo_id, engine, priority, column_order) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
        )
        .get(req.title, req.description ?? "", req.repoId, req.engine ?? null, req.priority ?? 0, order)!;
      return mapTask(row);
    },
    update: (id: string, req: UpdateTaskRequest): Task | null => {
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      if (req.title !== undefined) { sets.push("title = ?"); values.push(req.title); }
      if (req.description !== undefined) { sets.push("description = ?"); values.push(req.description); }
      if (req.status !== undefined) { sets.push("status = ?"); values.push(req.status); }
      if (req.columnOrder !== undefined) { sets.push("column_order = ?"); values.push(req.columnOrder); }
      if (req.engine !== undefined) { sets.push("engine = ?"); values.push(req.engine ?? null); }
      if (sets.length === 0) return stmts.getById.get(id) ? mapTask(stmts.getById.get(id)!) : null;
      sets.push("updated_at = datetime('now')");
      values.push(id);
      const sql = `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? RETURNING *`;
      const row = db.prepare(sql).get(...values) as TaskRow | null;
      return row ? mapTask(row) : null;
    },
    updateField: (id: string, field: string, value: string | number | null): Task | null => {
      const sql = `UPDATE tasks SET ${field} = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`;
      const row = db.prepare(sql).get(value, id) as TaskRow | null;
      return row ? mapTask(row) : null;
    },
    remove: (id: string): void => {
      stmts.remove.run(id);
    },
  };
}

// ─── Agent Run Queries ───────────────────────────────────────────────────────

export function createRunQueries(db: Database) {
  const stmts = {
    listByTask: db.prepare<RunRow, [string]>(
      "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC"
    ),
    getById: db.prepare<RunRow, [string]>("SELECT * FROM agent_runs WHERE id = ?"),
    getLatestByTask: db.prepare<RunRow, [string]>(
      "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1"
    ),
    insert: db.prepare<RunRow, [string, string]>(
      "INSERT INTO agent_runs (task_id, engine) VALUES (?, ?) RETURNING *"
    ),
  };

  return {
    listByTask: (taskId: string): AgentRun[] => stmts.listByTask.all(taskId).map(mapRun),
    getById: (id: string): AgentRun | null => {
      const row = stmts.getById.get(id);
      return row ? mapRun(row) : null;
    },
    getLatestByTask: (taskId: string): AgentRun | null => {
      const row = stmts.getLatestByTask.get(taskId);
      return row ? mapRun(row) : null;
    },
    create: (taskId: string, engine: string): AgentRun => {
      const row = stmts.insert.get(taskId, engine)!;
      return mapRun(row);
    },
    updateStatus: (id: string, status: string, extra?: Record<string, string | number | null>): AgentRun | null => {
      const sets = ["status = ?"];
      const values: (string | number | null)[] = [status];
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          sets.push(`${key} = ?`);
          values.push(value);
        }
      }
      values.push(id);
      const sql = `UPDATE agent_runs SET ${sets.join(", ")} WHERE id = ? RETURNING *`;
      const row = db.prepare(sql).get(...values) as RunRow | null;
      return row ? mapRun(row) : null;
    },
  };
}

// ─── Agent Log Queries ───────────────────────────────────────────────────────

export function createLogQueries(db: Database) {
  const stmts = {
    listByRun: db.prepare<LogRow, [string]>(
      "SELECT * FROM agent_logs WHERE run_id = ? ORDER BY id ASC"
    ),
    insert: db.prepare<LogRow, [string, string, string]>(
      "INSERT INTO agent_logs (run_id, stream, content) VALUES (?, ?, ?) RETURNING *"
    ),
  };

  return {
    listByRun: (runId: string): AgentLog[] => stmts.listByRun.all(runId).map(mapLog),
    create: (runId: string, stream: string, content: string): AgentLog => {
      const row = stmts.insert.get(runId, stream, content)!;
      return mapLog(row);
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractRepoName(url: string): string {
  // Handle GitHub URLs like https://github.com/user/repo or git@github.com:user/repo.git
  const match = url.match(/([^/\\:]+?)(?:\.git)?$/);
  return match?.[1] ?? url;
}
