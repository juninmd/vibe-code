import type {
  AgentLog,
  EngineInfo,
  TaskArtifact,
  TaskSchedule,
  TaskWithRun,
  UpdateTaskRequest,
} from "@vibe-code/shared";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatDateTime, formatDuration } from "../utils/date";
import { AgentOutput } from "./AgentOutput";
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
  const provider = task.repo ? getProviderFromUrl(task.repo.url) : null;
  const ProviderIcon = provider?.icon;
  const duration = formatDuration(
    task.latestRun?.startedAt ?? null,
    task.latestRun?.finishedAt ?? null
  );

  type ActiveTab = "info" | "terminal" | "diff" | "artifacts" | "skills" | "cost";
  const [activeTab, setActiveTab] = useState<ActiveTab>(isRunning ? "terminal" : "info");

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
      <div className="relative glass-dialog w-full max-w-3xl max-h-[92vh] flex flex-col rounded-xl border shadow-2xl shadow-black/50">
        {/* ── Modal Header ────────────────────────────────── */}
        <div className="shrink-0 px-5 pt-4 pb-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              {ProviderIcon && (
                <div className={`mt-1 shrink-0 ${provider?.color}`}>
                  <ProviderIcon size={18} />
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight text-primary">{task.title}</h2>
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
              <Badge variant="default" className="flex items-center gap-1 opacity-90 border-blue-500/30 bg-blue-500/10 text-blue-400">
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
          <div className="flex gap-0 mt-3 border-b border-default">
            {(
              [
                { id: "info" as const, label: "Info" },
                { id: "terminal" as const, label: "Terminal" },
                { id: "diff" as const, label: "Diff" },
                { id: "artifacts" as const, label: "Artifacts" },
                { id: "cost" as const, label: "Custo" },
              ] satisfies { id: ActiveTab; label: string }[]
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className="px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5"
                style={{
                  borderColor: activeTab === id ? "var(--accent, #7c3aed)" : "transparent",
                  color: activeTab === id ? "var(--accent-light, #c4b5fd)" : "var(--text-muted)",
                }}
              >
                {label}
                {id === "terminal" && isRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                )}
                {id === "diff" && task.branchName && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--text-dimmed)" }}
                  />
                )}
                {id === "artifacts" && artifacts.length > 0 && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{
                      background:
                        activeTab === "artifacts" ? "var(--accent-muted)" : "var(--bg-input)",
                      color: activeTab === "artifacts" ? "var(--accent-text)" : "var(--text-muted)",
                    }}
                  >
                    {artifacts.length}
                  </span>
                )}
              </button>
            ))}
            {matchedSkills.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("skills")}
                className="px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5"
                style={{
                  borderColor: activeTab === "skills" ? "var(--accent, #7c3aed)" : "transparent",
                  color:
                    activeTab === "skills" ? "var(--accent-light, #c4b5fd)" : "var(--text-muted)",
                }}
              >
                Skills
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{
                    background: activeTab === "skills" ? "var(--accent-muted)" : "var(--bg-input)",
                    color: activeTab === "skills" ? "var(--accent-text)" : "var(--text-muted)",
                  }}
                >
                  {matchedSkills.length}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* ── Tab Content ─────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
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

          {/* Goal Ancestry (Parent Task) */}
          {parentTask && (
            <div className="bg-surface/20 border border-strong rounded-lg p-3 space-y-2">
              <h3 className="text-[10px] font-semibold text-primary0 uppercase tracking-wider">
                Parent Task (Ancestry)
              </h3>
              <div className="flex items-start gap-2">
                <span className="text-info text-xs mt-0.5">↳</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-secondary truncate">{parentTask.title}</p>
                  <p className="text-[11px] text-dimmed line-clamp-1">{parentTask.description}</p>
                </div>
              </div>
            </div>
          )}

          {/* Sub-tasks (Delegation) */}
          {subTasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-semibold text-primary0 uppercase tracking-wider">
                Sub-tasks (Delegated Work)
              </h3>
              <div className="grid gap-2">
                {subTasks.map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between gap-3 bg-surface/10 border border-strong rounded-lg p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={statusVariant[st.status] ?? "default"}
                          className="text-[9px] px-1 py-0 h-auto"
                        >
                          {statusLabel[st.status] ?? st.status}
                        </Badge>
                        <span className="text-xs font-medium text-secondary truncate">
                          {st.title}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-dimmed font-mono shrink-0">
                      {st.id.slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Info Tab ──────────────────────────────────── */}
          {activeTab === "info" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* PR Creation Pipeline */}
              <PipelineSteps
                task={task}
                isRunning={isRunning}
                currentStatus={task.latestRun?.currentStatus ?? null}
              />

              {/* PR Link */}
              {task.prUrl && (
                <div className="bg-accent-muted border border-accent/30 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="text-xs font-semibold text-accent-text flex items-center gap-1.5">
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        width="12"
                        height="12"
                        fill="currentColor"
                      >
                        <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
                      </svg>
                      Pull Request
                    </h3>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={handleCopyPR}
                        className="text-[10px] px-2 py-0.5 rounded bg-surface hover:bg-surface-hover text-secondary hover:text-primary cursor-pointer transition-colors"
                      >
                        {prCopied ? "✓ copiado" : "copiar"}
                      </button>
                      <a
                        href={task.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-2 py-0.5 rounded bg-accent-muted hover:bg-accent-muted text-accent-text hover:text-accent-text cursor-pointer transition-colors border border-accent/30"
                      >
                        abrir ↗
                      </a>
                    </div>
                  </div>
                  <code className="text-[11px] text-accent-text/80 font-mono break-all">
                    {task.prUrl}
                  </code>
                </div>
              )}

              {/* Retry PR button */}
              {task.status === "review" && !task.prUrl && (
                <div className="bg-warning/15 border border-warning/30 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-warning font-medium">PR não criado ainda</p>
                    <p className="text-[11px] text-primary0 mt-0.5">
                      O código foi commitado mas o PR failed
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={!!loadingAction}
                    onClick={async () => {
                      setLoadingAction("retry-pr");
                      try {
                        await onRetryPR(task.id);
                      } finally {
                        setLoadingAction(null);
                      }
                    }}
                    className="text-xs"
                  >
                    {loadingAction === "retry-pr" ? "Criando..." : "↑ Criar PR"}
                  </Button>
                </div>
              )}

              {/* Repo + Branch info */}
              {task.repo && (
                <div className="bg-surface-hover rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {ProviderIcon && <ProviderIcon className={provider?.color} size={13} />}
                    <a
                      href={task.repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-secondary hover:text-white transition-colors"
                    >
                      {task.repo.name}
                    </a>
                    <span className="text-dimmed text-xs">·</span>
                    <span className="text-xs text-primary0">{provider?.name ?? "Repository"}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-primary0 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-dimmed">base:</span>
                      <code className="text-secondary bg-surface px-1 rounded text-[11px]">
                        {task.repo.defaultBranch}
                      </code>
                    </div>
                    {task.branchName && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-dimmed">branch:</span>
                        <code className="text-secondary bg-surface px-1 rounded text-[11px] max-w-[240px] truncate">
                          {task.branchName}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Goal Alignment */}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <h3 className="text-xs font-medium text-primary0 mb-1.5">Goal</h3>
                  <textarea
                    value={goalValue}
                    onChange={(e) => setGoalValue(e.target.value)}
                    onBlur={handleAlignmentBlur}
                    placeholder="Por que esta tarefa existe?"
                    rows={3}
                    className="w-full bg-surface-hover border border-strong rounded-md px-2.5 py-2 text-xs text-secondary placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                  />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-primary0 mb-1.5">Desired outcome</h3>
                  <textarea
                    value={outcomeValue}
                    onChange={(e) => setOutcomeValue(e.target.value)}
                    onBlur={handleAlignmentBlur}
                    placeholder="Qual resultado concreto encerra o trabalho?"
                    rows={3}
                    className="w-full bg-surface-hover border border-strong rounded-md px-2.5 py-2 text-xs text-secondary placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                  />
                </div>
              </div>

              {/* Description */}
              {task.description && (
                <div>
                  <h3 className="text-xs font-medium text-primary0 mb-1.5">Descrição</h3>
                  <p className="text-sm text-secondary whitespace-pre-wrap leading-relaxed">
                    {task.description}
                  </p>
                </div>
              )}

              {/* Tags */}
              <div>
                <h3 className="text-xs font-medium text-primary0 mb-1.5">Tags</h3>
                <TaskTagsEditor tags={task.tags ?? []} onChange={handleTagsChange} />
              </div>

              {/* Notes */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-xs font-medium text-primary0">Notas internas</h3>
                  {notesSaved && <span className="text-[10px] text-success">✓ salvo</span>}
                </div>
                <textarea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  onBlur={handleNotesBlur}
                  placeholder="Anotações pessoais (não enviadas ao agente)…"
                  rows={3}
                  className="w-full bg-surface-hover border border-strong rounded-md px-2.5 py-2 text-xs text-secondary placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                />
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

                <div className="flex gap-2 flex-wrap items-center">
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
                    >
                      {loadingAction === "launch" ? "Iniciando..." : "▶ Iniciar Agent"}
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
                    >
                      {loadingAction === "retry" ? "Reiniciando..." : "↺ Tentar novamente"}
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
                    >
                      {loadingAction === "cancel" ? "Cancelando..." : "⏹ Cancelar"}
                    </Button>
                  )}
                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-secondary">Tem certeza?</span>
                      <Button variant="danger" onClick={() => onDelete(task.id)}>
                        Confirmar
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                        Não
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmDelete(true)}
                      className="text-primary0 hover:text-danger"
                    >
                      Deletar
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

          {/* ── Terminal Tab — kept mounted to avoid refetch on tab switch ── */}
          <div
            className="flex-1 min-h-0 flex flex-col p-4"
            style={{ display: activeTab === "terminal" ? "flex" : "none" }}
          >
            <AgentOutput
              runId={task.latestRun?.id ?? null}
              liveLogs={liveLogs}
              isRunning={isRunning}
              fullHeight
              onSendInput={(input) => onSendInput(task.id, input)}
              currentStatus={task.latestRun?.currentStatus}
              costStats={task.latestRun?.costStats}
            />
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

          {/* ── Cost Tab ───────────────────────────────────── */}
          {activeTab === "cost" && task.latestRun?.costStats && (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    Custo do Provider
                  </h2>
                  {task.maxCost !== undefined && (
                    <span
                      className="text-[10px] px-2 py-1 rounded"
                      style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}
                    >
                      Budget: ${task.maxCost.toFixed(2)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div
                    className="rounded-lg p-4 border"
                    style={{ background: "var(--bg-card)", borderColor: "var(--glass-border)" }}
                  >
                    <div
                      className="text-[10px] uppercase tracking-wider mb-1"
                      style={{ color: "var(--text-dimmed)" }}
                    >
                      Total Tokens
                    </div>
                    <div
                      className="text-xl font-semibold tabular-nums"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {(task.latestRun.costStats.total_tokens || 0).toLocaleString()}
                    </div>
                  </div>

                  <div
                    className="rounded-lg p-4 border"
                    style={{ background: "var(--bg-card)", borderColor: "var(--glass-border)" }}
                  >
                    <div
                      className="text-[10px] uppercase tracking-wider mb-1"
                      style={{ color: "var(--text-dimmed)" }}
                    >
                      Custo Total
                    </div>
                    <div
                      className="text-xl font-semibold tabular-nums"
                      style={{ color: "var(--accent)" }}
                    >
                      ${((task.latestRun.costStats.input || 0) / 1000000).toFixed(6)}
                    </div>
                  </div>

                  {task.latestRun.costStats.duration_ms && (
                    <div
                      className="rounded-lg p-4 border"
                      style={{ background: "var(--bg-card)", borderColor: "var(--glass-border)" }}
                    >
                      <div
                        className="text-[10px] uppercase tracking-wider mb-1"
                        style={{ color: "var(--text-dimmed)" }}
                      >
                        Latência
                      </div>
                      <div
                        className="text-xl font-semibold tabular-nums"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {(task.latestRun.costStats.duration_ms / 1000).toFixed(1)}s
                      </div>
                    </div>
                  )}

                  {task.latestRun.costStats.tool_calls !== undefined && (
                    <div
                      className="rounded-lg p-4 border"
                      style={{ background: "var(--bg-card)", borderColor: "var(--glass-border)" }}
                    >
                      <div
                        className="text-[10px] uppercase tracking-wider mb-1"
                        style={{ color: "var(--text-dimmed)" }}
                      >
                        Tool Calls
                      </div>
                      <div
                        className="text-xl font-semibold tabular-nums"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {task.latestRun.costStats.tool_calls}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="rounded-lg p-4 border"
                  style={{ background: "var(--bg-card)", borderColor: "var(--glass-border)" }}
                >
                  <h3
                    className="text-xs font-semibold mb-3"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Tokens
                  </h3>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div>
                      <span className="text-dimmed">Input: </span>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: "var(--text-primary)" }}
                      >
                        ↓{(task.latestRun.costStats.input_tokens || 0).toLocaleString()}
                      </span>
                    </div>
                    {task.latestRun.costStats.cached && task.latestRun.costStats.cached > 0 && (
                      <div>
                        <span className="text-dimmed">Cached: </span>
                        <span
                          className="font-medium tabular-nums"
                          style={{ color: "var(--text-primary)" }}
                        >
                          +{task.latestRun.costStats.cached.toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-dimmed">Output: </span>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: "var(--text-primary)" }}
                      >
                        ↑{(task.latestRun.costStats.output_tokens || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {task.latestRun.costStats.models &&
                  Object.keys(task.latestRun.costStats.models).length > 0 && (
                    <div
                      className="rounded-lg p-4 border"
                      style={{ background: "var(--bg-card)", borderColor: "var(--glass-border)" }}
                    >
                      <h3
                        className="text-xs font-semibold mb-3"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        Modelos
                      </h3>
                      <div className="space-y-3">
                        {Object.entries(task.latestRun.costStats.models).map(([model, stats]) => (
                          <div
                            key={model}
                            className="flex items-center justify-between p-3 rounded-lg"
                            style={{ background: "var(--bg-input)" }}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                                style={{ background: "var(--accent-muted)" }}
                              >
                                🤖
                              </div>
                              <span
                                className="text-xs font-mono"
                                style={{ color: "var(--text-primary)" }}
                              >
                                {model}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs">
                              <div className="text-right">
                                <div className="text-dimmed">tokens</div>
                                <div
                                  className="font-medium tabular-nums"
                                  style={{ color: "var(--text-primary)" }}
                                >
                                  {stats.total_tokens.toLocaleString()}
                                </div>
                              </div>
                              {stats.input !== undefined && (
                                <div className="text-right">
                                  <div className="text-dimmed">custo</div>
                                  <div
                                    className="font-medium tabular-nums"
                                    style={{ color: "var(--accent)" }}
                                  >
                                    ${(stats.input / 1000000).toFixed(6)}
                                  </div>
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
        </div>
      </div>
    </div>
  );
}
