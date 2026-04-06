// ─── Enums ───────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "scheduled"
  | "backlog"
  | "in_progress"
  | "review"
  | "done"
  | "failed"
  | "archived";
export type RepoStatus = "pending" | "cloning" | "ready" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type LogStream = "stdout" | "stderr" | "system" | "stdin" | "review";

export const TASK_COLUMNS: TaskStatus[] = ["scheduled", "backlog", "in_progress", "review", "done"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  scheduled: "Agendadas",
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
  failed: "Failed",
  archived: "Archived",
};

// ─── Entities ────────────────────────────────────────────────────────────────

export interface Repository {
  id: string;
  name: string;
  url: string;
  defaultBranch: string;
  localPath: string | null;
  status: RepoStatus;
  provider: GitProvider;
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
  model: string | null;
  priority: number;
  columnOrder: number;
  baseBranch: string | null;
  branchName: string | null;
  prUrl: string | null;
  parentTaskId: string | null;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  taskId: string;
  engine: string;
  status: RunStatus;
  currentStatus: string | null;
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

// ─── Prompt Template ────────────────────────────────────────────────────────

export interface PromptTemplate {
  id: string;
  title: string;
  description: string | null;
  content: string;
  category: string | null;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptTemplateRequest {
  title: string;
  description?: string;
  content: string;
  category?: string;
}

// ─── Task Schedule ────────────────────────────────────────────────────────────

export interface TaskSchedule {
  id: string;
  taskId: string;
  cronExpression: string;
  enabled: boolean;
  deadlineAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertScheduleRequest {
  cronExpression: string;
  enabled?: boolean;
  deadlineAt?: string | null;
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
  model?: string;
  baseBranch?: string;
  priority?: number;
  tags?: string[];
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  columnOrder?: number;
  engine?: string;
  model?: string;
  tags?: string[];
  notes?: string;
}

export interface LaunchTaskRequest {
  engine?: string;
  model?: string;
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
  version: string | null;
  activeRuns: number;
}

export type GitProvider = "github" | "gitlab" | "manual";

export interface RemoteRepo {
  name: string;
  url: string;
  description: string;
  isPrivate: boolean;
  provider: GitProvider;
}

/** @deprecated Use RemoteRepo instead */
export type GitHubRepo = RemoteRepo;

export interface TaskWithRun extends Task {
  latestRun?: AgentRun;
  repo?: Repository;
}

export interface TaskPollResponse {
  tasks: TaskWithRun[];
  focusedTask: TaskWithRun | null;
  focusedLogs: AgentLog[];
  serverTime: string;
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
  | { type: "run_updated"; run: AgentRun }
  | {
      type: "agent_log";
      runId: string;
      taskId: string;
      stream: LogStream;
      content: string;
      timestamp: string;
    }
  | {
      type: "agent_logs_batch";
      taskId: string;
      logs: Array<{ runId: string; stream: LogStream; content: string; timestamp: string }>;
    }
  | { type: "run_status"; runId: string; taskId: string; status: RunStatus }
  | { type: "error"; message: string };

// ─── Settings Types ──────────────────────────────────────────────────────────

export interface ProviderSettings {
  token: string;
  tokenSet: boolean;
  baseUrl?: string;
  username?: string;
}

export interface SettingsResponse {
  github: ProviderSettings;
  gitlab: ProviderSettings;
  theme: string;
}

export interface UpdateSettingsRequest {
  githubToken?: string;
  gitlabToken?: string;
  gitlabBaseUrl?: string;
  theme?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  username?: string;
  error?: string;
}

// ─── Statistics Types ────────────────────────────────────────────────────────

export interface StatsOverview {
  totalRepos: number;
  totalTasks: number;
  totalRuns: number;
  successRate: number;
  avgRunDurationSecs: number;
  totalPRsCreated: number;
  totalPRsMerged: number;
}

export interface StatusBreakdown {
  status: string;
  count: number;
}

export interface RepoStats {
  repoId: string;
  repoName: string;
  total: number;
  done: number;
  failed: number;
}

export interface EngineStats {
  engine: string;
  runs: number;
  completed: number;
  failed: number;
  avgDurationSecs: number;
}

export interface ModelStats {
  model: string;
  runs: number;
}

export interface DailyActivity {
  date: string;
  runs: number;
  completed: number;
  failed: number;
}

export interface StatsResponse {
  overview: StatsOverview;
  tasksByStatus: StatusBreakdown[];
  tasksByRepo: RepoStats[];
  runsByEngine: EngineStats[];
  runsByModel: ModelStats[];
  dailyActivity: DailyActivity[];
  favoriteEngine: string | null;
  favoriteModel: string | null;
}
