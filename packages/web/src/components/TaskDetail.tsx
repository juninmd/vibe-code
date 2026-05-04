import type {
  AgentLog,
  EngineInfo,
  TaskArtifact,
  TaskSchedule,
  TaskWithRun,
  UpdateTaskRequest,
} from "@vibe-code/shared";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api/client";
import { useElapsedTime } from "../hooks/useElapsedTime";
import { formatDateTime, formatDuration } from "../utils/date";
import { DiffViewer } from "./DiffViewer";
import { TaskTagsEditor } from "./TaskTags";
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
  onApprove?: (taskId: string) => Promise<void>;
  onReject?: (taskId: string) => Promise<void>;
  onClone?: (taskId: string) => Promise<void>;
  onUpdateTask?: (taskId: string, data: UpdateTaskRequest) => Promise<void>;
  onTaskRefresh?: () => void;
  onSkillClick?: (skillName: string) => void;
  allTasks?: TaskWithRun[];
}

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
};

const statusLabel: Record<string, string> = {
  scheduled: "⏰ Agendada",
  backlog: "Backlog",
  in_progress: "Em Execução",
  review: "Em Revisão",
  done: "Concluída",
  failed: "Falha",
};

const CRON_PRESETS = [
  { label: "A cada hora", value: "0 * * * *" },
  { label: "Diariamente (meia-noite)", value: "0 0 * * *" },
  { label: "Diariamente (9h)", value: "0 9 * * *" },
  { label: "Semanalmente (seg 9h)", value: "0 9 * * 1" },
  { label: "Customizado...", value: "custom" },
];

// Pipeline step for PR creation flow
type PipelineStep = "running" | "review" | "pushing" | "pr_created";

function PipelineSteps({
  task,
  isRunning: _isRunning,
  currentStatus,
}: {
  task: TaskWithRun;
  isRunning: boolean;
  currentStatus: string | null;
}) {
  const steps: { id: PipelineStep; label: string; icon: string }[] = [
    { id: "running", label: "Executando", icon: "⚙" },
    { id: "review", label: "Revisão", icon: "◎" },
    { id: "pushing", label: "Push & PR", icon: "↑" },
    { id: "pr_created", label: "PR Aberto", icon: "✓" },
  ];

  // Determine current step based on task/run state
  let activeStep: PipelineStep | null = null;
  let completedSteps: PipelineStep[] = [];

  if (task.status === "in_progress") {
    if (currentStatus?.includes("review") || currentStatus?.includes("Review")) {
      activeStep = "review";
      completedSteps = ["running"];
    } else if (currentStatus?.includes("Push") || currentStatus?.includes("PR")) {
      activeStep = "pushing";
      completedSteps = ["running", "review"];
    } else {
      activeStep = "running";
    }
  } else if (task.status === "review") {
    if (task.prUrl) {
      completedSteps = ["running", "review", "pushing", "pr_created"];
    } else {
      completedSteps = ["running", "review"];
      activeStep = "pushing";
    }
  } else if (task.status === "done") {
    completedSteps = ["running", "review", "pushing", "pr_created"];
  } else if (task.status === "failed") {
    // Show how far we got
    if (task.branchName) completedSteps = ["running", "review"];
  }

  if (
    task.status !== "in_progress" &&
    task.status !== "review" &&
    task.status !== "done" &&
    task.status !== "failed"
  ) {
    return null;
  }

  const progressValue = activeStep
    ? Math.max(12, (steps.findIndex((step) => step.id === activeStep) / (steps.length - 1)) * 100)
    : completedSteps.length > 0
      ? (completedSteps.length / steps.length) * 100
      : 0;

  return (
    <div className="space-y-3 rounded-lg border border-default bg-input/40 p-3">
      <div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-primary0">
          <span>Execução</span>
          <span>{Math.round(progressValue)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-[width] duration-500"
            style={{ width: `${progressValue}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const isCompleted = completedSteps.includes(step.id);
          const isActive = activeStep === step.id;
          return (
            <div key={step.id} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                    isCompleted
                      ? "bg-success/15 border-emerald-600 text-success"
                      : isActive
                        ? "bg-info/15 border-blue-500 text-info animate-pulse"
                        : "bg-surface border-strong text-dimmed"
                  }`}
                >
                  {isCompleted ? (
                    "✓"
                  ) : isActive ? (
                    <span className="animate-spin">⟳</span>
                  ) : (
                    step.icon
                  )}
                </div>
                <span
                  className={`text-[9px] font-medium truncate max-w-[50px] text-center leading-tight ${
                    isCompleted ? "text-success" : isActive ? "text-info" : "text-dimmed"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-1 mt-[-12px] rounded ${
                    completedSteps.includes(steps[i + 1].id) || isCompleted
                      ? "bg-emerald-700"
                      : "bg-surface-hover"
                  }`}
                />
              )}
            </div>
          );
        })}
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
  onApprove,
  onReject,
  onClone,
  onUpdateTask,
  onTaskRefresh,
  onSkillClick,
  allTasks = [],
}: TaskDetailProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prCopied, setPrCopied] = useState(false);
  const [notesValue, setNotesValue] = useState(task.notes ?? "");
  const [goalValue, setGoalValue] = useState(task.goal ?? "");
  const [outcomeValue, setOutcomeValue] = useState(task.desiredOutcome ?? "");
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

  type ActiveTab =
    | "info"
    | "terminal"
    | "diff"
    | "artifacts"
    | "skills"
    | "cost"
    | "memory"
    | "reviews";
  const [activeTab, setActiveTab] = useState<ActiveTab>(isRunning ? "terminal" : "info");
  const [sharedMemory, setSharedMemory] = useState<string>("");
  const [taskMemory, setTaskMemory] = useState<string>("");
  const [memorySaving, setMemorySaving] = useState(false);
  const [reviewRounds, setReviewRounds] = useState<any[]>([]);
  const [reviewIssues, setReviewIssues] = useState<any[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

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
    setGoalValue(task.goal ?? "");
    setOutcomeValue(task.desiredOutcome ?? "");
    setMatchedSkills([]);
    setArtifacts([]);
    setActiveTab(
      task.status === "in_progress" || task.latestRun?.status === "running" ? "terminal" : "info"
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

  const handleAlignmentBlur = () => {
    if (!onUpdateTask) return;
    const goal = goalValue.trim();
    const desiredOutcome = outcomeValue.trim();
    if (goal === (task.goal ?? "") && desiredOutcome === (task.desiredOutcome ?? "")) return;
    onUpdateTask(task.id, {
      goal: goal || null,
      desiredOutcome: desiredOutcome || null,
    }).then(() => {
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
        className="relative w-[1100px] h-[90vh] flex flex-col rounded-xl border overflow-hidden shadow-2xl shadow-black/60"
        style={{
          background: "var(--bg-surface)",
          backgroundImage: auraStyle[task.status] || auraStyle.default,
          borderColor: "var(--glass-border)",
        }}
      >
        {/* Inner glow border for premium feel */}
        <div className="absolute inset-0 rounded-2xl pointer-events-none border border-white/5" />

        {/* ── Modal Header ────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-5 pb-0 relative z-10">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              {ProviderIcon && (
                <div className={`mt-1 shrink-0 ${provider?.color}`}>
                  <ProviderIcon size={18} />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold leading-tight text-primary">{task.title}</h2>
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
                    className="text-[11px] text-primary0 hover:text-secondary transition-colors truncate block mt-0.5"
                  >
                    {task.repo.name}
                  </a>
                )}
              </div>
            </div>

            {/* Header actions */}
            <div className="flex items-center gap-1 shrink-0">
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
                    className="text-primary0 hover:text-secondary cursor-pointer shrink-0 p-1 rounded hover:bg-surface-hover transition-colors text-xs font-medium"
                    disabled={loadingAction === "open-editor"}
                  >
                    {loadingAction === "open-editor" ? "..." : "<>"}
                  </button>
                  <a
                    href={api.tasks.downloadUrl(task.id)}
                    download
                    title="Baixar código (ZIP)"
                    className="text-primary0 hover:text-secondary cursor-pointer shrink-0 p-1 rounded hover:bg-surface-hover transition-colors text-sm"
                  >
                    ↓
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
                  title="Clonar tarefa"
                  className="text-primary0 hover:text-secondary cursor-pointer shrink-0 p-1 rounded hover:bg-surface-hover transition-colors"
                >
                  ⎘
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
                title="Preview prompt do agente"
                className="text-primary0 hover:text-secondary cursor-pointer shrink-0 p-1 rounded hover:bg-surface-hover transition-colors text-xs"
              >
                {loadingAction === "preview-prompt" ? "..." : "👁"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-primary0 hover:text-secondary cursor-pointer shrink-0 p-1 rounded hover:bg-surface-hover transition-colors"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Status badges row */}
          <div className="flex flex-wrap gap-2 items-center mt-3">
            <Badge variant={statusVariant[task.status] ?? "default"}>
              {statusLabel[task.status] ?? task.status}
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

          {/* Tab bar */}
          <div className="flex justify-center mt-6 border-b border-white/5 relative z-20">
            <div className="flex gap-1 overflow-x-auto no-scrollbar pb-px">
              {(
                [
                  { id: "info" as const, label: "INFO" },
                  { id: "terminal" as const, label: "TERMINAL" },
                  { id: "diff" as const, label: "DIFF" },
                  { id: "artifacts" as const, label: "ARTIFACTS" },
                  { id: "skills" as const, label: "SKILLS" },
                  { id: "cost" as const, label: "TELEMETRY" },
                  { id: "memory" as const, label: "MEMORY" },
                  { id: "reviews" as const, label: "REVIEWS" },
                ] satisfies { id: ActiveTab; label: string }[]
              ).map(({ id, label }) => {
                if (id === "skills" && matchedSkills.length === 0) return null;
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`px-4 py-2.5 text-[10px] font-black tracking-[0.15em] transition-all relative group ${isActive ? "text-primary" : "text-muted hover:text-secondary"}`}
                  >
                    <div className="flex items-center gap-2">
                      {label}
                      {id === "terminal" && isRunning && (
                        <span className="w-1.5 h-1.5 rounded-full bg-info shadow-[0_0_8px_var(--info)] animate-pulse" />
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
                    </div>
                    {/* Active Indicator */}
                    {isActive && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-white to-transparent" />
                    )}
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
                <h3 className="text-sm font-semibold">Governance Gate: Aprovação Necessária</h3>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-secondary leading-relaxed">
                  {approvalRequest?.message || "O agente solicitou autorização para continuar."}
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
                  {loadingAction === "approve" ? "Aprovando..." : "✅ Aprovar"}
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
                  {loadingAction === "reject" ? "Rejeitando..." : "❌ Rejeitar"}
                </Button>
              </div>
              {approvalRequest?.requestedAt && (
                <p className="text-[9px] text-dimmed italic">
                  Solicitado em {formatDateTime(approvalRequest.requestedAt)}
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
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-3 content-start">
              {/* Pipeline Steps - topo */}
              <div className="col-span-3">
                <PipelineSteps
                  task={task}
                  isRunning={isRunning}
                  currentStatus={task.latestRun?.currentStatus ?? null}
                />
              </div>

              {/* Status Card */}
              <div className="bg-white/[0.03] rounded-lg p-3 col-span-1">
                <div className="text-[10px] text-dimmed mb-1">STATUS</div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant[task.status]} className="text-[10px]">
                    {statusLabel[task.status]}
                  </Badge>
                  {isRunning && <span className="text-[10px] text-info">{elapsed}</span>}
                </div>
              </div>

              {/* PR Card */}
              <div className="bg-white/[0.03] rounded-lg p-3 col-span-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-dimmed">PULL REQUEST</span>
                    {task.prUrl ? (
                      <a
                        href={task.prUrl}
                        target="_blank"
                        className="text-[10px] text-accent-text hover:underline"
                        rel="noopener"
                      >
                        {task.prUrl.split("/").pop()}
                      </a>
                    ) : task.status === "review" ? (
                      <span className="text-[9px] text-warning">Pendente</span>
                    ) : null}
                  </div>
                  {task.prUrl && (
                    <button
                      type="button"
                      onClick={handleCopyPR}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-surface hover:bg-surface-hover"
                    >
                      {prCopied ? "✓" : "Copy"}
                    </button>
                  )}
                </div>
                {task.status === "review" && !task.prUrl && (
                  <Button
                    variant="primary"
                    size="xs"
                    className="mt-2 text-[9px]"
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
                    {loadingAction === "retry-pr" ? "..." : "Criar PR"}
                  </Button>
                )}
              </div>

              {/* Repo Card */}
              {task.repo && (
                <div className="bg-white/[0.03] rounded-lg p-3 col-span-2">
                  <div className="flex items-center gap-2 mb-1">
                    {ProviderIcon && <ProviderIcon className={provider?.color} size={12} />}
                    <span className="text-xs font-medium">{task.repo.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-dimmed">
                    <span>
                      base: <code className="text-secondary">{task.repo.defaultBranch}</code>
                    </span>
                    {task.branchName && (
                      <span>
                        branch:{" "}
                        <code className="text-secondary truncate max-w-[150px]">
                          {task.branchName}
                        </code>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Engine Card */}
              {task.engine && (
                <div className="bg-white/[0.03] rounded-lg p-3 col-span-1">
                  <div className="text-[10px] text-dimmed mb-1">ENGINE</div>
                  <div className="text-[11px] font-medium">{task.engine}</div>
                </div>
              )}

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

              {/* Cost Card */}
              {task.latestRun?.costStats && (
                <div className="col-span-3 bg-gradient-to-r from-warning/10 to-orange-500/10 rounded-lg p-3 border border-warning/20">
                  <div className="text-[9px] text-warning mb-2 font-semibold">TELEMETRY</div>
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <div className="text-[8px] text-dimmed uppercase">Input</div>
                      <div className="text-[12px] font-mono text-warning">
                        ${((task.latestRun.costStats.input || 0) / 1_000_000).toFixed(3)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[8px] text-dimmed uppercase">Output</div>
                      <div className="text-[12px] font-mono text-cyan-400">
                        ${((task.latestRun.costStats.output || 0) / 1_000_000).toFixed(3)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[8px] text-dimmed uppercase">Total</div>
                      <div className="text-[12px] font-mono text-primary font-bold">
                        ${((task.latestRun.costStats.total || 0) / 1_000_000).toFixed(3)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[8px] text-dimmed uppercase">Tokens</div>
                      <div className="text-[12px] font-mono text-secondary">
                        {(task.latestRun.costStats.total_tokens || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
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
                  <TaskTagsEditor tags={task.tags ?? []} onChange={handleTagsChange} compact />
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
                      <span className="text-dimmed">Duração </span>
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
                        Configuração de Execução
                      </h3>
                      <span className="text-[10px] text-dimmed italic">
                        Altere o modelo antes de iniciar
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
                            {loadingModels ? "Carregando..." : "Padrão da engine"}
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
                      {loadingAction === "launch" ? "INITIALIZING..." : "▶ ENGAGE AGENT"}
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
                      {loadingAction === "retry" ? "REBOOTING..." : "↺ RE-RUN PROTOCOL"}
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
                      {loadingAction === "cancel" ? "ABORTING..." : "⏹ TERMINATE"}
                    </Button>
                  )}
                  {confirmDelete ? (
                    <div className="flex items-center gap-2 p-1 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <span className="text-[10px] font-black uppercase px-3 text-red-400">
                        Confirm Purge?
                      </span>
                      <Button
                        variant="danger"
                        onClick={() => onDelete(task.id)}
                        className="h-9 px-4 text-[10px] font-black uppercase bg-red-600 rounded-lg"
                      >
                        YES
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmDelete(false)}
                        className="h-9 px-4 text-[10px] font-black uppercase text-white rounded-lg"
                      >
                        NO
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmDelete(true)}
                      className="text-primary0 hover:text-red-400 font-black uppercase tracking-widest text-[10px]"
                    >
                      PURGE DATA
                    </Button>
                  )}
                </div>
              </div>

              {/* Parent task link */}
              {task.parentTaskId && (
                <div className="text-xs text-primary0">
                  ↳ Derivada do template{" "}
                  <code className="text-secondary bg-surface px-1 py-0.5 rounded font-mono">
                    {task.parentTaskId.slice(0, 8)}
                  </code>
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

          {/* ── Terminal Tab — Completely reimagined ── */}
          <div
            className="flex-1 min-h-0 flex"
            style={{ display: activeTab === "terminal" ? "flex" : "none" }}
          >
            {/* Left: Step Sidebar */}
            <div className="w-56 shrink-0 border-r border-white/5 flex flex-col bg-white/[0.02]">
              <div className="px-3 py-2 border-b border-white/5">
                <div className="text-[9px] font-semibold text-dimmed uppercase tracking-wider flex items-center justify-between">
                  <span>STEPS</span>
                  <span className="text-[8px] bg-surface px-1.5 py-0.5 rounded text-secondary">
                    {liveLogs.length}
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {liveLogs.length === 0 ? (
                  <div className="text-[10px] text-dimmed p-2 text-center">No steps yet</div>
                ) : (
                  liveLogs.slice(-20).map((log) => (
                    <button
                      key={log.id}
                      type="button"
                      className="w-full text-left px-2 py-1.5 rounded text-[10px] text-secondary hover:bg-white/5 hover:text-primary transition-colors"
                    >
                      <span className="truncate block">{log.content.slice(0, 40)}</span>
                    </button>
                  ))
                )}
              </div>
              {/* Running indicator */}
              {isRunning && (
                <div className="px-3 py-2 border-t border-white/5 bg-cyan-500/10">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-[10px] text-cyan-300 font-medium truncate">
                      {task.latestRun?.currentStatus || "Running"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Output Area */}
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Output Toolbar */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-medium text-primary">OUTPUT</span>
                  <span className="text-[9px] text-dimmed font-mono">{liveLogs.length} lines</span>
                </div>
                <div className="flex items-center gap-2">
                  {task.latestRun?.costStats && (
                    <span className="text-[10px] font-mono text-warning bg-warning/10 px-2 py-0.5 rounded">
                      ${((task.latestRun.costStats.input || 0) / 1_000_000).toFixed(2)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-[9px] px-2 py-0.5 rounded hover:bg-white/5 text-dimmed"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {/* Output Content */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed">
                {liveLogs.length === 0 ? (
                  <div className="text-dimmed opacity-50">Waiting for output...</div>
                ) : (
                  <div className="space-y-0.5">
                    {liveLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex gap-2 hover:bg-white/[0.02] py-0.5 -mx-2 px-2 rounded"
                      >
                        <span className="text-dimmed shrink-0 w-12 text-[9px]">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span
                          className={
                            log.stream === "stderr"
                              ? "text-red-400"
                              : log.stream === "system"
                                ? "text-cyan-400"
                                : "text-secondary"
                          }
                        >
                          {log.content}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Input Line */}
              <div className="px-3 py-2 border-t border-white/5 shrink-0">
                <div className="flex items-center gap-2 bg-white/[0.03] rounded px-3 py-1.5 border border-white/5">
                  <span className="text-[10px] text-dimmed">›</span>
                  <input
                    type="text"
                    placeholder="Send input..."
                    className="flex-1 bg-transparent text-[11px] text-primary placeholder-dimmed focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.currentTarget.value.trim()) {
                        onSendInput(task.id, e.currentTarget.value);
                        e.currentTarget.value = "";
                      }
                    }}
                    disabled={!isRunning}
                  />
                </div>
              </div>
            </div>
          </div>

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
          {activeTab === "cost" && task.latestRun?.costStats && (
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
                    {(task.latestRun.costStats.total_tokens || 0).toLocaleString()}
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
                    Op Cost
                  </div>
                  <div className="text-2xl font-black font-mono tracking-tight relative z-10 text-emerald-400">
                    ${((task.latestRun.costStats.input || 0) / 1000000).toFixed(6)}
                  </div>
                </div>

                {task.latestRun.costStats.duration_ms && (
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
                      {(task.latestRun.costStats.duration_ms / 1000).toFixed(1)}s
                    </div>
                  </div>
                )}

                {task.latestRun.costStats.tool_calls !== undefined && (
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
                      {task.latestRun.costStats.tool_calls}
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
                        ↓{(task.latestRun.costStats.input_tokens || 0).toLocaleString()}
                      </span>
                    </div>
                    {task.latestRun.costStats.cached && task.latestRun.costStats.cached > 0 && (
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <span className="text-dimmed">Cache Hit</span>
                        <span className="text-emerald-400 font-bold">
                          +{(task.latestRun.costStats.cached || 0).toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-dimmed">Output Stream</span>
                      <span className="text-purple-400 font-bold">
                        ↑{(task.latestRun.costStats.output_tokens || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {task.latestRun.costStats.models &&
                  Object.keys(task.latestRun.costStats.models).length > 0 && (
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
                        {Object.entries(task.latestRun.costStats.models).map(([model, stats]) => (
                          <div
                            key={model}
                            className="flex items-center justify-between p-2.5 rounded-lg border border-white/5"
                            style={{ background: "rgba(255,255,255,0.02)" }}
                          >
                            <span
                              className="text-[10px] font-mono truncate mr-4"
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
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}

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
