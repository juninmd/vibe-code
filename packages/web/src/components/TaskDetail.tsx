import type {
  AgentLog,
  EngineInfo,
  TaskArtifact,
  TaskSchedule,
  TaskWithRun,
  UpdateTaskRequest,
  WsClientMessage,
} from "@vibe-code/shared";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api/client";
import { useElapsedTime } from "../hooks/useElapsedTime";
import { formatDateTime, formatDuration } from "../utils/date";
import { DiffViewer } from "./DiffViewer";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { TaskTagsEditor } from "./TaskTags";
import { TerminalSessionPanel } from "./TerminalSessionPanel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { getProviderFromUrl } from "./ui/git-icons";
import { Select } from "./ui/select";

interface TaskDetailProps {
  task: TaskWithRun;
  engines?: EngineInfo[];
  liveLogs: AgentLog[];
  onClose: () => void;
  onLaunch: (taskId: string, engine?: string, model?: string) => Promise<void>;
  onCancel: (taskId: string) => Promise<void>;
  onRetry: (taskId: string, engine?: string, model?: string) => Promise<void>;
  onRetryPR: (taskId: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onSendInput: (taskId: string, input: string) => void;
  terminalLogs?: Array<{
    id: number;
    runId: string | null;
    stream: "stdout" | "stderr";
    chunk: string;
    timestamp: string;
  }>;
  onWsSend?: (message: WsClientMessage) => void;
  onApprove?: (taskId: string) => Promise<void>;
  onReject?: (taskId: string) => Promise<void>;
  onClone?: (taskId: string) => Promise<void>;
  onUpdateTask?: (taskId: string, data: UpdateTaskRequest) => Promise<void>;
  onTaskRefresh?: () => void;
  onSkillClick?: (skillName: string) => void;
  onTaskSelect?: (task: TaskWithRun) => void;
  allTasks?: TaskWithRun[];
}

type ActiveTab =
  | "info"
  | "terminal"
  | "execution"
  | "diff"
  | "artifacts"
  | "skills"
  | "cost"
  | "memory"
  | "reviews";

function groupModelsByProvider(models: string[]): { provider: string; models: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const m of models) {
    const provider = m.includes("/") ? m.split("/")[0] : "other";
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider)?.push(m);
  }
  return Array.from(groups.entries()).map(([provider, models]) => ({ provider, models }));
}

const statusVariant: Record<
  string,
  "default" | "success" | "warning" | "danger" | "info" | "purple"
> = {
  scheduled: "warning",
  backlog: "default",
  in_progress: "info",
  review: "purple",
  done: "success",
  failed: "danger",
};

// Aura styles based on status for the modal background
const auraStyle: Record<string, string> = {
  scheduled: "radial-gradient(ellipse at top right, rgba(245, 158, 11, 0.08), transparent 50%)",
  backlog: "radial-gradient(ellipse at top right, rgba(100, 100, 100, 0.05), transparent 50%)",
  in_progress: "radial-gradient(ellipse at top right, rgba(59, 130, 246, 0.15), transparent 50%)",
  review: "radial-gradient(ellipse at top right, rgba(139, 92, 246, 0.15), transparent 50%)",
  done: "radial-gradient(ellipse at top right, rgba(16, 185, 129, 0.1), transparent 50%)",
  failed: "radial-gradient(ellipse at top right, rgba(239, 68, 68, 0.15), transparent 50%)",
  conflict: "radial-gradient(ellipse at top right, rgba(244, 63, 94, 0.18), transparent 50%)",
};

const statusLabel: Record<string, string> = {
  scheduled: "Agendada",
  backlog: "Backlog",
  in_progress: "Em execucao",
  review: "Em revisao",
  done: "Concluida",
  failed: "Falha",
};

const CRON_PRESETS = [
  { label: "A cada hora", value: "0 * * * *" },
  { label: "Diariamente (meia-noite)", value: "0 0 * * *" },
  { label: "Diariamente (9h)", value: "0 9 * * *" },
  { label: "Semanalmente (seg 9h)", value: "0 9 * * 1" },
  { label: "Customizado...", value: "custom" },
];

const cleanStatusLabel: Record<string, string> = {
  scheduled: "Agendada",
  backlog: "Backlog",
  in_progress: "Em execucao",
  review: "Em revisao",
  done: "Concluida",
  failed: "Falha",
  blocked: "Bloqueada",
};

const headerTabs = [
  { id: "info", label: "Info" },
  { id: "terminal", label: "Terminal" },
  { id: "execution", label: "Execution" },
  { id: "diff", label: "Diff" },
  { id: "artifacts", label: "Artifacts" },
  { id: "skills", label: "Skills" },
  { id: "cost", label: "Telemetry" },
  { id: "memory", label: "Memory" },
  { id: "reviews", label: "Reviews" },
] satisfies { id: ActiveTab; label: string }[];

function hasText(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function formatNullableDate(value: string | null | undefined) {
  return value ? formatDateTime(value) : "Not recorded";
}

function formatCurrencyMicros(value: number | undefined) {
  return value === undefined ? null : `$${(value / 1_000_000).toFixed(6)}`;
}

function DetailField({
  label,
  value,
  title,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/5 bg-white/[0.025] px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-dimmed">
        {label}
      </div>
      <div className="mt-1 min-w-0 truncate text-xs text-secondary" title={title}>
        {value}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "info" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    default: "border-white/10 bg-white/[0.035] text-primary",
    info: "border-info/25 bg-info/10 text-info",
    success: "border-success/25 bg-success/10 text-success",
    warning: "border-warning/25 bg-warning/10 text-warning",
    danger: "border-danger/25 bg-danger/10 text-danger",
  }[tone];

  return (
    <div className={`min-w-0 rounded-lg border px-3 py-3 ${toneClass}`}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] opacity-75">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function ReadinessItem({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: "ready" | "attention" | "pending";
}) {
  const stateClass = {
    ready: "border-success/20 bg-success/10 text-success",
    attention: "border-warning/25 bg-warning/10 text-warning",
    pending: "border-white/10 bg-white/[0.025] text-dimmed",
  }[state];
  const marker = { ready: "Ready", attention: "Attention", pending: "Pending" }[state];

  return (
    <div className="min-w-0 rounded-lg border border-white/5 bg-white/[0.025] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-primary">{label}</div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-dimmed">{detail}</div>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${stateClass}`}
        >
          {marker}
        </span>
      </div>
    </div>
  );
}

function ScheduleSection({ taskId, onTaskRefresh }: { taskId: string; onTaskRefresh: () => void }) {
  const [schedule, setSchedule] = useState<TaskSchedule | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [preset, setPreset] = useState(CRON_PRESETS[2].value);
  const [customExpr, setCustomExpr] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [runNowLoading, setRunNowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.schedules
      .get(taskId)
      .then(setSchedule)
      .catch(() => setSchedule(null));
  }, [taskId]);

  const resolvedExpression = preset === "custom" ? customExpr : preset;

  function openEdit() {
    if (schedule) {
      const matchedPreset = CRON_PRESETS.find(
        (p) => p.value === schedule.cronExpression && p.value !== "custom"
      );
      setPreset(matchedPreset ? matchedPreset.value : "custom");
      setCustomExpr(matchedPreset ? "" : schedule.cronExpression);
      setDeadline(schedule.deadlineAt ? schedule.deadlineAt.slice(0, 10) : "");
    }
    setEditing(true);
    setError(null);
  }

  async function handleSave() {
    if (!resolvedExpression) return;
    setSaving(true);
    setError(null);
    try {
      const s = await api.schedules.upsert(taskId, {
        cronExpression: resolvedExpression,
        enabled: true,
        deadlineAt: deadline ? new Date(deadline).toISOString() : null,
      });
      setSchedule(s);
      setEditing(false);
      onTaskRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!schedule) return;
    try {
      const s = await api.schedules.toggle(taskId, !schedule.enabled);
      setSchedule(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    try {
      await api.schedules.remove(taskId);
      setSchedule(null);
      onTaskRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRunNow() {
    setRunNowLoading(true);
    setError(null);
    try {
      await api.schedules.runNow(taskId);
      const s = await api.schedules.get(taskId);
      setSchedule(s);
      onTaskRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunNowLoading(false);
    }
  }

  if (schedule === undefined) return null;

  const isExpired = schedule?.deadlineAt ? new Date(schedule.deadlineAt) <= new Date() : false;
  const isNearDeadline =
    schedule?.deadlineAt && !isExpired
      ? new Date(schedule.deadlineAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
      : false;

  return (
    <div className="border border-default rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-secondary flex items-center gap-1.5">
          ⏰ Agendamento
        </h3>
        {!editing && (
          <Button variant="ghost" onClick={openEdit} className="text-xs h-6 px-2">
            {schedule ? "Editar" : "Adicionar"}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-xs text-danger bg-danger/15 border border-danger/30 rounded px-2 py-1">
          {error}
        </p>
      )}

      {schedule && !editing && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs text-warning bg-surface px-2 py-0.5 rounded font-mono">
              {schedule.cronExpression}
            </code>
            {isExpired ? (
              <Badge variant="danger" className="text-[10px] py-0 px-1.5">
                Expirado
              </Badge>
            ) : (
              <button
                type="button"
                onClick={handleToggle}
                title={schedule.enabled ? "Desabilitar" : "Habilitar"}
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                  schedule.enabled ? "bg-amber-600" : "bg-surface-hover"
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    schedule.enabled ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            )}
            <span className="text-xs text-primary0">
              {isExpired ? "" : schedule.enabled ? "Ativo" : "Pausado"}
            </span>
          </div>

          <div className="text-xs text-dimmed space-y-0.5">
            {schedule.lastRunAt && (
              <div>
                Último disparo:{" "}
                <span className="text-secondary">{formatDateTime(schedule.lastRunAt)}</span>
              </div>
            )}
            {schedule.nextRunAt && schedule.enabled && !isExpired && (
              <div>
                Próximo disparo:{" "}
                <span className="text-secondary">{formatDateTime(schedule.nextRunAt)}</span>
              </div>
            )}
            {schedule.deadlineAt && (
              <div className={isNearDeadline ? "text-warning" : ""}>
                Prazo:{" "}
                <span className={isNearDeadline ? "text-warning font-medium" : "text-secondary"}>
                  {formatDateTime(schedule.deadlineAt)}
                  {isNearDeadline && " ⚠️"}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              disabled={runNowLoading}
              onClick={handleRunNow}
              className="text-xs h-7 px-2.5"
            >
              {runNowLoading ? "Disparando..." : "▶ Executar agora"}
            </Button>
            <Button
              variant="ghost"
              onClick={handleDelete}
              className="text-xs h-7 px-2 text-danger hover:text-danger"
            >
              Remover
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          <div>
            <div className="text-xs text-primary0 mb-1 block">Frequência</div>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="w-full bg-surface border border-strong rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-amber-500"
            >
              {CRON_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {preset === "custom" && (
            <div>
              <div className="text-xs text-primary0 mb-1 block">Expressão cron</div>
              <input
                type="text"
                placeholder="ex: 0 9 * * 1-5"
                value={customExpr}
                onChange={(e) => setCustomExpr(e.target.value)}
                className="w-full bg-surface border border-strong rounded px-2 py-1.5 text-xs text-primary font-mono focus:outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-dimmed mt-1">minuto hora dia mês dia-semana</p>
            </div>
          )}

          <div>
            <div className="text-xs text-primary0 mb-1 block">Prazo (opcional)</div>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full bg-surface border border-strong rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={saving || !resolvedExpression}
              onClick={handleSave}
              className="text-xs h-7 px-3"
            >
              {saving ? "Salvando..." : "Salvar"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="text-xs h-7 px-2"
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TaskDetail({
  task,
  engines,
  liveLogs,
  onClose,
  onLaunch,
  onCancel,
  onRetry,
  onRetryPR,
  onDelete,
  onSendInput,
  terminalLogs = [],
  onWsSend,
  onApprove,
  onReject,
  onClone,
  onUpdateTask,
  onTaskRefresh,
  onSkillClick,
  onTaskSelect,
  allTasks = [],
}: TaskDetailProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prCopied, setPrCopied] = useState(false);
  const [notesValue, setNotesValue] = useState(task.notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  const [matchedSkills, setMatchedSkills] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([]);
  const [parentTask, setParentTask] = useState<TaskWithRun | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const sharedMemoryInputId = `task-${task.id}-shared-memory`;
  const taskMemoryInputId = `task-${task.id}-local-memory`;

  // Parse approval request from notes if it exists
  const approvalRequest = useMemo(() => {
    if (!task.pendingApproval) return null;
    try {
      const data = JSON.parse(task.notes);
      if (data.message) return data as { message: string; command?: string; requestedAt?: string };
    } catch {
      /* not a json approval request */
    }
    return null;
  }, [task.pendingApproval, task.notes]);

  const subTasks = useMemo(() => {
    return allTasks.filter((t) => t.parentTaskId === task.id);
  }, [allTasks, task.id]);

  useEffect(() => {
    if (task.parentTaskId) {
      const parent = allTasks.find((t) => t.id === task.parentTaskId);
      if (parent) {
        setParentTask(parent);
      } else {
        api.tasks
          .get(task.parentTaskId)
          .then(setParentTask)
          .catch(() => setParentTask(null));
      }
    } else {
      setParentTask(null);
    }
  }, [task.parentTaskId, allTasks]);

  // Engine & Model selection
  const [selectedEngine, setSelectedEngine] = useState(task.engine ?? "");
  const [selectedModel, setSelectedModel] = useState(task.model ?? "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    if (!selectedEngine) {
      setAvailableModels([]);
      setSelectedModel("");
      return;
    }
    setLoadingModels(true);
    // Don't clear selectedModel immediately to allow it to persist if it exists in the new engine
    api.engines
      .models(selectedEngine)
      .then((list) => {
        setAvailableModels(list);
        if (!list.includes(selectedModel)) {
          setSelectedModel("");
        }
      })
      .catch(() => {
        setAvailableModels([]);
        setSelectedModel("");
      })
      .finally(() => setLoadingModels(false));
  }, [selectedEngine, selectedModel]);

  const isRunning = task.status === "in_progress" || task.latestRun?.status === "running";
  const elapsed = useElapsedTime(task.latestRun?.startedAt, isRunning);
  const provider = task.repo ? getProviderFromUrl(task.repo.url) : null;
  const ProviderIcon = provider?.icon;
  const duration = formatDuration(
    task.latestRun?.startedAt ?? null,
    task.latestRun?.finishedAt ?? null
  );
  const runSnapshot = useMemo(() => {
    if (!task.latestRun?.stateSnapshot) return null;
    try {
      return JSON.parse(task.latestRun.stateSnapshot) as {
        phase?: string;
        branch?: string | null;
        worktreePath?: string | null;
        sessionId?: string | null;
        validationSummary?: string | null;
        validatorAttempts?: number;
      };
    } catch {
      return null;
    }
  }, [task.latestRun?.stateSnapshot]);
  const runBranch = task.branchName ?? runSnapshot?.branch ?? null;
  const worktreePath = task.latestRun?.worktreePath ?? runSnapshot?.worktreePath ?? null;
  const sessionId = task.latestRun?.sessionId ?? runSnapshot?.sessionId ?? null;
  const costStats = task.latestRun?.costStats;
  const tokenUsage = task.latestRun?.tokenUsage;

  // Calculate aggregated stats from tokenUsage if available
  let displayTotalTokens = costStats?.total_tokens ?? 0;
  let displayInputTokens = costStats?.input_tokens ?? 0;
  let displayOutputTokens = costStats?.output_tokens ?? 0;
  let displayCachedTokens = costStats?.cached ?? 0;

  let displayInputCostUSD = costStats?.input !== undefined ? costStats.input / 1_000_000 : 0;
  let displayOutputCostUSD = costStats?.output !== undefined ? costStats.output / 1_000_000 : 0;
  let displayTotalCostUSD =
    costStats?.total !== undefined
      ? costStats.total / 1_000_000
      : displayInputCostUSD + displayOutputCostUSD;

  let displayInputCostRaw = costStats?.input;
  let displayOutputCostRaw = costStats?.output;
  let displayTotalCostRaw =
    costStats?.total ?? (costStats ? (costStats.input || 0) + (costStats.output || 0) : undefined);

  if (tokenUsage && Object.keys(tokenUsage).length > 0) {
    let sumTotalTokens = 0;
    let sumInputTokens = 0;
    let sumOutputTokens = 0;
    let sumCachedTokens = 0;
    let sumInputCost = 0;
    let sumOutputCost = 0;
    let sumTotalCost = 0;
    for (const [, stats] of Object.entries(tokenUsage) as Array<
      [string, NonNullable<typeof tokenUsage>[string]]
    >) {
      sumTotalTokens += stats.total_tokens || 0;
      sumInputTokens += stats.input_tokens || 0;
      sumOutputTokens += stats.output_tokens || 0;
      sumCachedTokens += (stats as any).cached_tokens || (stats as any).cached || 0;
      sumInputCost += stats.input_cost || 0;
      sumOutputCost += stats.output_cost || 0;
      sumTotalCost += stats.total_cost || (stats.input_cost || 0) + (stats.output_cost || 0);
    }
    displayTotalTokens = sumTotalTokens;
    displayInputTokens = sumInputTokens;
    displayOutputTokens = sumOutputTokens;
    displayCachedTokens = sumCachedTokens;
    displayInputCostUSD = sumInputCost;
    displayOutputCostUSD = sumOutputCost;
    displayTotalCostUSD = sumTotalCost;

    displayInputCostRaw = sumInputCost * 1_000_000;
    displayOutputCostRaw = sumOutputCost * 1_000_000;
    displayTotalCostRaw = sumTotalCost * 1_000_000;
  }

  const inputCost = formatCurrencyMicros(displayInputCostRaw);
  const outputCost = formatCurrencyMicros(displayOutputCostRaw);
  const totalCost = formatCurrencyMicros(displayTotalCostRaw);
  const totalTokens = displayTotalTokens;
  const statusTone =
    task.status === "failed"
      ? "danger"
      : task.status === "done"
        ? "success"
        : task.status === "scheduled" || task.status === "blocked"
          ? "warning"
          : isRunning
            ? "info"
            : "default";
  const outputState = task.prUrl
    ? "PR created"
    : runBranch
      ? "Branch ready"
      : task.status === "review"
        ? "Waiting for PR"
        : "No output yet";
  const runState = task.latestRun?.status ?? "No run yet";
  const readinessItems = [
    {
      label: "Repository context",
      detail: task.repo
        ? `${task.repo.name} on ${task.baseBranch ?? task.repo.defaultBranch ?? "unknown base"}`
        : "Repository metadata is not loaded for this task.",
      state: task.repo ? "ready" : "attention",
    },
    {
      label: "Execution configuration",
      detail: `${task.latestRun?.engine ?? task.engine ?? "No engine selected"} / ${
        task.model ?? "engine default model"
      }`,
      state: task.latestRun || task.engine ? "ready" : "pending",
    },
    {
      label: "Delivery output",
      detail: task.prUrl
        ? `Pull request ${task.prUrl.split("/").pop() ?? "created"}`
        : runBranch
          ? `Branch ${runBranch} is available`
          : "No branch or pull request recorded yet.",
      state: task.prUrl || runBranch ? "ready" : task.status === "failed" ? "attention" : "pending",
    },
    {
      label: "Evidence package",
      detail:
        artifacts.length > 0
          ? `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} attached`
          : "No persisted artifacts are attached to this task.",
      state: artifacts.length > 0 ? "ready" : "pending",
    },
    {
      label: "Governance",
      detail: task.pendingApproval
        ? "Agent is waiting for explicit approval."
        : task.status === "failed"
          ? "Failed task needs operator review."
          : "No approval gate is currently pending.",
      state: task.pendingApproval || task.status === "failed" ? "attention" : "ready",
    },
  ] satisfies Array<{
    label: string;
    detail: string;
    state: "ready" | "attention" | "pending";
  }>;

  const [activeTab, setActiveTab] = useState<ActiveTab>(isRunning ? "execution" : "info");
  const [sharedMemory, setSharedMemory] = useState<string>("");
  const [taskMemory, setTaskMemory] = useState<string>("");
  const [memorySaving, setMemorySaving] = useState(false);
  const [reviewRounds, setReviewRounds] = useState<any[]>([]);
  const [reviewIssues, setReviewIssues] = useState<any[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  useEffect(() => {
    console.info("[ui] INFO: task detail tab switched", {
      taskId: task.id,
      nextTab: activeTab,
    });
  }, [activeTab, task.id]);

  useEffect(() => {
    if (activeTab !== "reviews") return;
    setReviewsLoading(true);
    api.reviews
      .listRounds(task.id)
      .then(({ rounds }) => {
        setReviewRounds(rounds || []);
        return api.reviews.listIssues(task.id);
      })
      .then(({ issues }) => setReviewIssues(issues || []))
      .catch(() => {})
      .finally(() => setReviewsLoading(false));
  }, [activeTab, task.id]);

  const skillCategoryLabel: Record<string, string> = {
    rule: "Rule",
    skill: "Skill",
    agent: "Agent",
    workflow: "Workflow",
  };

  const skillCategoryColor: Record<string, { bg: string; border: string; text: string }> = {
    rule: { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.35)", text: "#f59e0b" },
    skill: {
      bg: "rgba(139,92,246,0.15)",
      border: "rgba(139,92,246,0.35)",
      text: "var(--accent-text, #c4b5fd)",
    },
    agent: { bg: "rgba(59,130,246,0.15)", border: "rgba(59,130,246,0.35)", text: "#60a5fa" },
    workflow: { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.35)", text: "#34d399" },
  };

  const skillsByCategory = useMemo(
    () =>
      matchedSkills.reduce(
        (acc, raw) => {
          const idx = raw.indexOf(":");
          const category = idx > 0 ? raw.slice(0, idx) : "skill";
          const name = idx > 0 ? raw.slice(idx + 1) : raw;
          if (!acc[category]) acc[category] = [];
          acc[category].push({ raw, name });
          return acc;
        },
        {} as Record<string, { raw: string; name: string }[]>
      ),
    [matchedSkills]
  );

  const categoryOrder = ["rule", "skill", "agent", "workflow"];

  // Reset tab and notes when task changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when task.id changes
  useEffect(() => {
    setNotesValue(task.notes ?? "");
    setMatchedSkills([]);
    setArtifacts([]);
    setActiveTab(
      task.status === "in_progress" || task.latestRun?.status === "running" ? "execution" : "info"
    );
  }, [task.id]);

  // Fetch matched skills when task/run changes (with abort to prevent stale results)
  useEffect(() => {
    if (!task.latestRun) return;
    const abortCtrl = new AbortController();
    api.tasks
      .matchedSkills(task.id)
      .then((skills) => {
        if (!abortCtrl.signal.aborted) setMatchedSkills(skills);
      })
      .catch(() => {});
    return () => abortCtrl.abort();
  }, [task.id, task.latestRun?.id, task.latestRun]);

  useEffect(() => {
    api.tasks
      .artifacts(task.id)
      .then(setArtifacts)
      .catch(() => setArtifacts([]));
  }, [task.id]);

  const handleNotesBlur = () => {
    if (!onUpdateTask) return;
    if (notesValue === (task.notes ?? "")) return;
    onUpdateTask(task.id, { notes: notesValue }).then(() => {
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    });
  };

  const handleTagsChange = (tags: string[]) => {
    onUpdateTask?.(task.id, { tags });
  };

  const handleCopyPR = () => {
    if (task.prUrl) {
      navigator.clipboard.writeText(task.prUrl).then(() => {
        setPrCopied(true);
        setTimeout(() => setPrCopied(false), 2000);
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fechar detalhe da tarefa"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative flex h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl border shadow-2xl shadow-black/60"
        style={{
          background: "var(--bg-surface)",
          backgroundImage:
            (task.tags?.includes("conflict-resolution") ? auraStyle.conflict : null) ||
            auraStyle[task.status] ||
            auraStyle.backlog,
          borderColor: "var(--glass-border)",
        }}
      >
        {/* Inner glow border for premium feel */}
        <div className="absolute inset-0 rounded-2xl pointer-events-none border border-white/5" />

        {/* ── Modal Header ────────────────────────────────── */}
        <div className="relative z-10 shrink-0 border-b border-white/5 bg-black/10 px-4 pt-4 sm:px-6">
          {/* Title row */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {ProviderIcon && (
                <div className={`mt-1 shrink-0 ${provider?.color}`}>
                  <ProviderIcon size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {task.tags?.includes("conflict-resolution") && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 shrink-0">
                      <svg
                        aria-hidden="true"
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 3h4v4H3zM9 9h4v4H9zM7 5h2M7 11h2M11 7v2M5 7v2" />
                      </svg>
                      Merge Conflict
                    </span>
                  )}
                  <h2 className="min-w-0 text-lg font-bold leading-snug text-primary sm:text-xl">
                    {task.title}
                  </h2>
                  {task.status === "failed" && task.latestRun?.errorMessage && (
                    <span className="text-[10px] text-danger/60 italic ml-2 truncate max-w-xs">
                      Error: {task.latestRun.errorMessage}
                    </span>
                  )}
                </div>
                {task.repo && (
                  <a
                    href={task.repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block truncate text-[11px] text-primary0 transition-colors hover:text-secondary"
                  >
                    {task.repo.name}
                  </a>
                )}
              </div>
            </div>

            {/* Header actions */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
              {task.branchName && (
                <>
                  <button
                    type="button"
                    title="Abrir no Editor"
                    onClick={async () => {
                      try {
                        setLoadingAction("open-editor");
                        await api.tasks.openEditor(task.id);
                      } catch (err) {
                        alert(err instanceof Error ? err.message : String(err));
                      } finally {
                        setLoadingAction(null);
                      }
                    }}
                    className="inline-flex h-8 items-center rounded-md border border-white/10 px-2.5 text-[11px] font-medium text-primary0 transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                    disabled={loadingAction === "open-editor"}
                  >
                    {loadingAction === "open-editor" ? "Opening..." : "Open"}
                  </button>
                  <a
                    href={api.tasks.downloadUrl(task.id)}
                    download
                    title="Download code as ZIP"
                    className="inline-flex h-8 items-center rounded-md border border-white/10 px-2.5 text-[11px] font-medium text-primary0 transition-colors hover:bg-surface-hover hover:text-secondary"
                  >
                    ZIP
                  </a>
                </>
              )}
              {onClone && (
                <button
                  type="button"
                  onClick={async () => {
                    setLoadingAction("clone");
                    try {
                      await onClone(task.id);
                      onClose();
                    } finally {
                      setLoadingAction(null);
                    }
                  }}
                  disabled={!!loadingAction}
                  title="Clone task"
                  className="inline-flex h-8 items-center rounded-md border border-white/10 px-2.5 text-[11px] font-medium text-primary0 transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                >
                  Clone
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  setLoadingAction("preview-prompt");
                  try {
                    const result = await api.tasks.previewPrompt(task.id);
                    setPreviewPrompt(result.prompt);
                  } finally {
                    setLoadingAction(null);
                  }
                }}
                disabled={loadingAction === "preview-prompt"}
                title="Preview agent prompt"
                className="inline-flex h-8 items-center rounded-md border border-white/10 px-2.5 text-[11px] font-medium text-primary0 transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
              >
                {loadingAction === "preview-prompt" ? "Loading..." : "Prompt"}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar modal"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-primary0 transition-colors hover:bg-surface-hover hover:text-secondary"
              >
                X
              </button>
            </div>
          </div>

          {/* Status badges row */}
          <div className="flex flex-wrap gap-2 items-center mt-3">
            <Badge variant={statusVariant[task.status] ?? "default"}>
              {cleanStatusLabel[task.status] ?? statusLabel[task.status] ?? task.status}
            </Badge>

            {task.agentId && (
              <Badge
                variant="default"
                className="flex items-center gap-1 opacity-90 border-blue-500/30 bg-blue-500/10 text-blue-400"
              >
                <svg
                  aria-hidden="true"
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                  <path d="M2 14c0-2.2 2.7-4 6-4s6 1.8 6 4" />
                </svg>
                {task.agentId}
              </Badge>
            )}

            {task.engine && (
              <Badge variant="purple">
                {task.engine}
                {task.model && (
                  <span className="opacity-70 ml-1 font-normal">
                    ·{" "}
                    {task.model.includes("/")
                      ? task.model.split("/").slice(1).join("/")
                      : task.model}
                  </span>
                )}
              </Badge>
            )}
            {isRunning && (
              <span className="flex items-center gap-1.5 text-xs text-info bg-info/15 rounded-full px-2 py-0.5 border border-info/30">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                {task.latestRun?.currentStatus || "Rodando"}
              </span>
            )}
          </div>

          {activeTab === "info" && (
            <div className="mt-4 grid gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest">
                  <span className="text-dimmed">Task objective</span>
                  <span className="font-semibold text-primary0">
                    {cleanStatusLabel[task.status] ?? task.status}
                  </span>
                </div>
                <p className="truncate text-xs text-secondary">
                  {hasText(task.goal) ? task.goal : task.description || "No description recorded"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] uppercase tracking-widest text-dimmed sm:inline">
                  Jump to
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-primary0 transition-colors hover:bg-white/10 hover:text-primary"
                    onClick={() => setActiveTab("execution")}
                  >
                    Execution
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-primary0 transition-colors hover:bg-white/10 hover:text-primary"
                    onClick={() => setActiveTab("memory")}
                  >
                    Memory
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-primary0 transition-colors hover:bg-white/10 hover:text-primary"
                    onClick={() => setActiveTab("reviews")}
                  >
                    Reviews
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Tab bar */}
          <div className="relative z-20 mt-4 overflow-x-auto no-scrollbar">
            <div className="flex min-w-max gap-1 pb-2">
              {headerTabs.map(({ id, label }) => {
                if (id === "skills" && matchedSkills.length === 0) return null;
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`relative rounded-t-lg border border-b-0 px-3 py-2 text-[10px] font-semibold tracking-[0.08em] transition-colors ${
                      isActive
                        ? "border-white/10 bg-black/25 text-primary"
                        : "border-transparent text-muted hover:bg-white/5 hover:text-secondary"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {label}
                      {id === "terminal" && isRunning && (
                        <span className="w-1.5 h-1.5 rounded-full bg-info shadow-[0_0_8px_var(--info)] animate-pulse" />
                      )}
                      {id === "cost" && totalTokens > 0 && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold ${isActive ? "bg-warning/20 text-warning" : "bg-white/5 text-muted"}`}
                        >
                          {totalTokens.toLocaleString()}
                        </span>
                      )}
                      {id === "diff" && task.branchName && !isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                      )}
                      {id === "artifacts" && artifacts.length > 0 && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold ${isActive ? "bg-white/10 text-primary" : "bg-white/5 text-muted"}`}
                        >
                          {artifacts.length}
                        </span>
                      )}
                      {id === "skills" && matchedSkills.length > 0 && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold ${isActive ? "bg-accent/20 text-accent-light" : "bg-white/5 text-muted"}`}
                        >
                          {matchedSkills.length}
                        </span>
                      )}
                      {id === "reviews" && reviewIssues.length > 0 && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold ${
                            isActive ? "bg-danger/20 text-danger" : "bg-white/5 text-muted"
                          }`}
                        >
                          {reviewIssues.length}
                        </span>
                      )}
                    </div>
                    {isActive && <div className="absolute inset-x-2 bottom-0 h-0.5 bg-accent" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Tab Content ─────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-black/20">
          {/* Approval Request / Governance Gate */}
          {task.pendingApproval && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-warning">
                <span className="text-lg">🛡️</span>
                <h3 className="text-sm font-semibold">Approval required</h3>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-secondary leading-relaxed">
                  {approvalRequest?.message || "The agent requested approval to continue."}
                </p>
                {approvalRequest?.command && (
                  <div className="bg-black/40 rounded p-2 border border-strong">
                    <code className="text-[11px] text-warning font-mono break-all">
                      $ {approvalRequest.command}
                    </code>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="primary"
                  className="bg-warning hover:bg-warning/80 text-black border-none h-8 text-xs px-4"
                  disabled={!!loadingAction}
                  onClick={async () => {
                    setLoadingAction("approve");
                    try {
                      await onApprove?.(task.id);
                    } finally {
                      setLoadingAction(null);
                    }
                  }}
                >
                  {loadingAction === "approve" ? "Approving..." : "Approve"}
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger hover:bg-danger/10 h-8 text-xs px-4 border border-danger/20"
                  disabled={!!loadingAction}
                  onClick={async () => {
                    setLoadingAction("reject");
                    try {
                      await onReject?.(task.id);
                    } finally {
                      setLoadingAction(null);
                    }
                  }}
                >
                  {loadingAction === "reject" ? "Rejecting..." : "Reject"}
                </Button>
              </div>
              {approvalRequest?.requestedAt && (
                <p className="text-[9px] text-dimmed italic">
                  Requested at {formatDateTime(approvalRequest.requestedAt)}
                </p>
              )}
            </div>
          )}

          {/* Goal Ancestry & Delegation (Spatial Memory) */}
          {(parentTask || subTasks.length > 0) && (
            <div className="relative pl-6 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-gradient-to-b before:from-transparent before:via-white/20 before:to-transparent">
              {parentTask && (
                <div className="relative">
                  <div className="absolute -left-6 top-2 w-3 h-px bg-white/20" />
                  <div className="absolute -left-[14px] top-1.5 w-1.5 h-1.5 rounded-full bg-primary0 shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                  <h3 className="text-[9px] font-black text-primary0 uppercase tracking-[0.2em] mb-1.5">
                    Ancestry Lineage
                  </h3>
                  <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 backdrop-blur-sm transition-all hover:bg-white/[0.04]">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-secondary truncate">
                        {parentTask.title}
                      </p>
                      <p className="text-[10px] text-dimmed line-clamp-1 mt-0.5">
                        {parentTask.description}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {subTasks.length > 0 && (
                <div className="relative">
                  <div className="absolute -left-6 top-2 w-3 h-px bg-white/20" />
                  <div className="absolute -left-[14px] top-1.5 w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />
                  <h3 className="text-[9px] font-black text-primary0 uppercase tracking-[0.2em] mb-2">
                    Delegated Branches
                  </h3>
                  <div className="grid gap-2">
                    {subTasks.map((st) => (
                      <div
                        key={st.id}
                        className="flex items-center justify-between gap-3 bg-white/[0.02] border border-white/5 rounded-xl p-2.5 backdrop-blur-sm transition-all hover:bg-white/[0.04]"
                      >
                        <div className="min-w-0 flex items-center gap-2.5">
                          <Badge
                            variant={statusVariant[st.status] ?? "default"}
                            className="text-[9px] px-1.5 py-0 h-auto"
                          >
                            {statusLabel[st.status] ?? st.status}
                          </Badge>
                          <span className="text-xs font-medium text-secondary truncate">
                            {st.title}
                          </span>
                        </div>
                        <span className="text-[9px] text-dimmed font-mono shrink-0 opacity-50">
                          {st.id.slice(0, 8)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Info Tab ──────────────────────────────────── */}
          {activeTab === "info" && (
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 gap-3 content-start lg:grid-cols-3">
              <section className="col-span-1 overflow-hidden rounded-xl border border-white/10 bg-black/20 lg:col-span-3">
                <div className="grid gap-3 border-b border-white/5 bg-white/[0.025] px-4 py-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-dimmed">
                      Objective
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-primary">
                      {hasText(task.goal)
                        ? task.goal
                        : task.description || "No objective text recorded for this task."}
                    </p>
                    {hasText(task.desiredOutcome) && (
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        Desired outcome: {task.desiredOutcome}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <SummaryTile
                      label="Task status"
                      value={cleanStatusLabel[task.status] ?? task.status}
                      tone={statusTone}
                    />
                    <SummaryTile
                      label="Run"
                      value={runState}
                      tone={
                        isRunning
                          ? "info"
                          : task.latestRun?.status === "completed"
                            ? "success"
                            : "default"
                      }
                    />
                    <SummaryTile
                      label="Output"
                      value={outputState}
                      tone={task.prUrl ? "success" : runBranch ? "info" : "default"}
                    />
                    <SummaryTile
                      label="Evidence"
                      value={`${artifacts.length} artifacts`}
                      tone={artifacts.length > 0 ? "success" : "default"}
                    />
                  </div>
                </div>
              </section>

              <section className="col-span-1 rounded-lg border border-white/5 bg-white/[0.03] p-3 lg:col-span-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary0">
                    Presentation readiness
                  </h3>
                  <span className="text-[10px] text-dimmed">
                    {readinessItems.filter((item) => item.state === "ready").length}/
                    {readinessItems.length} ready
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                  {readinessItems.map((item) => (
                    <ReadinessItem
                      key={item.label}
                      label={item.label}
                      detail={item.detail}
                      state={item.state}
                    />
                  ))}
                </div>
              </section>

              <section className="col-span-1 rounded-lg border border-white/5 bg-white/[0.03] p-3 lg:col-span-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary0">
                    Task record
                  </h3>
                  <Badge variant={statusVariant[task.status] ?? "default"} className="text-[10px]">
                    {cleanStatusLabel[task.status] ?? task.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailField label="Task ID" value={task.id} title={task.id} />
                  <DetailField
                    label="Issue"
                    value={
                      task.issueUrl ? (
                        <a
                          href={task.issueUrl}
                          target="_blank"
                          rel="noopener"
                          className="text-accent-text hover:underline"
                        >
                          {task.issueNumber ? `#${task.issueNumber}` : task.issueUrl}
                        </a>
                      ) : task.issueNumber ? (
                        `#${task.issueNumber}`
                      ) : (
                        "Not linked"
                      )
                    }
                    title={task.issueUrl ?? undefined}
                  />
                  <DetailField label="Priority" value={task.priority || "none"} />
                  <DetailField label="Created" value={formatDateTime(task.createdAt)} />
                  <DetailField label="Updated" value={formatDateTime(task.updatedAt)} />
                  <DetailField label="Agent" value={task.agentId || "Default agent"} />
                  <DetailField label="Workflow" value={task.workflowId || "No workflow"} />
                  <DetailField
                    label="Approval"
                    value={task.pendingApproval ? "Pending approval" : "No approval gate"}
                  />
                </div>
              </section>

              <section className="col-span-1 rounded-lg border border-white/5 bg-white/[0.03] p-3 lg:col-span-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary0">
                    Repository and output
                  </h3>
                  {task.prUrl && (
                    <button
                      type="button"
                      onClick={handleCopyPR}
                      className="rounded bg-surface px-2 py-1 text-[10px] text-secondary hover:bg-surface-hover"
                    >
                      {prCopied ? "Copied" : "Copy PR"}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailField
                    label="Repository"
                    value={
                      task.repo ? (
                        <a
                          href={task.repo.url}
                          target="_blank"
                          rel="noopener"
                          className="text-accent-text hover:underline"
                        >
                          {task.repo.name}
                        </a>
                      ) : (
                        "Repository not loaded"
                      )
                    }
                    title={task.repo?.url}
                  />
                  <DetailField
                    label="Base branch"
                    value={task.baseBranch ?? task.repo?.defaultBranch ?? "Not recorded"}
                  />
                  <DetailField
                    label="Task branch"
                    value={runBranch ?? "Not created"}
                    title={runBranch ?? undefined}
                  />
                  <DetailField
                    label="Pull request"
                    value={
                      task.prUrl ? (
                        <a
                          href={task.prUrl}
                          target="_blank"
                          rel="noopener"
                          className="text-accent-text hover:underline"
                        >
                          {task.prUrl.split("/").pop() ?? task.prUrl}
                        </a>
                      ) : task.status === "review" ? (
                        "Ready for PR creation"
                      ) : (
                        "Not created"
                      )
                    }
                    title={task.prUrl ?? undefined}
                  />
                  <DetailField
                    label="Worktree"
                    value={worktreePath ?? "Not recorded"}
                    title={worktreePath ?? undefined}
                  />
                  <DetailField label="Artifacts" value={artifacts.length.toString()} />
                  <DetailField label="Dependencies" value={task.dependsOn.length.toString()} />
                  <DetailField label="Subtasks" value={subTasks.length.toString()} />
                </div>
                {task.status === "review" && !task.prUrl && (
                  <Button
                    variant="primary"
                    size="xs"
                    className="mt-3 text-[10px]"
                    disabled={!!loadingAction}
                    onClick={async () => {
                      setLoadingAction("retry-pr");
                      try {
                        await onRetryPR(task.id);
                      } finally {
                        setLoadingAction(null);
                      }
                    }}
                  >
                    {loadingAction === "retry-pr" ? "Creating PR..." : "Create PR"}
                  </Button>
                )}
              </section>

              <section className="col-span-1 rounded-lg border border-white/5 bg-white/[0.03] p-3 lg:col-span-3">
                <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary0">
                  Execution run
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailField
                    label="Engine"
                    value={task.latestRun?.engine ?? task.engine ?? "Not selected"}
                  />
                  <DetailField label="Model" value={task.model ?? "Engine default"} />
                  <DetailField label="Run status" value={task.latestRun?.status ?? "No run yet"} />
                  <DetailField
                    label="Current phase"
                    value={task.latestRun?.currentStatus ?? runSnapshot?.phase ?? "Not recorded"}
                  />
                  <DetailField
                    label="Session ID"
                    value={sessionId ?? "Not recorded"}
                    title={sessionId ?? undefined}
                  />
                  <DetailField
                    label="Started"
                    value={formatNullableDate(task.latestRun?.startedAt)}
                  />
                  <DetailField
                    label="Finished"
                    value={formatNullableDate(task.latestRun?.finishedAt)}
                  />
                  <DetailField
                    label="Exit code"
                    value={
                      task.latestRun?.exitCode === null || task.latestRun?.exitCode === undefined
                        ? "Not recorded"
                        : task.latestRun.exitCode
                    }
                  />
                  {duration && <DetailField label="Duration" value={duration} />}
                  {isRunning && <DetailField label="Elapsed" value={elapsed} />}
                  {runSnapshot?.validatorAttempts !== undefined && (
                    <DetailField
                      label="Validator attempts"
                      value={runSnapshot.validatorAttempts.toString()}
                    />
                  )}
                  {runSnapshot?.validationSummary && (
                    <DetailField
                      label="Validation summary"
                      value={runSnapshot.validationSummary}
                      title={runSnapshot.validationSummary}
                    />
                  )}
                </div>
              </section>

              {/* Description - full markdown render */}
              {task.description && (
                <div className="col-span-3 bg-white/[0.02] rounded-lg p-3 border border-white/5 h-full min-h-[400px]">
                  <div className="text-[9px] text-dimmed mb-3 flex items-center gap-2">
                    <span>DESCRIPTION</span>
                    <span className="text-[8px] bg-accent/20 text-accent-text px-1.5 rounded uppercase font-bold tracking-wider">
                      markdown
                    </span>
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none text-[12px] text-secondary leading-relaxed space-y-3">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => (
                          <h1 className="text-sm font-bold text-primary mt-3 mb-2">{children}</h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-xs font-bold text-primary mt-3 mb-1.5">{children}</h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-[11px] font-semibold text-primary mt-2 mb-1">
                            {children}
                          </h3>
                        ),
                        p: ({ children }) => (
                          <p className="text-secondary leading-relaxed">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc list-inside space-y-1 text-secondary">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal list-inside space-y-1 text-secondary">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => <li className="text-secondary">{children}</li>,
                        code: ({ className, children }) => {
                          const isInline = !className;
                          return isInline ? (
                            <code className="text-[10px] bg-surface px-1 py-0.5 rounded text-cyan-300 font-mono">
                              {children}
                            </code>
                          ) : (
                            <code className="text-[10px] bg-black/50 p-2 rounded block font-mono text-cyan-300 overflow-x-auto">
                              {children}
                            </code>
                          );
                        },
                        pre: ({ children }) => (
                          <pre className="bg-black/40 rounded p-2 text-[10px] overflow-x-auto">
                            {children}
                          </pre>
                        ),
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            className="text-cyan-400 hover:underline"
                            target="_blank"
                            rel="noopener"
                          >
                            {children}
                          </a>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-2 border-accent/30 pl-3 text-dimmed italic">
                            {children}
                          </blockquote>
                        ),
                        hr: () => <hr className="border-white/10 my-2" />,
                        table: ({ children }) => (
                          <div className="overflow-x-auto">
                            <table className="text-[10px] w-full border-collapse">{children}</table>
                          </div>
                        ),
                        th: ({ children }) => (
                          <th className="border border-white/10 px-2 py-1 text-left bg-white/5">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="border border-white/10 px-2 py-1">{children}</td>
                        ),
                      }}
                    >
                      {task.description}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Desired Outcome */}
              {task.desiredOutcome && (
                <div className="col-span-3 bg-white/[0.02] rounded-lg p-3 border border-white/5">
                  <div className="text-[9px] text-dimmed mb-2 flex items-center gap-2">
                    <span>DESIRED OUTCOME</span>
                  </div>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    {task.desiredOutcome}
                  </p>
                </div>
              )}

              {/* Dependencies */}
              {task.dependsOn && task.dependsOn.length > 0 && (
                <div className="col-span-3 bg-white/[0.02] rounded-lg p-3 border border-white/5">
                  <div className="text-[9px] text-dimmed mb-2">DEPENDENCIES</div>
                  <div className="flex flex-wrap gap-1.5">
                    {task.dependsOn.map((depId) => {
                      const dep = allTasks.find((t) => t.id === depId);
                      return (
                        <button
                          key={depId}
                          type="button"
                          onClick={() => dep && onTaskSelect?.(dep)}
                          className="text-[9px] font-mono px-2 py-0.5 rounded bg-surface hover:bg-surface-hover border border-white/10 text-secondary truncate max-w-[200px]"
                          title={dep?.title ?? depId}
                        >
                          {dep ? dep.title.slice(0, 40) : depId.slice(0, 8)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(costStats || (tokenUsage && Object.keys(tokenUsage).length > 0)) && (
                <section
                  className="col-span-1 rounded-xl glass-card border p-3.5 lg:col-span-3 shadow-sm"
                  style={{ borderColor: "var(--glass-border)" }}
                >
                  <h3
                    className="mb-3 text-[10px] font-black uppercase tracking-[0.16em]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Usage recorded by engine
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <DetailField
                      label="Input tokens"
                      value={(displayInputTokens || 0).toLocaleString()}
                    />
                    <DetailField
                      label="Output tokens"
                      value={(displayOutputTokens || 0).toLocaleString()}
                    />
                    <DetailField
                      label="Total tokens"
                      value={(displayTotalTokens || 0).toLocaleString()}
                    />
                    <DetailField
                      label="Cached tokens"
                      value={(displayCachedTokens || 0).toLocaleString()}
                    />
                    <DetailField label="Input cost" value={inputCost ?? "Not reported"} />
                    <DetailField label="Output cost" value={outputCost ?? "Not reported"} />
                    <DetailField label="Total cost" value={totalCost ?? "Not reported"} />
                    <DetailField
                      label="Tool calls"
                      value={
                        costStats?.tool_calls === undefined
                          ? "Not reported"
                          : costStats.tool_calls.toLocaleString()
                      }
                    />
                  </div>
                </section>
              )}

              {/* Tags & Notes row */}
              <div className="col-span-3 grid grid-cols-2 gap-3">
                <div className="bg-white/[0.01] rounded-lg p-2">
                  <div className="text-[9px] text-dimmed mb-1.5 flex items-center justify-between">
                    <span>TAGS</span>
                    {task.tags && task.tags.length > 0 && (
                      <span className="text-[8px] bg-surface px-1 rounded">{task.tags.length}</span>
                    )}
                  </div>
                  <TaskTagsEditor tags={task.tags ?? []} onChange={handleTagsChange} />
                </div>
                <div className="bg-white/[0.01] rounded-lg p-2">
                  <div className="text-[9px] text-dimmed mb-1.5 flex items-center justify-between">
                    <span>NOTES</span>
                    {notesSaved && <span className="text-[8px] text-emerald-400">✓</span>}
                  </div>
                  <textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    onBlur={handleNotesBlur}
                    placeholder="..."
                    rows={2}
                    className="w-full bg-transparent text-[10px] text-dimmed placeholder-dimmed focus:outline-none resize-none"
                  />
                </div>
              </div>

              {/* Error message */}
              {task.latestRun?.errorMessage && (
                <div className="bg-danger/15 border border-danger/30 rounded-lg p-3">
                  <h3 className="text-xs font-medium text-danger mb-1.5">Erro</h3>
                  <pre className="text-xs text-danger whitespace-pre-wrap break-all font-mono leading-relaxed max-h-32 overflow-y-auto">
                    {task.latestRun.errorMessage}
                  </pre>
                </div>
              )}

              {/* Run Stats */}
              {task.latestRun && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary0 bg-surface/20 rounded-lg px-3 py-2">
                  {task.latestRun.startedAt && (
                    <div>
                      <span className="text-dimmed">Iniciado </span>
                      {formatDateTime(task.latestRun.startedAt)}
                    </div>
                  )}
                  {duration && (
                    <div>
                      <span className="text-dimmed">Duration </span>
                      <span className="text-secondary font-medium">{duration}</span>
                    </div>
                  )}
                  {task.latestRun.exitCode !== null && (
                    <div>
                      <span className="text-dimmed">Exit </span>
                      <code
                        className={`font-mono ${task.latestRun.exitCode === 0 ? "text-green-400" : "text-danger"}`}
                      >
                        {task.latestRun.exitCode}
                      </code>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="space-y-4">
                {(task.status === "backlog" || task.status === "failed") && engines && (
                  <div className="bg-surface/30 border border-strong rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-semibold text-primary0 uppercase tracking-wider">
                        Run configuration
                      </h3>
                      <span className="text-[10px] text-dimmed italic">
                        Choose engine and model before starting
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] text-primary0 mb-1">Engine</div>
                        <Select
                          value={selectedEngine}
                          onChange={(e) => setSelectedEngine(e.target.value)}
                          className="h-8 py-1 text-xs"
                          required
                        >
                          <option value="" disabled>
                            Selecione uma engine...
                          </option>
                          <option value="auto">Auto (First Available)</option>
                          {engines.map((eng) => (
                            <option key={eng.name} value={eng.name} disabled={!eng.available}>
                              {eng.displayName}
                              {!eng.available ? " (unavailable)" : ""}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div>
                        <div className="text-[10px] text-primary0 mb-1">Modelo</div>
                        <Select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          disabled={loadingModels || !selectedEngine}
                          className="h-8 py-1 text-xs"
                        >
                          <option value="">
                            {loadingModels ? "Loading..." : "Engine default"}
                          </option>
                          {groupModelsByProvider(availableModels).map(
                            ({ provider, models: providerModels }) => (
                              <optgroup key={provider} label={provider}>
                                {providerModels.map((m) => (
                                  <option key={m} value={m}>
                                    {m.includes("/") ? m.split("/").slice(1).join("/") : m}
                                  </option>
                                ))}
                              </optgroup>
                            )
                          )}
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 flex-wrap items-center pt-4 border-t border-white/5">
                  {(task.status === "backlog" || task.status === "failed") && (
                    <Button
                      variant="primary"
                      disabled={!!loadingAction || !selectedEngine}
                      onClick={async () => {
                        setLoadingAction("launch");
                        try {
                          await onLaunch(task.id, selectedEngine, selectedModel);
                        } finally {
                          setLoadingAction(null);
                        }
                      }}
                      className="rounded-xl h-12 px-8 bg-gradient-to-r from-blue-600 to-indigo-600 shadow-xl shadow-blue-500/20 font-black uppercase tracking-widest text-[10px] active-shrink"
                    >
                      {loadingAction === "launch" ? "Starting run..." : "Start run"}
                    </Button>
                  )}
                  {task.status === "failed" && (
                    <Button
                      variant="outline"
                      disabled={!!loadingAction || !selectedEngine}
                      onClick={async () => {
                        setLoadingAction("retry");
                        try {
                          await onRetry(task.id, selectedEngine, selectedModel);
                        } finally {
                          setLoadingAction(null);
                        }
                      }}
                      className="rounded-xl h-12 px-6 border-white/10 bg-white/5 font-black uppercase tracking-widest text-[10px] active-shrink"
                    >
                      {loadingAction === "retry" ? "Starting retry..." : "Retry run"}
                    </Button>
                  )}
                  {task.status === "in_progress" && (
                    <Button
                      variant="danger"
                      disabled={!!loadingAction}
                      onClick={async () => {
                        setLoadingAction("cancel");
                        try {
                          await onCancel(task.id);
                        } finally {
                          setLoadingAction(null);
                        }
                      }}
                      className="rounded-xl h-12 px-8 bg-gradient-to-r from-red-600 to-rose-600 shadow-xl shadow-red-500/20 font-black uppercase tracking-widest text-[10px] active-shrink"
                    >
                      {loadingAction === "cancel" ? "Cancelling..." : "Cancel run"}
                    </Button>
                  )}
                  {confirmDelete ? (
                    <div className="flex items-center gap-2 p-1 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <span className="text-[10px] font-black uppercase px-3 text-red-400">
                        Confirm deletion?
                      </span>
                      <Button
                        variant="danger"
                        onClick={() => onDelete(task.id)}
                        className="h-9 px-4 text-[10px] font-black uppercase bg-red-600 rounded-lg"
                      >
                        Delete
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmDelete(false)}
                        className="h-9 px-4 text-[10px] font-black uppercase text-white rounded-lg"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmDelete(true)}
                      className="text-primary0 hover:text-red-400 font-black uppercase tracking-widest text-[10px]"
                    >
                      Delete task
                    </Button>
                  )}
                </div>
              </div>

              {/* Parent task link */}
              {task.parentTaskId && (
                <div className="text-xs text-primary0">
                  Subtask of{" "}
                  {parentTask ? (
                    <button
                      type="button"
                      onClick={() => onTaskSelect?.(parentTask)}
                      className="text-accent-text hover:underline font-medium"
                    >
                      {parentTask.title.slice(0, 60)}
                    </button>
                  ) : (
                    <code className="text-secondary bg-surface px-1 py-0.5 rounded font-mono">
                      {task.parentTaskId.slice(0, 8)}
                    </code>
                  )}
                </div>
              )}

              {/* Schedule section */}
              {(task.status === "scheduled" || task.status === "backlog") && (
                <ScheduleSection taskId={task.id} onTaskRefresh={onTaskRefresh ?? (() => {})} />
              )}

              {/* Timestamps */}
              <div className="text-[11px] text-dimmed space-y-0.5 pt-2 border-t border-default">
                <div>Criado: {formatDateTime(task.createdAt)}</div>
                <div>Atualizado: {formatDateTime(task.updatedAt)}</div>
              </div>
            </div>
          )}

          {/* ── Terminal Tab (real terminal session channel) ── */}
          {activeTab === "terminal" && (
            <div className="flex-1 min-h-0">
              <TerminalSessionPanel
                taskId={task.id}
                runId={task.latestRun?.id ?? null}
                chunks={terminalLogs}
                onWsSend={onWsSend}
              />
            </div>
          )}

          {/* ── Execution Tab (agent timeline/logs) ── */}
          {activeTab === "execution" && (
            <div className="flex-1 min-h-0">
              <ExecutionTimeline
                taskId={task.id}
                runId={task.latestRun?.id ?? null}
                logs={liveLogs}
                isRunning={isRunning}
                currentStatus={task.latestRun?.currentStatus ?? null}
                costStats={task.latestRun?.costStats ?? null}
                onSendInput={onSendInput}
              />
            </div>
          )}

          {/* ── Skills Tab ─────────────────────────────────── */}
          {activeTab === "skills" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  Skills loaded by CLI
                </span>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}
                >
                  {matchedSkills.length}
                </span>
              </div>
              {categoryOrder
                .filter((cat) => skillsByCategory[cat]?.length > 0)
                .map((cat) => {
                  const colors = skillCategoryColor[cat] ?? {
                    bg: "rgba(100,100,100,0.15)",
                    border: "rgba(100,100,100,0.35)",
                    text: "var(--text-secondary)",
                  };
                  return (
                    <div key={cat}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span
                          className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded"
                          style={{ background: colors.bg, color: colors.text }}
                        >
                          {skillCategoryLabel[cat] ?? cat}
                        </span>
                        <span className="text-[10px]" style={{ color: "var(--text-dimmed)" }}>
                          {skillsByCategory[cat].length}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {skillsByCategory[cat].map(({ raw, name }) =>
                          onSkillClick ? (
                            <button
                              key={raw}
                              type="button"
                              onClick={() => onSkillClick(raw)}
                              className="inline-flex items-center gap-1 text-[11px] rounded px-2 py-0.5 cursor-pointer transition-colors"
                              style={{
                                background: colors.bg,
                                border: `1px solid ${colors.border}`,
                                color: colors.text,
                              }}
                            >
                              <span className="opacity-60">⚡</span>
                              {name}
                            </button>
                          ) : (
                            <span
                              key={raw}
                              className="inline-flex items-center gap-1 text-[11px] rounded px-2 py-0.5"
                              style={{
                                background: colors.bg,
                                border: `1px solid ${colors.border}`,
                                color: colors.text,
                              }}
                            >
                              <span className="opacity-60">⚡</span>
                              {name}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* ── Diff Tab ───────────────────────────────────── */}
          {activeTab === "artifacts" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-primary">Work products</h2>
                <p className="text-xs text-dimmed mt-1">
                  Outputs persistidos desta tarefa: PRs, branches, worktrees e documentação.
                </p>
              </div>
              {artifacts.length === 0 ? (
                <div className="flex items-center justify-center h-32 border border-dashed border-strong rounded-lg">
                  <p className="text-sm text-dimmed">Nenhum artifact registrado ainda.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {artifacts.map((artifact) => {
                    const isLink = /^https?:\/\//.test(artifact.uri);
                    return (
                      <div
                        key={artifact.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-default bg-input/40 p-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="default" className="text-[9px] px-1.5 py-0 h-auto">
                              {artifact.kind}
                            </Badge>
                            <span className="text-xs font-medium text-secondary">
                              {artifact.title}
                            </span>
                          </div>
                          <code className="mt-1 block truncate text-[11px] text-dimmed">
                            {artifact.uri}
                          </code>
                        </div>
                        {isLink ? (
                          <a
                            href={artifact.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-xs text-accent hover:underline"
                          >
                            Abrir
                          </a>
                        ) : (
                          <span className="shrink-0 text-[10px] text-dimmed">
                            {formatDateTime(artifact.createdAt)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "diff" && (
            <div className="flex-1 min-h-0 flex flex-col p-4">
              {task.branchName ? (
                <DiffViewer taskId={task.id} branchName={task.branchName} />
              ) : (
                <div className="flex items-center justify-center h-32">
                  <p className="text-sm text-dimmed">Sem alterações — branch não criada</p>
                </div>
              )}
            </div>
          )}

          {/* ── Cost Tab (Neuromorphic Grid) ───────────────────────────────────── */}
          {activeTab === "cost" &&
            (costStats || (tokenUsage && Object.keys(tokenUsage).length > 0) ? (
              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-black/20">
                <div className="flex items-center justify-between">
                  <h2
                    className="text-sm font-black tracking-widest uppercase"
                    style={{ color: "var(--text-primary)" }}
                  >
                    System Telemetry
                  </h2>
                  {task.maxCost !== undefined && (
                    <span
                      className="text-[10px] font-mono px-2.5 py-1 rounded border border-white/10"
                      style={{ background: "rgba(0,0,0,0.4)", color: "var(--text-muted)" }}
                    >
                      BUDGET: ${task.maxCost.toFixed(2)}
                    </span>
                  )}
                </div>

                {task.maxCost !== undefined && task.maxCost > 0 && (
                  <div
                    className="rounded-xl p-4 border border-white/5 space-y-2"
                    style={{
                      background: "rgba(20,20,20,0.4)",
                      borderColor: "var(--glass-border)",
                    }}
                  >
                    <div className="flex justify-between text-[10px] font-mono">
                      <span style={{ color: "var(--text-dimmed)" }}>BUDGET CONSUMPTION</span>
                      <span className="font-bold text-emerald-400">
                        {((displayTotalCostUSD / task.maxCost) * 100).toFixed(1)}% ($
                        {displayTotalCostUSD.toFixed(4)} / ${task.maxCost.toFixed(2)})
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500 ease-out"
                        style={{
                          width: `${Math.min(100, (displayTotalCostUSD / task.maxCost) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Primary Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div
                    className="rounded-xl p-4 border border-white/5 relative overflow-hidden group"
                    style={{
                      background: "rgba(20,20,20,0.6)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
                    }}
                  >
                    <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/10 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                    <div
                      className="text-[9px] font-black uppercase tracking-[0.2em] mb-2 relative z-10"
                      style={{ color: "var(--text-dimmed)" }}
                    >
                      Total Tokens
                    </div>
                    <div
                      className="text-2xl font-black font-mono tracking-tight relative z-10"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {(displayTotalTokens || 0).toLocaleString()}
                    </div>
                  </div>

                  <div
                    className="rounded-xl p-4 border border-white/5 relative overflow-hidden group"
                    style={{
                      background: "rgba(20,20,20,0.6)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
                    }}
                  >
                    <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                    <div
                      className="text-[9px] font-black uppercase tracking-[0.2em] mb-2 relative z-10"
                      style={{ color: "var(--text-dimmed)" }}
                    >
                      Total Cost
                    </div>
                    <div className="text-2xl font-black font-mono tracking-tight relative z-10 text-emerald-400">
                      ${(displayTotalCostUSD || 0).toFixed(6)}
                    </div>
                  </div>

                  {costStats?.duration_ms && (
                    <div
                      className="rounded-xl p-4 border border-white/5 relative overflow-hidden group"
                      style={{
                        background: "rgba(20,20,20,0.6)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
                      }}
                    >
                      <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/10 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                      <div
                        className="text-[9px] font-black uppercase tracking-[0.2em] mb-2 relative z-10"
                        style={{ color: "var(--text-dimmed)" }}
                      >
                        Latency
                      </div>
                      <div
                        className="text-2xl font-black font-mono tracking-tight relative z-10"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {(costStats.duration_ms / 1000).toFixed(1)}s
                      </div>
                    </div>
                  )}

                  {costStats?.tool_calls !== undefined && (
                    <div
                      className="rounded-xl p-4 border border-white/5 relative overflow-hidden group"
                      style={{
                        background: "rgba(20,20,20,0.6)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
                      }}
                    >
                      <div className="absolute top-0 right-0 w-16 h-16 bg-purple-500/10 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                      <div
                        className="text-[9px] font-black uppercase tracking-[0.2em] mb-2 relative z-10"
                        style={{ color: "var(--text-dimmed)" }}
                      >
                        Tool Invocations
                      </div>
                      <div
                        className="text-2xl font-black font-mono tracking-tight relative z-10"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {costStats.tool_calls}
                      </div>
                    </div>
                  )}
                </div>

                {/* Detailed Breakdown */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div
                    className="rounded-xl p-5 border border-white/5"
                    style={{ background: "rgba(10,10,10,0.8)" }}
                  >
                    <h3
                      className="text-[10px] font-black uppercase tracking-[0.2em] mb-4 flex items-center gap-2"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <span className="w-2 h-2 rounded-sm bg-blue-500/50" />
                      Token Flux
                    </h3>
                    <div className="space-y-4 font-mono text-xs">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <span className="text-dimmed">Input Stream</span>
                        <span className="text-blue-400 font-bold">
                          ↓{(displayInputTokens || 0).toLocaleString()}
                        </span>
                      </div>
                      {displayCachedTokens > 0 && (
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <span className="text-dimmed">Cache Hit</span>
                          <span className="text-emerald-400 font-bold">
                            +{(displayCachedTokens || 0).toLocaleString()}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-dimmed">Output Stream</span>
                        <span className="text-purple-400 font-bold">
                          ↑{(displayOutputTokens || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {((tokenUsage && Object.keys(tokenUsage).length > 0) ||
                    (costStats?.models && Object.keys(costStats.models).length > 0)) && (
                    <div
                      className="rounded-xl p-5 border border-white/5"
                      style={{ background: "rgba(10,10,10,0.8)" }}
                    >
                      <h3
                        className="text-[10px] font-black uppercase tracking-[0.2em] mb-4 flex items-center gap-2"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <span className="w-2 h-2 rounded-sm bg-purple-500/50" />
                        Model Utilization
                      </h3>
                      <div className="space-y-3">
                        {tokenUsage && Object.keys(tokenUsage).length > 0
                          ? (
                              Object.entries(tokenUsage) as Array<
                                [string, NonNullable<typeof tokenUsage>[string]]
                              >
                            ).map(([model, stats]) => (
                              <div
                                key={model}
                                className="flex items-center justify-between p-2.5 rounded-lg border border-white/5"
                                style={{ background: "rgba(255,255,255,0.02)" }}
                              >
                                <div className="flex flex-col min-w-0 mr-4">
                                  <span
                                    className="text-[10px] font-bold font-mono truncate text-left"
                                    style={{ color: "var(--text-primary)" }}
                                    title={model}
                                  >
                                    {model.split("/").pop()}
                                  </span>
                                  <span className="text-[9px] text-dimmed font-mono text-left">
                                    in: {stats.input_tokens.toLocaleString()} | out:{" "}
                                    {stats.output_tokens.toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4 text-[10px] font-mono shrink-0">
                                  <div className="text-right">
                                    <span className="text-dimmed mr-1">T:</span>
                                    <span className="text-blue-300">
                                      {stats.total_tokens.toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="text-right min-w-[60px]">
                                    <span className="text-dimmed mr-1">$</span>
                                    <span className="text-emerald-400">
                                      {(
                                        stats.total_cost ??
                                        (stats.input_cost || 0) + (stats.output_cost || 0)
                                      ).toFixed(6)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))
                          : Object.entries(costStats?.models || {}).map(
                              ([model, stats]: [string, any]) => (
                                <div
                                  key={model}
                                  className="flex items-center justify-between p-2.5 rounded-lg border border-white/5"
                                  style={{ background: "rgba(255,255,255,0.02)" }}
                                >
                                  <span
                                    className="text-[10px] font-mono truncate mr-4 text-left"
                                    style={{ color: "var(--text-primary)" }}
                                    title={model}
                                  >
                                    {model.split("/").pop()}
                                  </span>
                                  <div className="flex items-center gap-4 text-[10px] font-mono shrink-0">
                                    <div className="text-right">
                                      <span className="text-dimmed mr-1">T:</span>
                                      <span className="text-blue-300">
                                        {stats.total_tokens.toLocaleString()}
                                      </span>
                                    </div>
                                    {stats.input !== undefined && (
                                      <div className="text-right min-w-[60px]">
                                        <span className="text-dimmed mr-1">$</span>
                                        <span className="text-emerald-400">
                                          {(stats.input / 1000000).toFixed(4)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto bg-black/20 p-6">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                  <h2 className="text-sm font-semibold text-primary">Token usage</h2>
                  <p className="mt-2 text-xs leading-relaxed text-dimmed">
                    No token or cost telemetry has been recorded for this task yet. It will appear
                    here as soon as the engine emits cost events for the latest run.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <DetailField
                      label="Run status"
                      value={task.latestRun?.status ?? "No run yet"}
                    />
                    <DetailField
                      label="Engine"
                      value={task.latestRun?.engine ?? task.engine ?? "Not selected"}
                    />
                    <DetailField label="Model" value={task.model ?? "Engine default"} />
                  </div>
                </div>
              </div>
            ))}

          {/* ── M3.4: Memory Tab ──────────────────────────────────── */}
          {activeTab === "memory" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="space-y-4">
                {/* Shared Memory */}
                <div>
                  <label
                    htmlFor={sharedMemoryInputId}
                    className="text-xs font-semibold text-primary0 mb-1.5 block"
                  >
                    📚 Shared Memory (cross-task context)
                  </label>
                  <textarea
                    id={sharedMemoryInputId}
                    value={sharedMemory}
                    onChange={(e) => setSharedMemory(e.target.value)}
                    onFocus={() => {
                      if (!sharedMemory) {
                        api.tasks.getMemory(task.id, "shared").then((res) => {
                          setSharedMemory(res.memory?.content ?? "");
                        });
                      }
                    }}
                    className="w-full h-32 p-3 border rounded text-xs font-mono resize-none"
                    style={{
                      background: "var(--bg-input)",
                      borderColor: "var(--surface-border)",
                      color: "var(--text-primary)",
                    }}
                    placeholder="Enter knowledge shared across all runs for this task..."
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      setMemorySaving(true);
                      try {
                        await api.tasks.updateMemory(task.id, "shared", sharedMemory);
                      } finally {
                        setMemorySaving(false);
                      }
                    }}
                    disabled={memorySaving}
                    className="mt-2 px-3 py-1 text-xs bg-primary0 text-white rounded hover:opacity-80 transition-opacity"
                  >
                    {memorySaving ? "Salvando..." : "💾 Salvar"}
                  </button>
                </div>

                {/* Task-Local Memory */}
                <div>
                  <label
                    htmlFor={taskMemoryInputId}
                    className="text-xs font-semibold text-primary0 mb-1.5 block"
                  >
                    📝 Task Memory (this task only)
                  </label>
                  <textarea
                    id={taskMemoryInputId}
                    value={taskMemory}
                    onChange={(e) => setTaskMemory(e.target.value)}
                    onFocus={() => {
                      if (!taskMemory) {
                        api.tasks.getMemory(task.id, "task").then((res) => {
                          setTaskMemory(res.memory?.content ?? "");
                        });
                      }
                    }}
                    className="w-full h-32 p-3 border rounded text-xs font-mono resize-none"
                    style={{
                      background: "var(--bg-input)",
                      borderColor: "var(--surface-border)",
                      color: "var(--text-primary)",
                    }}
                    placeholder="Enter task-specific context and progress notes..."
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      setMemorySaving(true);
                      try {
                        await api.tasks.updateMemory(task.id, "task", taskMemory);
                      } finally {
                        setMemorySaving(false);
                      }
                    }}
                    disabled={memorySaving}
                    className="mt-2 px-3 py-1 text-xs bg-primary0 text-white rounded hover:opacity-80 transition-opacity"
                  >
                    {memorySaving ? "Salvando..." : "💾 Salvar"}
                  </button>
                </div>

                <p className="text-[11px] text-dimmed pt-2 border-t border-default">
                  Memory is injected into the agent's prompt before each run. Use this to record
                  lessons learned, patterns observed, and important context.
                </p>
              </div>
            </div>
          )}

          {/* ── M4.4: Review Issues Tab ──────────────────────────────────── */}
          {activeTab === "reviews" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-primary">Review Rounds</h2>
                <button
                  type="button"
                  onClick={async () => {
                    setReviewsLoading(true);
                    try {
                      const { rounds } = await api.reviews.listRounds(task.id);
                      const { issues } = await api.reviews.listIssues(task.id);
                      setReviewRounds(rounds || []);
                      setReviewIssues(issues || []);
                    } finally {
                      setReviewsLoading(false);
                    }
                  }}
                  className="px-2 py-1 text-xs rounded bg-primary0 text-white hover:opacity-80 transition-opacity"
                  disabled={reviewsLoading}
                >
                  {reviewsLoading ? "Loading..." : "Reload"}
                </button>
              </div>

              {reviewRounds.length === 0 ? (
                <div className="text-center py-8 text-dimmed">
                  <p className="text-sm">No review rounds yet</p>
                  <p className="text-xs mt-1">Run with review phase to generate rounds</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reviewRounds.map((round: any) => {
                    const roundIssues = reviewIssues.filter((i: any) => i.roundId === round.id);
                    const severityColors: Record<string, { bg: string; text: string }> = {
                      info: { bg: "var(--bg-info)", text: "var(--text-info)" },
                      warning: { bg: "var(--bg-warning)", text: "var(--text-warning)" },
                      blocker: { bg: "var(--bg-danger)", text: "var(--text-danger)" },
                    };
                    const statusColors: Record<string, string> = {
                      open: "var(--text-warning)",
                      valid: "var(--text-danger)",
                      invalid: "var(--text-success)",
                      fixed: "var(--text-info)",
                      resolved: "var(--text-success)",
                    };

                    return (
                      <div
                        key={round.id}
                        className="border rounded-lg p-3"
                        style={{ borderColor: "var(--surface-border)" }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-semibold text-primary0">
                            Round {round.roundNumber} · {round.status}
                          </h3>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{
                              background: "var(--bg-input)",
                              color: "var(--text-muted)",
                            }}
                          >
                            {roundIssues.length} issues
                          </span>
                        </div>

                        {roundIssues.length === 0 ? (
                          <p className="text-[11px] text-dimmed">No issues in this round</p>
                        ) : (
                          <div className="space-y-2">
                            {roundIssues.map((issue: any) => {
                              const colors = severityColors[issue.severity] || {
                                bg: "var(--bg-input)",
                                text: "var(--text-primary)",
                              };
                              return (
                                <div
                                  key={issue.id}
                                  className="flex items-start gap-2 p-2 rounded text-xs"
                                  style={{ background: "var(--bg-input)" }}
                                >
                                  <span
                                    className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0"
                                    style={{ background: colors.bg, color: colors.text }}
                                  >
                                    {issue.severity.toUpperCase()}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div
                                      className="font-medium"
                                      style={{ color: "var(--text-primary)" }}
                                    >
                                      {issue.title}
                                    </div>
                                    {issue.content && (
                                      <div
                                        className="text-[10px] mt-1 opacity-80"
                                        style={{ color: "var(--text-muted)" }}
                                      >
                                        {issue.content.length > 120
                                          ? `${issue.content.slice(0, 120)}...`
                                          : issue.content}
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 mt-1.5">
                                      <span
                                        className="text-[9px] px-1 py-0.5 rounded-full"
                                        style={{
                                          background: "var(--bg-surface)",
                                          color: "var(--text-muted)",
                                        }}
                                      >
                                        {issue.persona}
                                      </span>
                                      <span
                                        className="text-[9px] font-mono"
                                        style={{ color: statusColors[issue.status] }}
                                      >
                                        [{issue.status}]
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await api.reviews.updateIssue(task.id, issue.id, {
                                        status: issue.status === "open" ? "resolved" : "open",
                                      });
                                      setReviewIssues((prev) =>
                                        prev.map((i: any) =>
                                          i.id === issue.id
                                            ? {
                                                ...i,
                                                status: i.status === "open" ? "resolved" : "open",
                                              }
                                            : i
                                        )
                                      );
                                    }}
                                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0 hover:opacity-70 transition-opacity"
                                    style={{
                                      background: "var(--accent-muted)",
                                      color: "var(--accent-text)",
                                    }}
                                  >
                                    {issue.status === "open" ? "✓ Mark" : "↺ Reopen"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* M2.2: Preview Prompt Modal */}
      {previewPrompt !== null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 rounded-xl">
          <button
            type="button"
            aria-label="Fechar preview do prompt"
            className="absolute inset-0 bg-black/60 rounded-xl"
            onClick={() => setPreviewPrompt(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-prompt-title"
            className="relative bg-surface border border-surface-border rounded-lg max-w-4xl max-h-96 w-full flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border shrink-0">
              <h3 id="preview-prompt-title" className="text-sm font-semibold">
                Preview do Prompt do Agente
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(previewPrompt);
                    setPromptCopied(true);
                    setTimeout(() => setPromptCopied(false), 2000);
                  }}
                  className="text-xs px-2 py-1 bg-primary0 text-white rounded hover:opacity-80 transition-opacity"
                >
                  {promptCopied ? "✓ Copiado" : "📋 Copiar"}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPrompt(null)}
                  className="text-primary0 hover:text-secondary text-lg"
                >
                  ✕
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs bg-surface-dark rounded text-text-primary font-mono whitespace-pre-wrap break-words">
              {previewPrompt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
