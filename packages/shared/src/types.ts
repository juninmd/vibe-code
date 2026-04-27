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
  agentId: string | null;
  workflowId: string | null;
  matchedSkills: string[];
  tags: string[];
  notes: string;
  /** Planner-expanded spec written to SPEC.md in the worktree before the main agent runs. */
  plannerSpec?: string | null;
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
  litellmTokenId?: string | null;
  matchedSkills?: string | null;
  /** Serialised JSON: `{ phase: string; ts: string }` — updated at each lifecycle transition. */
  stateSnapshot?: string | null;
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

export interface TaskScheduleWithTask {
  schedule: TaskSchedule;
  task: TaskWithRun;
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
  agentId?: string;
  workflowId?: string;
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
  setupIssue?: string | null;
}

export interface RuntimeCapacity {
  activeAgents: number;
  maxAgents: number;
  availableEngines: number;
  totalEngines: number;
}

export interface RuntimeWorkload {
  totalTasks: number;
  runningTasks: number;
  failedTasks: number;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  lastRunAt: string | null;
}

export interface RuntimeOverview {
  id: string;
  name: string;
  kind: "local";
  status: "healthy" | "degraded" | "saturated";
  lastSeenAt: string;
  platform: string;
  cpuCount: number;
  uptimeSecs: number;
  dataDir: string;
  capacity: RuntimeCapacity;
  engines: EngineInfo[];
  workload: RuntimeWorkload;
}

export interface InboxItem {
  id: string;
  type: "task_failed" | "task_review" | "task_running" | "engine_unavailable" | "runtime_saturated";
  severity: "info" | "warning" | "critical" | "success";
  title: string;
  description: string;
  taskId: string | null;
  repoId: string | null;
  repoName: string | null;
  createdAt: string;
  actionLabel: string;
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
  | { type: "agent_input"; taskId: string; input: string }
  | { type: "ping" };

export type WsServerMessage =
  | { type: "task_created"; task: Task }
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
  | { type: "skill_created"; skillId: string }
  | { type: "skill_updated"; skillId: string }
  | { type: "skill_deleted"; skillId: string }
  | { type: "autopilot_created"; autopilotId: string }
  | { type: "autopilot_updated"; autopilotId: string }
  | { type: "autopilot_deleted"; autopilotId: string }
  | { type: "error"; message: string };

// ─── Task Specification ("Spec-Driven") ──────────────────────────────────────

export interface TaskSpec {
  objective: string;
  acceptance: string[];
  constraints: string[];
  context: string;
  outOfScope: string[];
}

// ─── Settings Types ──────────────────────────────────────────────────────────

export interface ProviderSettings {
  token: string;
  tokenSet: boolean;
  baseUrl?: string;
  username?: string;
}

export interface LiteLLMSettings {
  baseUrl: string;
  enabled: boolean;
}

export interface ApiKeyEntry {
  tokenSet: boolean;
  token: string;
}

export interface SettingsResponse {
  github: ProviderSettings;
  gitlab: ProviderSettings;
  litellm: LiteLLMSettings;
  apiKeys: {
    gemini: ApiKeyEntry;
    anthropic: ApiKeyEntry;
    openai: ApiKeyEntry;
  };
  skillsPath: string;
  theme: string;
}

export interface UpdateSettingsRequest {
  githubToken?: string;
  gitlabToken?: string;
  gitlabBaseUrl?: string;
  litellmBaseUrl?: string;
  litellmEnabled?: boolean;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
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
  failedRuns: number;
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

// ─── Skills / Rules / Agents / Workflows Types ──────────────────────────────

export type SkillCategory = "skill" | "rule" | "agent" | "workflow";

export interface SkillEntry {
  name: string;
  description: string;
  category: "skill";
  filePath: string;
  scope?: "global" | "workspace";
}

export interface RuleEntry {
  name: string;
  description: string;
  applyTo: string;
  category: "rule";
  filePath: string;
  scope?: "global" | "workspace";
}

export interface AgentEntry {
  name: string;
  description: string;
  category: "agent";
  filePath: string;
  scope?: "global" | "workspace";
}

export interface WorkflowEntry {
  name: string;
  description: string;
  category: "workflow";
  filePath: string;
  scope?: "global" | "workspace";
}

export type SkillsEntry = SkillEntry | RuleEntry | AgentEntry | WorkflowEntry;

export interface SkillsIndex {
  skills: SkillEntry[];
  rules: RuleEntry[];
  agents: AgentEntry[];
  workflows: WorkflowEntry[];
}

// ─── Skill Payload (structured context for engines) ─────────────────────────

export interface SkillPayloadItem {
  name: string;
  description: string;
  content: string;
}

export interface SkillPayload {
  rules: SkillPayloadItem[];
  skills: SkillPayloadItem[];
  workflow: SkillPayloadItem | null;
  agents: SkillPayloadItem[];
  projectInstructions: string | null;
}

// ─── Review Finding (persisted feedback) ────────────────────────────────────

export interface ReviewFinding {
  id: string;
  runId: string;
  taskId: string;
  repoId: string;
  persona: string;
  severity: "blocker" | "warning" | "info";
  content: string;
  filePath: string | null;
  resolved: boolean;
  createdAt: string;
}

// ─── Run Metrics (evaluation harness) ───────────────────────────────────────

export interface RunMetrics {
  id: string;
  runId: string;
  taskId: string;
  repoId: string;
  engine: string;
  model: string | null;
  matchedSkills: string[];
  matchedRules: string[];
  durationMs: number | null;
  validatorAttempts: number;
  reviewBlockers: number;
  reviewWarnings: number;
  finalStatus: string;
  prCreated: boolean;
  createdAt: string;
}

// ─── Skill Stats (evaluation responses) ─────────────────────────────────────

export interface SkillEffectiveness {
  name: string;
  totalRuns: number;
  successRate: number;
  avgBlockers: number;
  avgWarnings: number;
}

export interface EngineEffectiveness {
  engine: string;
  totalRuns: number;
  successRate: number;
  avgDurationSecs: number;
  avgBlockers: number;
  prRate: number;
}

// ─── Vibe-Code v2: Workspaces (Multi-tenant) ─────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceMemberRole = "owner" | "member" | "viewer";

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceMemberRole;
  joinedAt: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  createdAt: string;
}

// ─── Vibe-Code v2: Skills (Reusable Templates) ────────────────────────────────

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface SkillDefinition {
  agents: Array<{
    engine: string;
    model?: string;
    prompt: string;
  }>;
  sequence: "parallel" | "serial";
  timeout?: number;
}

export interface Skill {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  definition: SkillDefinition;
  inputs?: SkillParameter[];
  outputs?: SkillParameter[];
  version: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Vibe-Code v2: Autopilots (Workflows) ──────────────────────────────────────

export type AutopilotTriggerType = "schedule" | "event" | "manual";

export interface CronTrigger {
  expression: string;
  timezone?: string;
}

export interface EventTrigger {
  type: "pr_comment" | "issue_label" | "task_created" | "task_updated";
  matcher?: string; // regex or specific value
}

export interface AutopilotTriggerConfig {
  type: AutopilotTriggerType;
  cron?: CronTrigger;
  event?: EventTrigger;
}

export interface Autopilot {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  skillId: string;
  triggerType: AutopilotTriggerType;
  triggerConfig?: AutopilotTriggerConfig;
  enabled: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}
