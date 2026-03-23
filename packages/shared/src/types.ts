// ─── Enums ───────────────────────────────────────────────────────────────────

export type TaskStatus = "backlog" | "in_progress" | "review" | "done" | "failed";
export type RepoStatus = "pending" | "cloning" | "ready" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type LogStream = "stdout" | "stderr" | "system" | "stdin";

export const TASK_COLUMNS: TaskStatus[] = ["backlog", "in_progress", "review", "done"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
  failed: "Failed",
};

// ─── Entities ────────────────────────────────────────────────────────────────

export interface Repository {
  id: string;
  name: string;
  url: string;
  defaultBranch: string;
  localPath: string | null;
  status: RepoStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  repoId: string;
  status: TaskStatus;
  engine: string | null;
  priority: number;
  columnOrder: number;
  branchName: string | null;
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  taskId: string;
  engine: string;
  status: RunStatus;
  worktreePath: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AgentLog {
  id: number;
  runId: string;
  stream: LogStream;
  content: string;
  timestamp: string;
}

// ─── API Request Types ───────────────────────────────────────────────────────

export interface CreateRepoRequest {
  url: string;
  defaultBranch?: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  repoId: string;
  engine?: string;
  priority?: number;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  columnOrder?: number;
  engine?: string;
}

export interface LaunchTaskRequest {
  engine?: string;
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface EngineInfo {
  name: string;
  displayName: string;
  available: boolean;
}

export interface GitHubRepo {
  name: string;
  url: string;
  description: string;
  isPrivate: boolean;
}

export interface TaskWithRun extends Task {
  latestRun?: AgentRun;
  repo?: Repository;
}

// ─── Diff Types ─────────────────────────────────────────────────────────────

export interface DiffFileSummary {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  oldPath?: string;
}

export interface DiffSummary {
  files: DiffFileSummary[];
  totalAdditions: number;
  totalDeletions: number;
}

// ─── WebSocket Protocol ──────────────────────────────────────────────────────

export type WsClientMessage =
  | { type: "subscribe"; taskId: string }
  | { type: "unsubscribe"; taskId: string }
  | { type: "agent_input"; taskId: string; input: string };

export type WsServerMessage =
  | { type: "task_updated"; task: Task }
  | { type: "repo_updated"; repo: Repository }
  | { type: "agent_log"; runId: string; taskId: string; stream: LogStream; content: string; timestamp: string }
  | { type: "run_status"; runId: string; taskId: string; status: RunStatus }
  | { type: "error"; message: string };
