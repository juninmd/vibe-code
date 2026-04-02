import type { Database } from "bun:sqlite";
import type {
  AgentLog,
  AgentRun,
  CreatePromptTemplateRequest,
  CreateRepoRequest,
  CreateTaskRequest,
  PromptTemplate,
  Repository,
  Task,
  TaskSchedule,
  TaskStatus,
  UpdateTaskRequest,
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
  model: string | null;
  priority: number;
  column_order: number;
  base_branch: string | null;
  branch_name: string | null;
  pr_url: string | null;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  task_id: string;
  engine: string;
  status: string;
  current_status: string | null;
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
    model: row.model,
    priority: row.priority,
    columnOrder: row.column_order,
    baseBranch: row.base_branch,
    branchName: row.branch_name,
    prUrl: row.pr_url,
    parentTaskId: row.parent_task_id,
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
    currentStatus: row.current_status,
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
    updateStatus: (
      id: string,
      status: string,
      localPath?: string | null,
      error?: string | null
    ): Repository | null => {
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
    create: (req: CreateTaskRequest & { status?: TaskStatus; parentTaskId?: string }): Task => {
      const status = req.status ?? "backlog";
      const maxOrderRow = stmts.maxOrder.get(status);
      const order = (maxOrderRow?.max_order ?? 0) + 1;
      const row = db
        .prepare<
          TaskRow,
          [
            string,
            string,
            string,
            string | null,
            string | null,
            string | null,
            number,
            number,
            string,
            string | null,
          ]
        >(
          "INSERT INTO tasks (title, description, repo_id, engine, model, base_branch, priority, column_order, status, parent_task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
        )
        .get(
          req.title,
          req.description ?? "",
          req.repoId,
          req.engine ?? null,
          req.model ?? null,
          req.baseBranch ?? null,
          req.priority ?? 0,
          order,
          status,
          req.parentTaskId ?? null
        )!;
      return mapTask(row);
    },
    update: (id: string, req: UpdateTaskRequest): Task | null => {
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      if (req.title !== undefined) {
        sets.push("title = ?");
        values.push(req.title);
      }
      if (req.description !== undefined) {
        sets.push("description = ?");
        values.push(req.description);
      }
      if (req.status !== undefined) {
        sets.push("status = ?");
        values.push(req.status);
      }
      if (req.columnOrder !== undefined) {
        sets.push("column_order = ?");
        values.push(req.columnOrder);
      }
      if (req.engine !== undefined) {
        sets.push("engine = ?");
        values.push(req.engine ?? null);
      }
      if (req.model !== undefined) {
        sets.push("model = ?");
        values.push(req.model ?? null);
      }
      if (sets.length === 0) return stmts.getById.get(id) ? mapTask(stmts.getById.get(id)!) : null;
      sets.push("updated_at = datetime('now')");
      values.push(id);
      const sql = `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? RETURNING *`;
      const row = db.prepare(sql).get(...values) as TaskRow | null;
      return row ? mapTask(row) : null;
    },
    updateField: (
      id: string,
      field: "pr_url" | "branch_name" | "status" | "engine" | "model",
      value: string | number | null
    ): Task | null => {
      const allowed = ["pr_url", "branch_name", "status", "engine", "model"] as const;
      if (!allowed.includes(field as (typeof allowed)[number]))
        throw new Error(`Invalid field: ${field}`);
      const sql = `UPDATE tasks SET ${field} = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`;
      const row = db.prepare(sql).get(value, id) as TaskRow | null;
      return row ? mapTask(row) : null;
    },
    remove: (id: string): void => {
      stmts.remove.run(id);
    },
    archiveDone: (repoId?: string): number => {
      const sql = repoId
        ? "UPDATE tasks SET status = 'archived', updated_at = datetime('now') WHERE status = 'done' AND repo_id = ?"
        : "UPDATE tasks SET status = 'archived', updated_at = datetime('now') WHERE status = 'done'";
      const info = db.prepare(repoId ? sql : sql).run(...(repoId ? [repoId] : []));
      return (info as any).changes;
    },
    clearFailed: (repoId?: string): number => {
      const sql = repoId
        ? "DELETE FROM tasks WHERE status = 'failed' AND repo_id = ?"
        : "DELETE FROM tasks WHERE status = 'failed'";
      const info = db.prepare(repoId ? sql : sql).run(...(repoId ? [repoId] : []));
      return (info as any).changes;
    },
    retryFailed: (repoId?: string): number => {
      const sql = repoId
        ? "UPDATE tasks SET status = 'backlog', updated_at = datetime('now') WHERE status = 'failed' AND repo_id = ?"
        : "UPDATE tasks SET status = 'backlog', updated_at = datetime('now') WHERE status = 'failed'";
      const info = db.prepare(repoId ? sql : sql).run(...(repoId ? [repoId] : []));
      return (info as any).changes;
    },
    cleanupArchived: (days = 30): number => {
      const sql =
        "DELETE FROM tasks WHERE status = 'archived' AND updated_at < datetime('now', '-' || ? || ' days')";
      const info = db.prepare(sql).run(days);
      return (info as any).changes;
    },
  };
}

// ─── Agent Run Queries ───────────────────────────────────────────────────────

export function createRunQueries(db: Database) {
  const stmts = {
    listByTask: db.prepare<RunRow, [string]>(
      "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC"
    ),
    getById: db.prepare<RunRow, [string]>("SELECT * FROM agent_runs WHERE id = ?"),
    getLatestByTask: db.prepare<RunRow, [string]>(
      "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
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
    updateStatus: (
      id: string,
      status: string,
      extra?: Partial<
        Record<
          | "started_at"
          | "finished_at"
          | "exit_code"
          | "error_message"
          | "worktree_path"
          | "current_status",
          string | number | null
        >
      >
    ): AgentRun | null => {
      const allowed = [
        "started_at",
        "finished_at",
        "exit_code",
        "error_message",
        "worktree_path",
        "current_status",
      ] as const;
      const sets = ["status = ?"];
      const values: (string | number | null)[] = [status];
      if (extra) {
        for (const key of allowed) {
          if (key in extra) {
            sets.push(`${key} = ?`);
            values.push(extra[key] ?? null);
          }
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

// ─── Settings Queries ────────────────────────────────────────────────────────

export function createSettingsQueries(db: Database) {
  const getStmt = db.prepare<{ value: string }, [string]>(
    "SELECT value FROM settings WHERE key = ?"
  );
  const setStmt = db.prepare<null, [string, string]>(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  );
  const allStmt = db.query<{ key: string; value: string }, []>("SELECT key, value FROM settings");

  return {
    get: (key: string): string | null => getStmt.get(key)?.value ?? null,
    set: (key: string, value: string): void => {
      setStmt.run(key, value);
    },
    getAll: (): Record<string, string> => {
      const rows = allStmt.all();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  };
}

// ─── Prompt Template Queries ─────────────────────────────────────────────────

interface PromptTemplateRow {
  id: string;
  title: string;
  description: string | null;
  content: string;
  category: string | null;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

function mapTemplate(row: PromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    category: row.category,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPromptTemplateQueries(db: Database) {
  const stmts = {
    list: db.prepare<PromptTemplateRow, []>(
      "SELECT * FROM prompt_templates ORDER BY is_builtin DESC, created_at ASC"
    ),
    getById: db.prepare<PromptTemplateRow, [string]>("SELECT * FROM prompt_templates WHERE id = ?"),
    insert: db.prepare<PromptTemplateRow, [string, string | null, string, string | null]>(
      "INSERT INTO prompt_templates (title, description, content, category) VALUES (?, ?, ?, ?) RETURNING *"
    ),
    remove: db.prepare<null, [string]>(
      "DELETE FROM prompt_templates WHERE id = ? AND is_builtin = 0"
    ),
  };

  return {
    list: (): PromptTemplate[] => stmts.list.all().map(mapTemplate),
    getById: (id: string): PromptTemplate | null => {
      const row = stmts.getById.get(id);
      return row ? mapTemplate(row) : null;
    },
    create: (req: CreatePromptTemplateRequest): PromptTemplate => {
      const row = stmts.insert.get(
        req.title,
        req.description ?? null,
        req.content,
        req.category ?? null
      )!;
      return mapTemplate(row);
    },
    update: (id: string, req: Partial<CreatePromptTemplateRequest>): PromptTemplate | null => {
      const sets: string[] = [];
      const values: (string | null)[] = [];
      if (req.title !== undefined) {
        sets.push("title = ?");
        values.push(req.title);
      }
      if (req.description !== undefined) {
        sets.push("description = ?");
        values.push(req.description ?? null);
      }
      if (req.content !== undefined) {
        sets.push("content = ?");
        values.push(req.content);
      }
      if (req.category !== undefined) {
        sets.push("category = ?");
        values.push(req.category ?? null);
      }
      if (sets.length === 0)
        return stmts.getById.get(id) ? mapTemplate(stmts.getById.get(id)!) : null;
      sets.push("updated_at = datetime('now')");
      values.push(id);
      const sql = `UPDATE prompt_templates SET ${sets.join(", ")} WHERE id = ? AND is_builtin = 0 RETURNING *`;
      const row = db.prepare(sql).get(...values) as PromptTemplateRow | null;
      return row ? mapTemplate(row) : null;
    },
    remove: (id: string): boolean => {
      const info = stmts.remove.run(id);
      return (info as any).changes > 0;
    },
  };
}

// ─── Task Schedule Queries ───────────────────────────────────────────────────

interface ScheduleRow {
  id: string;
  task_id: string;
  cron_expression: string;
  enabled: number;
  deadline_at: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapSchedule(row: ScheduleRow): TaskSchedule {
  return {
    id: row.id,
    taskId: row.task_id,
    cronExpression: row.cron_expression,
    enabled: row.enabled === 1,
    deadlineAt: row.deadline_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createScheduleQueries(db: Database) {
  return {
    getByTaskId: (taskId: string): TaskSchedule | null => {
      const row = db
        .prepare<ScheduleRow, [string]>("SELECT * FROM task_schedules WHERE task_id = ?")
        .get(taskId);
      return row ? mapSchedule(row) : null;
    },
    upsert: (
      taskId: string,
      cronExpression: string,
      deadlineAt: string | null,
      nextRunAt: string | null
    ): TaskSchedule => {
      const row = db
        .prepare<ScheduleRow, [string, string, string | null, string | null]>(
          `INSERT INTO task_schedules (task_id, cron_expression, deadline_at, next_run_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(task_id) DO UPDATE SET
             cron_expression = excluded.cron_expression,
             deadline_at = excluded.deadline_at,
             next_run_at = excluded.next_run_at,
             enabled = 1,
             updated_at = datetime('now')
           RETURNING *`
        )
        .get(taskId, cronExpression, deadlineAt, nextRunAt)!;
      return mapSchedule(row);
    },
    setEnabled: (taskId: string, enabled: boolean): TaskSchedule | null => {
      const row = db
        .prepare<ScheduleRow, [number, string]>(
          "UPDATE task_schedules SET enabled = ?, updated_at = datetime('now') WHERE task_id = ? RETURNING *"
        )
        .get(enabled ? 1 : 0, taskId);
      return row ? mapSchedule(row) : null;
    },
    remove: (taskId: string): void => {
      db.prepare("DELETE FROM task_schedules WHERE task_id = ?").run(taskId);
    },
    updateAfterRun: (taskId: string, nextRunAt: string | null): void => {
      db.prepare(
        "UPDATE task_schedules SET last_run_at = datetime('now'), next_run_at = ?, updated_at = datetime('now') WHERE task_id = ?"
      ).run(nextRunAt, taskId);
    },
    listDue: (): TaskSchedule[] => {
      const rows = db
        .prepare<ScheduleRow, []>(
          "SELECT * FROM task_schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= datetime('now') AND (deadline_at IS NULL OR deadline_at > datetime('now'))"
        )
        .all();
      return rows.map(mapSchedule);
    },
    disableExpired: (): void => {
      db.prepare(
        "UPDATE task_schedules SET enabled = 0, updated_at = datetime('now') WHERE deadline_at IS NOT NULL AND deadline_at <= datetime('now') AND enabled = 1"
      ).run();
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractRepoName(url: string): string {
  // Handle GitHub URLs like https://github.com/user/repo or git@github.com:user/repo.git
  const match = url.match(/([^/\\:]+?)(?:\.git)?$/);
  return match?.[1] ?? url;
}
