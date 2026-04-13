import type { Database } from "bun:sqlite";
import type {
  AgentLog,
  AgentRun,
  CreatePromptTemplateRequest,
  CreateRepoRequest,
  CreateTaskRequest,
  EngineEffectiveness,
  GitProvider,
  PromptTemplate,
  Repository,
  ReviewFinding,
  RunMetrics,
  SkillEffectiveness,
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
  provider: string;
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
  tags: string | null;
  notes: string | null;
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
  litellm_token_id: string | null;
  matched_skills: string | null;
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
    provider: (row.provider || "github") as GitProvider,
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
    tags: JSON.parse(row.tags || "[]") as string[],
    notes: row.notes ?? "",
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
    litellmTokenId: row.litellm_token_id,
    matchedSkills: row.matched_skills,
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
    insert: db.prepare<RepoRow, [string, string, string, string]>(
      "INSERT INTO repositories (name, url, default_branch, provider) VALUES (?, ?, ?, ?) RETURNING *"
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
    listByIds: (ids: string[]): Repository[] => {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(", ");
      const rows = db
        .prepare(`SELECT * FROM repositories WHERE id IN (${placeholders})`)
        .all(...ids) as RepoRow[];
      return rows.map(mapRepo);
    },
    create: (req: CreateRepoRequest & { provider?: GitProvider }): Repository => {
      const name = extractRepoName(req.url);
      const provider = req.provider ?? detectProviderFromUrl(req.url);
      const row = stmts.insert.get(name, req.url, req.defaultBranch ?? "main", provider);
      if (!row) throw new Error("Failed to create repository");
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
      const tagsJson = JSON.stringify(req.tags ?? []);
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
            string,
          ]
        >(
          "INSERT INTO tasks (title, description, repo_id, engine, model, base_branch, priority, column_order, status, parent_task_id, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
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
          req.parentTaskId ?? null,
          tagsJson
        );
      if (!row) throw new Error("Failed to create task");
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
      if (req.tags !== undefined) {
        sets.push("tags = ?");
        values.push(JSON.stringify(req.tags));
      }
      if (req.notes !== undefined) {
        sets.push("notes = ?");
        values.push(req.notes);
      }
      if (sets.length === 0) {
        const currentRow = stmts.getById.get(id);
        return currentRow ? mapTask(currentRow) : null;
      }
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
    listLatestByTaskIds: (taskIds: string[]): AgentRun[] => {
      if (taskIds.length === 0) return [];
      const placeholders = taskIds.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT * FROM agent_runs WHERE id IN (
            SELECT id FROM (
              SELECT id, task_id, row_number() OVER (
                PARTITION BY task_id ORDER BY created_at DESC, rowid DESC
              ) AS rank
              FROM agent_runs
              WHERE task_id IN (${placeholders})
            ) ranked WHERE rank = 1
          )`
        )
        .all(...taskIds) as RunRow[];
      return rows.map(mapRun);
    },
    getLatestByTask: (taskId: string): AgentRun | null => {
      const row = stmts.getLatestByTask.get(taskId);
      return row ? mapRun(row) : null;
    },
    create: (taskId: string, engine: string): AgentRun => {
      const row = stmts.insert.get(taskId, engine);
      if (!row) throw new Error("Failed to create run");
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
    updateLitellmTokenId: (id: string, tokenId: string | null): void => {
      db.prepare("UPDATE agent_runs SET litellm_token_id = ? WHERE id = ?").run(tokenId, id);
    },
    updateMatchedSkills: (id: string, skills: string[]): void => {
      db.prepare("UPDATE agent_runs SET matched_skills = ? WHERE id = ?").run(
        JSON.stringify(skills),
        id
      );
    },
  };
}

// ─── Agent Log Queries ───────────────────────────────────────────────────────

export function createLogQueries(db: Database) {
  const stmts = {
    listByRun: db.prepare<LogRow, [string]>(
      "SELECT * FROM agent_logs WHERE run_id = ? ORDER BY id ASC"
    ),
    listByRunAfter: db.prepare<LogRow, [string, number, number]>(
      "SELECT * FROM agent_logs WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?"
    ),
    insert: db.prepare<LogRow, [string, string, string]>(
      "INSERT INTO agent_logs (run_id, stream, content) VALUES (?, ?, ?) RETURNING *"
    ),
  };

  return {
    listByRun: (runId: string): AgentLog[] => stmts.listByRun.all(runId).map(mapLog),
    listByRunAfter: (runId: string, afterId: number, limit = 300): AgentLog[] =>
      stmts.listByRunAfter.all(runId, afterId, limit).map(mapLog),
    create: (runId: string, stream: string, content: string): AgentLog => {
      const row = stmts.insert.get(runId, stream, content);
      if (!row) throw new Error("Failed to create log");
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
      );
      if (!row) throw new Error("Failed to create prompt template");
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
      if (sets.length === 0) {
        const currentRow = stmts.getById.get(id);
        return currentRow ? mapTemplate(currentRow) : null;
      }
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
        .get(taskId, cronExpression, deadlineAt, nextRunAt);
      if (!row) throw new Error("Failed to upsert schedule");
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

function detectProviderFromUrl(url: string): GitProvider {
  if (url.includes("github.com")) return "github";
  if (url.includes("gitlab")) return "gitlab";
  return "manual";
}

// ─── Review Findings Queries (M4) ───────────────────────────────────────────

interface FindingRow {
  id: string;
  run_id: string;
  task_id: string;
  repo_id: string;
  persona: string;
  severity: string;
  content: string;
  file_path: string | null;
  resolved: number;
  created_at: string;
}

function mapFinding(row: FindingRow): ReviewFinding {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    repoId: row.repo_id,
    persona: row.persona,
    severity: row.severity as ReviewFinding["severity"],
    content: row.content,
    filePath: row.file_path,
    resolved: row.resolved === 1,
    createdAt: row.created_at,
  };
}

export function createFindingsQueries(db: Database) {
  return {
    create: (params: {
      runId: string;
      taskId: string;
      repoId: string;
      persona: string;
      severity: string;
      content: string;
      filePath?: string;
    }): ReviewFinding => {
      const row = db
        .prepare<FindingRow, [string, string, string, string, string, string, string | null]>(
          "INSERT INTO review_findings (run_id, task_id, repo_id, persona, severity, content, file_path) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *"
        )
        .get(
          params.runId,
          params.taskId,
          params.repoId,
          params.persona,
          params.severity,
          params.content,
          params.filePath ?? null
        );
      if (!row) throw new Error("Failed to create finding");
      return mapFinding(row);
    },
    getRecentByRepo: (repoId: string, limit = 20): ReviewFinding[] => {
      const rows = db
        .prepare<FindingRow, [string, number]>(
          `SELECT * FROM review_findings
           WHERE repo_id = ? AND resolved = 0
             AND created_at >= datetime('now', '-30 days')
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(repoId, limit);
      return rows.map(mapFinding);
    },
    listByRepo: (repoId: string, limit = 50): ReviewFinding[] => {
      const rows = db
        .prepare<FindingRow, [string, number]>(
          "SELECT * FROM review_findings WHERE repo_id = ? ORDER BY created_at DESC LIMIT ?"
        )
        .all(repoId, limit);
      return rows.map(mapFinding);
    },
    resolve: (id: string): void => {
      db.prepare("UPDATE review_findings SET resolved = 1 WHERE id = ?").run(id);
    },
  };
}

// ─── Run Metrics Queries (M5) ───────────────────────────────────────────────

interface MetricsRow {
  id: string;
  run_id: string;
  task_id: string;
  repo_id: string;
  engine: string;
  model: string | null;
  matched_skills: string | null;
  matched_rules: string | null;
  duration_ms: number | null;
  validator_attempts: number;
  review_blockers: number;
  review_warnings: number;
  final_status: string;
  pr_created: number;
  created_at: string;
}

function mapMetrics(row: MetricsRow): RunMetrics {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    repoId: row.repo_id,
    engine: row.engine,
    model: row.model,
    matchedSkills: JSON.parse(row.matched_skills || "[]"),
    matchedRules: JSON.parse(row.matched_rules || "[]"),
    durationMs: row.duration_ms,
    validatorAttempts: row.validator_attempts,
    reviewBlockers: row.review_blockers,
    reviewWarnings: row.review_warnings,
    finalStatus: row.final_status,
    prCreated: row.pr_created === 1,
    createdAt: row.created_at,
  };
}

export function createMetricsQueries(db: Database) {
  return {
    create: (params: {
      runId: string;
      taskId: string;
      repoId: string;
      engine: string;
      model?: string;
      matchedSkills: string[];
      matchedRules: string[];
      durationMs?: number;
      validatorAttempts: number;
      reviewBlockers: number;
      reviewWarnings: number;
      finalStatus: string;
      prCreated: boolean;
    }): RunMetrics => {
      const row = db
        .prepare<
          MetricsRow,
          [
            string,
            string,
            string,
            string,
            string | null,
            string,
            string,
            number | null,
            number,
            number,
            number,
            string,
            number,
          ]
        >(
          `INSERT INTO run_metrics (run_id, task_id, repo_id, engine, model, matched_skills, matched_rules, duration_ms, validator_attempts, review_blockers, review_warnings, final_status, pr_created)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
        )
        .get(
          params.runId,
          params.taskId,
          params.repoId,
          params.engine,
          params.model ?? null,
          JSON.stringify(params.matchedSkills),
          JSON.stringify(params.matchedRules),
          params.durationMs ?? null,
          params.validatorAttempts,
          params.reviewBlockers,
          params.reviewWarnings,
          params.finalStatus,
          params.prCreated ? 1 : 0
        );
      if (!row) throw new Error("Failed to create metrics");
      return mapMetrics(row);
    },
    skillEffectiveness: (): SkillEffectiveness[] => {
      // Unnest matched_skills JSON arrays and aggregate per skill
      const rows = db
        .query(
          `WITH skill_runs AS (
            SELECT
              je.value AS skill_name,
              m.final_status,
              m.review_blockers,
              m.review_warnings
            FROM run_metrics m, json_each(m.matched_skills) je
          )
          SELECT
            skill_name AS name,
            COUNT(*) AS total_runs,
            ROUND(100.0 * SUM(CASE WHEN final_status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_rate,
            ROUND(AVG(review_blockers), 2) AS avg_blockers,
            ROUND(AVG(review_warnings), 2) AS avg_warnings
          FROM skill_runs
          GROUP BY skill_name
          ORDER BY total_runs DESC
          LIMIT 50`
        )
        .all() as {
        name: string;
        total_runs: number;
        success_rate: number;
        avg_blockers: number;
        avg_warnings: number;
      }[];
      return rows.map((r) => ({
        name: r.name,
        totalRuns: r.total_runs,
        successRate: r.success_rate,
        avgBlockers: r.avg_blockers,
        avgWarnings: r.avg_warnings,
      }));
    },
    engineEffectiveness: (): EngineEffectiveness[] => {
      const rows = db
        .query(
          `SELECT
            engine,
            COUNT(*) AS total_runs,
            ROUND(100.0 * SUM(CASE WHEN final_status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_rate,
            ROUND(AVG(COALESCE(duration_ms, 0)) / 1000.0, 1) AS avg_duration_secs,
            ROUND(AVG(review_blockers), 2) AS avg_blockers,
            ROUND(100.0 * SUM(CASE WHEN pr_created = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pr_rate
          FROM run_metrics
          GROUP BY engine
          ORDER BY total_runs DESC`
        )
        .all() as {
        engine: string;
        total_runs: number;
        success_rate: number;
        avg_duration_secs: number;
        avg_blockers: number;
        pr_rate: number;
      }[];
      return rows.map((r) => ({
        engine: r.engine,
        totalRuns: r.total_runs,
        successRate: r.success_rate,
        avgDurationSecs: r.avg_duration_secs,
        avgBlockers: r.avg_blockers,
        prRate: r.pr_rate,
      }));
    },
  };
}
