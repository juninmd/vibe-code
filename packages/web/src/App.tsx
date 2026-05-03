import type {
  AgentLog,
  AuthStatus,
  TaskStatus,
  TaskWithRun,
  WsServerMessage,
} from "@vibe-code/shared";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api/client";
import { AddRepoDialog } from "./components/AddRepoDialog";
import { Board } from "./components/Board";
import { ChangelogModal } from "./components/ChangelogModal";
import { CommandPalette } from "./components/CommandPalette";
import { EnginesPanel } from "./components/EnginesPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FilterBar, type Filters } from "./components/FilterBar";
import { InboxPanel } from "./components/InboxPanel";
import { IssueImporter } from "./components/IssueImporter";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { RepoQuickView } from "./components/RepoQuickView";
import { RuntimeDashboard } from "./components/RuntimeDashboard";
import { ScheduledTasksPanel } from "./components/ScheduledTasksPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { Sidebar } from "./components/Sidebar";
import { SkeletonBoard } from "./components/Skeleton";
import { SkillsBrowser } from "./components/SkillsBrowser";
import { StatsDialog } from "./components/StatsDialog";
import { TaskDetail } from "./components/TaskDetail";
import { TemplatesPanel } from "./components/TemplatesPanel";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/Toaster";
import { useBrowserNotifications } from "./hooks/useBrowserNotifications";
import { useEngines } from "./hooks/useEngines";
import { useRepos } from "./hooks/useRepos";
import { useRetryQueue } from "./hooks/useRetryQueue";
import { useTasks } from "./hooks/useTasks";
import { ToastContext, useToastState } from "./hooks/useToast";
import { useWebSocket } from "./hooks/useWebSocket";

const MAX_LIVE_LOGS_PER_TASK = 1500;

function appendLogsLimited(existing: AgentLog[], incoming: AgentLog[]): AgentLog[] {
  // Deduplicate by content+timestamp to prevent repeated messages on reconnect or dual-emit
  const seen = new Set<string>();
  for (const log of existing) seen.add(`${log.timestamp}|${log.stream}|${log.content}`);
  const unique = incoming.filter((l) => {
    const key = `${l.timestamp}|${l.stream}|${l.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return existing;
  const merged = [...existing, ...unique];
  if (merged.length <= MAX_LIVE_LOGS_PER_TASK) return merged;
  return merged.slice(merged.length - MAX_LIVE_LOGS_PER_TASK);
}

function LoginScreen({
  status,
  loading,
  error,
  onRetry,
}: {
  status: AuthStatus | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="min-h-screen bg-app text-primary flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-default bg-surface p-6 shadow-xl">
        <h1 className="text-lg font-semibold">Vibe Code</h1>
        <p className="mt-2 text-sm text-secondary">
          Entre com GitHub para acessar o painel e autorizar operações em repositórios.
        </p>
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        <div className="mt-5 flex gap-2">
          <Button
            type="button"
            variant="primary"
            className="flex-1"
            disabled={loading || status?.enabled === false}
            onClick={() => {
              window.location.href = api.auth.loginUrl();
            }}
          >
            {loading ? "Verificando..." : "Entrar com GitHub"}
          </Button>
          {error && (
            <Button type="button" variant="ghost" onClick={onRetry}>
              Tentar
            </Button>
          )}
        </div>
        {status?.enabled === false && (
          <p className="mt-3 text-xs text-warning">OAuth ainda não está configurado no servidor.</p>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadAuth = useCallback(() => {
    setAuthLoading(true);
    setAuthError(null);
    api.auth
      .me()
      .then(setAuth)
      .catch((err) => setAuthError(err instanceof Error ? err.message : String(err)))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  if (authLoading || !auth?.authenticated) {
    return <LoginScreen status={auth} loading={authLoading} error={authError} onRetry={loadAuth} />;
  }

  return <AuthenticatedApp auth={auth} onLogout={loadAuth} />;
}

function HeaderAction({
  icon,
  label,
  onClick,
  variant = "ghost",
  active = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: "primary" | "ghost";
  active?: boolean;
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active-shrink cursor-pointer ${
        isPrimary
          ? "bg-accent text-white shadow-lg shadow-accent/25 hover:bg-accent-hover"
          : active
            ? "bg-accent/20 text-accent border border-accent/30"
            : "text-secondary hover:text-primary hover:bg-white/5 border border-transparent"
      }`}
    >
      {icon === "plus" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <title>Add</title>
          <path d="M8 3v10M3 8h10" />
        </svg>
      )}
      {icon === "import" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <title>Import</title>
          <path d="M8 12V3m0 9l-4-4m4 4l4-4M3 14h10" />
        </svg>
      )}
      {icon === "filter" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <title>Filter</title>
          <path d="M2 3h12l-5 6v4l-2 2V9L2 3Z" />
        </svg>
      )}
      {icon === "download" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <title>Export</title>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
      )}
      {icon === "history" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <title>History</title>
          <path d="M12 8v4l3 3M12 22A10 10 0 1 0 12 2a10 10 0 0 0 0 20z" />
        </svg>
      )}
      {icon === "help" && <span className="font-black">?</span>}
      <span>{label}</span>
    </button>
  );
}

function AuthenticatedApp({ auth, onLogout }: { auth: AuthStatus; onLogout: () => void }) {
  const toastCtx = useToastState();
  const { toast } = toastCtx;

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedAgent, _setSelectedAgent] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskWithRun | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showEnginesPanel, setShowEnginesPanel] = useState(false);
  const [showSchedulesPanel, setShowSchedulesPanel] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showFilterBar, _setShowFilterBar] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showRuntimes, setShowRuntimes] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [showQuickView, setShowQuickView] = useState(false);
  const [showIssueImporter, setShowIssueImporter] = useState(false);
  const [initialSkillName, setInitialSkillName] = useState<string | null>(null);
  const [selectedTaskLoadedSkills, setSelectedTaskLoadedSkills] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({
    engine: null,
    priority: null,
    hasPR: false,
    tags: [],
    labelIds: [],
  });
  const [liveLogs, setLiveLogs] = useState<Record<string, AgentLog[]>>({});
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const focusedLogCursorRef = useRef(0);
  const refreshEnginesThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTaskRef = useRef(selectedTask);
  selectedTaskRef.current = selectedTask;
  const _searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    repos,
    loading: reposLoading,
    addRepo,
    removeRepo,
    deleteLocalClone,
    purgeLocalClones,
    addOrUpdateRepo,
  } = useRepos();
  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    createTask,
    cloneTask,
    updateTask,
    removeTask,
    archiveDone,
    clearFailed,
    retryAllFailed,
    launchTask,
    cancelTask,
    retryTask,
    retryPR,
    approveTask,
    rejectTask,
    updateTaskLocal,
    updateRunLocal,
    setTasksSnapshot,
    refresh,
  } = useTasks(selectedRepoId ?? undefined);
  const deferredTasks = useDeferredValue(tasks);
  const deferredSearch = useDeferredValue(search);

  const hasFailedTasks = tasks.some((t) => t.status === "failed");
  const retryQueueMap = useRetryQueue(hasFailedTasks);

  const {
    engines,
    loading: enginesLoading,
    error: enginesError,
    availableCount: _availableCount,
    totalActiveRuns: _totalActiveRuns,
    refresh: _refreshEngines,
  } = useEngines(15_000);
  const { notify } = useBrowserNotifications();

  // Track previous task statuses for notifications
  const prevStatusRef = useRef<Record<string, string>>({});

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  const wasConnected = useRef(false);

  const refreshEnginesThrottled = useCallback(() => {
    if (refreshEnginesThrottleRef.current) return;
    refreshEnginesThrottleRef.current = setTimeout(() => {
      refreshEnginesThrottleRef.current = null;
      _refreshEngines();
    }, 1500);
  }, [_refreshEngines]);

  useEffect(() => {
    return () => {
      if (refreshEnginesThrottleRef.current) {
        clearTimeout(refreshEnginesThrottleRef.current);
      }
    };
  }, []);

  const handleWsMessage = useCallback(
    (msg: WsServerMessage) => {
      // Use ref to avoid re-creating this callback when selectedTask changes
      const sel = selectedTaskRef.current;
      switch (msg.type) {
        case "task_updated": {
          const updated = msg.task as TaskWithRun;
          const prev = prevStatusRef.current[updated.id];
          if (prev && prev !== updated.status) {
            if (updated.status === "done")
              notify(`✓ Task concluída: ${updated.title}`, "Agente executou com sucesso");
            else if (updated.status === "failed")
              notify(`✕ Task failed: ${updated.title}`, "Execução do agente failed");
            else if (updated.status === "review")
              notify(`◎ PR pronto: ${updated.title}`, "Agente abriu um pull request");
          }
          prevStatusRef.current[updated.id] = updated.status;
          startTransition(() => {
            updateTaskLocal(updated);
            setSelectedTask((s) =>
              s?.id === updated.id ? ({ ...s, ...updated } as TaskWithRun) : s
            );
          });
          break;
        }
        case "repo_updated":
          addOrUpdateRepo(msg.repo);
          break;
        case "agent_log":
          if (sel?.id === msg.taskId) {
            startTransition(() => {
              setLiveLogs((prev) => ({
                ...prev,
                [msg.taskId]: appendLogsLimited(prev[msg.taskId] ?? [], [
                  {
                    id: Date.now(),
                    runId: msg.runId,
                    stream: msg.stream,
                    content: msg.content,
                    timestamp: msg.timestamp,
                  },
                ]),
              }));
            });
          }
          break;
        case "agent_logs_batch":
          if (sel?.id === msg.taskId) {
            startTransition(() => {
              setLiveLogs((prev) => ({
                ...prev,
                [msg.taskId]: appendLogsLimited(
                  prev[msg.taskId] ?? [],
                  msg.logs.map((l, i) => ({
                    id: Date.now() + i,
                    runId: l.runId,
                    stream: l.stream,
                    content: l.content,
                    timestamp: l.timestamp,
                  }))
                ),
              }));
            });
          }
          break;
        case "run_updated":
          startTransition(() => {
            updateRunLocal(msg.run.taskId, msg.run);
            setSelectedTask((s) =>
              s?.id === msg.run.taskId ? ({ ...s, latestRun: msg.run } as TaskWithRun) : s
            );
          });
          refreshEnginesThrottled();
          break;
        case "run_status": {
          const run = sel?.latestRun;
          startTransition(() => {
            updateRunLocal(msg.taskId, {
              id: msg.runId,
              taskId: msg.taskId,
              engine: run?.engine ?? "unknown",
              status: msg.status,
              currentStatus: run?.currentStatus ?? null,
              worktreePath: run?.worktreePath ?? null,
              startedAt: run?.startedAt ?? null,
              finishedAt: run?.finishedAt ?? null,
              exitCode: run?.exitCode ?? null,
              errorMessage: run?.errorMessage ?? null,
              createdAt: run?.createdAt ?? new Date().toISOString(),
            });
          });
          refreshEnginesThrottled();
          break;
        }
        case "agent_tool_use":
          if (sel?.id === msg.taskId) {
            startTransition(() => {
              setLiveLogs((prev) => ({
                ...prev,
                [msg.taskId]: appendLogsLimited(prev[msg.taskId] ?? [], [
                  {
                    id: Date.now(),
                    runId: msg.runId,
                    stream: "stdout",
                    content: `${msg.toolName}`,
                    timestamp: msg.timestamp,
                  },
                ]),
              }));
            });
          }
          break;
        case "agent_tool_result":
          if (sel?.id === msg.taskId) {
            startTransition(() => {
              setLiveLogs((prev) => ({
                ...prev,
                [msg.taskId]: appendLogsLimited(prev[msg.taskId] ?? [], [
                  {
                    id: Date.now(),
                    runId: msg.runId,
                    stream: "stdout",
                    content: `${msg.status} ${msg.output.length > 80 ? `${msg.output.slice(0, 80)}…` : msg.output}`,
                    timestamp: msg.timestamp,
                  },
                ]),
              }));
            });
          }
          break;
      }
    },
    [addOrUpdateRepo, notify, refreshEnginesThrottled, updateRunLocal, updateTaskLocal]
  );

  const { connected, send, subscribe, unsubscribe } = useWebSocket(handleWsMessage);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId) ?? null,
    [repos, selectedRepoId]
  );

  // Backend-driven polling: refresh all statuses every minute.
  useEffect(() => {
    if (connected) return; // when WS is available rely on push

    const pollBackground = async () => {
      try {
        const data = await api.tasks.poll(selectedRepoId ?? undefined);
        startTransition(() => {
          setTasksSnapshot(data.tasks);
          if (selectedTask?.id) {
            const refreshedSelected = data.tasks.find((task) => task.id === selectedTask.id);
            if (refreshedSelected) setSelectedTask(refreshedSelected);
          }
        });
      } catch {
        // best effort: websocket/local state still updates the UI
      }
    };

    pollBackground();
    const id = setInterval(pollBackground, 60_000);
    return () => clearInterval(id);
  }, [selectedRepoId, selectedTask?.id, setTasksSnapshot, connected]);

  // Focused task polling: fast updates for run status + incremental logs.
  useEffect(() => {
    if (!selectedTask?.id) {
      focusedLogCursorRef.current = 0;
      return;
    }
    if (connected) {
      // WS will push focused logs when subscribed
      focusedLogCursorRef.current = 0;
      return;
    }

    const pollFocused = async () => {
      try {
        const data = await api.tasks.poll(
          selectedRepoId ?? undefined,
          selectedTask.id,
          focusedLogCursorRef.current
        );

        startTransition(() => {
          setTasksSnapshot(data.tasks);
          if (data.focusedTask) {
            setSelectedTask(data.focusedTask);
          }
          if (data.focusedLogs.length > 0) {
            const newestId = data.focusedLogs[data.focusedLogs.length - 1]?.id ?? 0;
            focusedLogCursorRef.current = Math.max(focusedLogCursorRef.current, newestId);
            setLiveLogs((prev) => ({
              ...prev,
              [selectedTask.id]: appendLogsLimited(prev[selectedTask.id] ?? [], data.focusedLogs),
            }));
          }
        });
      } catch {
        // best effort: websocket/local state still updates the UI
      }
    };

    focusedLogCursorRef.current = 0;
    pollFocused();
    const id = setInterval(pollFocused, 3_000);
    return () => clearInterval(id);
  }, [selectedRepoId, selectedTask?.id, setTasksSnapshot, connected]);

  // Show toast on disconnect / reconnect
  useEffect(() => {
    let canceled = false;
    let mounted = true;

    if (!connected && wasConnected.current) {
      toast("Conexão perdida. Reconectando...", "error");
    }
    if (connected && wasConnected.current === false && wasConnected.current !== undefined) {
      toast("Reconectado!", "success");
      (async () => {
        try {
          await refresh();
          if (canceled || !mounted) return;
          if (selectedTask?.id) {
            const data = await api.tasks.poll(selectedRepoId ?? undefined, selectedTask.id, 0);
            if (canceled || !mounted) return;
            startTransition(() => {
              setTasksSnapshot(data.tasks);
              if (data.focusedTask) setSelectedTask(data.focusedTask);
              const newestId = data.focusedLogs[data.focusedLogs.length - 1]?.id ?? 0;
              focusedLogCursorRef.current = Math.max(focusedLogCursorRef.current, newestId);
              setLiveLogs((prev) => ({
                ...prev,
                [selectedTask.id]:
                  data.focusedLogs.length > 0
                    ? data.focusedLogs.slice(-MAX_LIVE_LOGS_PER_TASK)
                    : (prev[selectedTask.id] ?? []),
              }));
            });
          }
        } catch {
          // ignore
        }
      })();
    }
    wasConnected.current = connected;
    return () => {
      canceled = true;
      mounted = false;
    };
  }, [connected, toast, refresh, selectedRepoId, selectedTask, setTasksSnapshot]);

  // ─── Task interactions ───────────────────────────────────────────────────────
  const handleTaskClick = useCallback(
    (task: TaskWithRun) => {
      if (selectedTask?.id) unsubscribe(selectedTask.id);
      setSelectedTask(task);
      subscribe(task.id);
    },
    [selectedTask, subscribe, unsubscribe]
  );

  const handleCloseDetail = useCallback(() => {
    if (selectedTask) unsubscribe(selectedTask.id);
    setSelectedTask(null);
  }, [selectedTask, unsubscribe]);

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      const taskToDelete = tasks.find((t) => t.id === taskId);
      try {
        await removeTask(taskId);
        if (selectedTask?.id === taskId) handleCloseDetail();
        toast(
          "Task deletada",
          "info",
          taskToDelete
            ? {
                label: "Desfazer",
                onClick: async () => {
                  const _restored = await createTask({
                    title: taskToDelete.title,
                    description: taskToDelete.description,
                    repoId: taskToDelete.repoId,
                    engine: taskToDelete.engine ?? undefined,
                    tags: taskToDelete.tags,
                  });
                  toast("Task restaurada", "success");
                },
              }
            : undefined
        );
      } catch {
        toast("Falha ao deletar task", "error");
      }
    },
    [tasks, selectedTask, removeTask, handleCloseDetail, createTask, toast]
  );

  const handleOpenTaskById = useCallback(
    async (taskId: string) => {
      try {
        const task = await api.tasks.get(taskId);
        if (selectedTask?.id) unsubscribe(selectedTask.id);
        setSelectedRepoId(task.repoId);
        setSelectedTask(task);
        subscribe(task.id);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [selectedTask?.id, subscribe, toast, unsubscribe]
  );

  const handleSkillClick = useCallback((skillName: string) => {
    setInitialSkillName(skillName);
    setShowSkills(true);
  }, []);

  useEffect(() => {
    if (!showSkills || !selectedTask?.latestRun) {
      setSelectedTaskLoadedSkills([]);
      return;
    }

    let cancelled = false;
    api.tasks
      .matchedSkills(selectedTask.id)
      .then((skills) => {
        if (!cancelled) setSelectedTaskLoadedSkills(skills);
      })
      .catch(() => {
        if (!cancelled) setSelectedTaskLoadedSkills([]);
      });

    return () => {
      cancelled = true;
    };
  }, [showSkills, selectedTask?.id, selectedTask?.latestRun?.id, selectedTask?.latestRun]);

  const handleTaskMove = useCallback(
    async (taskId: string, newStatus: TaskStatus, newOrder: number) => {
      if (newStatus === "in_progress") {
        await launchTask(taskId);
      } else {
        await updateTask(taskId, { status: newStatus, columnOrder: newOrder });
      }
    },
    [launchTask, updateTask]
  );

  // ─── Filtered tasks ──────────────────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    let result = deferredTasks.filter((t) => t.status !== "archived");

    if (selectedAgent) {
      result = result.filter((t) => t.engine === selectedAgent);
    }

    if (filters.engine) {
      result = result.filter((t) => t.engine === filters.engine);
    }
    if (filters.priority !== null) {
      result = result.filter((t) => t.priority === filters.priority);
    }
    if (filters.hasPR) {
      result = result.filter((t) => !!t.prUrl);
    }
    if (filters.tags.length > 0) {
      result = result.filter((t) => filters.tags.every((tag) => t.tags?.includes(tag)));
    }

    if (!deferredSearch.trim()) return result;

    const q = deferredSearch.toLowerCase();
    return result.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.repo?.name.toLowerCase().includes(q) ||
        t.branchName?.toLowerCase().includes(q)
    );
  }, [deferredTasks, deferredSearch, selectedAgent, filters]);

  // ─── Repo stats ──────────────────────────────────────────────────────────────
  const repoStats = useMemo(() => {
    const stats: Record<string, { total: number; done: number; failed: number; running: number }> =
      {};
    for (const task of tasks) {
      if (!stats[task.repoId]) stats[task.repoId] = { total: 0, done: 0, failed: 0, running: 0 };
      stats[task.repoId].total++;
      if (task.status === "done") stats[task.repoId].done++;
      if (task.status === "failed") stats[task.repoId].failed++;
      if (task.status === "in_progress") stats[task.repoId].running++;
    }
    return stats;
  }, [tasks]);

  // ─── Available tags from tasks ───────────────────────────────────────────────
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const task of tasks) {
      for (const tag of task.tags ?? []) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }, [tasks]);

  // ─── Export board ────────────────────────────────────────────────────────────
  const exportBoard = useCallback(() => {
    const data = {
      exportedAt: new Date().toISOString(),
      repo: repos.find((r) => r.id === selectedRepoId) ?? null,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        engine: t.engine,
        model: t.model,
        tags: t.tags,
        branchName: t.branchName,
        prUrl: t.prUrl,
        priority: t.priority,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vibe-code-board-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [tasks, repos, selectedRepoId]);

  // ─── Import issues ────────────────────────────────────────────────────────────
  const handleImportIssues = useCallback(
    async (issues: import("@vibe-code/shared").RepositoryIssue[]) => {
      if (!selectedRepoId) return;
      const result = await api.tasks.importFromIssues(
        selectedRepoId,
        issues.map((i) => ({
          id: i.id,
          number: i.number,
          title: i.title,
          body: i.body,
          labels: i.labels,
          url: i.url,
        }))
      );
      await refresh();
      toast(
        `${result.count} task${result.count !== 1 ? "s" : ""} criada${result.count !== 1 ? "s" : ""} a partir de issues.`,
        "success"
      );
    },
    [selectedRepoId, refresh, toast]
  );

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isTyping =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active as HTMLElement)?.isContentEditable;

      // Cmd/Ctrl+K — command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
        return;
      }

      // Cmd/Ctrl+S — export board
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        exportBoard();
        return;
      }

      // Delete — delete selected task
      if (e.key === "Delete" && selectedTask) {
        const active = document.activeElement;
        const isTypingInDetail =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active as HTMLElement | null)?.isContentEditable === true;
        if (isTypingInDetail) return;
        e.preventDefault();
        handleDeleteTask(selectedTask.id);
        return;
      }

      // Escape — close open panels/dialogs (in cascading order)
      if (e.key === "Escape") {
        if (showCommandPalette) {
          setShowCommandPalette(false);
          return;
        }
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (showChangelog) {
          setShowChangelog(false);
          return;
        }
        if (showEnginesPanel) {
          setShowEnginesPanel(false);
          return;
        }
        if (showSchedulesPanel) {
          setShowSchedulesPanel(false);
          return;
        }
        if (showTemplates) {
          setShowTemplates(false);
          return;
        }
        if (showNewTask) {
          setShowNewTask(false);
          return;
        }
        if (showAddRepo) {
          setShowAddRepo(false);
          return;
        }
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (showRuntimes) {
          setShowRuntimes(false);
          return;
        }
        if (showInbox) {
          setShowInbox(false);
          return;
        }
        if (showIssueImporter) {
          setShowIssueImporter(false);
          return;
        }
        if (selectedTask) {
          // Don't close TaskDetail while the user is actively typing in an
          // input or textarea inside the panel (e.g. notes, stdin, cron fields).
          const active = document.activeElement;
          const isTypingInDetail =
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            (active as HTMLElement | null)?.isContentEditable === true;
          if (isTypingInDetail) return;
          handleCloseDetail();
          return;
        }
        if (search) {
          setSearch("");
          return;
        }
      }

      if (isTyping) return;

      // N — new task
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setShowNewTask(true);
      }
      // / — focus search
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      // Shift+O — add repo
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setShowAddRepo(true);
        return;
      }
      // O — open in editor
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        if (selectedTask) {
          api.tasks.openEditor(selectedTask.id).catch((err) => {
            alert(err instanceof Error ? err.message : String(err));
          });
        }
        return;
      }
      // 1-9 — switch workspace (repo)
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key, 10) - 1;
        if (index >= 0 && index < repos.length) {
          e.preventDefault();
          setSelectedRepoId(repos[index].id);
        }
        return;
      }
      // E — engines panel
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setShowEnginesPanel(true);
      }
      // ? — shortcuts modal
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
      // D — duplicate selected task
      if ((e.key === "d" || e.key === "D") && selectedTask && !isTyping) {
        e.preventDefault();
        cloneTask(selectedTask.id);
        toast(`Task duplicada`, "info");
        return;
      }
      // Ctrl+Shift+C — clear search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        setSearch("");
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    showCommandPalette,
    showEnginesPanel,
    showSchedulesPanel,
    showNewTask,
    showAddRepo,
    showSettings,
    showRuntimes,
    showInbox,
    showShortcuts,
    showIssueImporter,
    selectedTask,
    search,
    handleCloseDetail,
    cloneTask,
    toast,
    exportBoard,
    handleDeleteTask,
    showChangelog,
    showTemplates,
    repos.length,
    repos,
  ]);

  return (
    <ToastContext.Provider value={toastCtx}>
      <div className="h-screen flex overflow-hidden bg-app/30 text-primary">
        <Sidebar
          repos={repos}
          selectedRepoId={selectedRepoId}
          onSelectRepo={setSelectedRepoId}
          onAddRepo={() => setShowAddRepo(true)}
          onRemoveRepo={removeRepo}
          repoStats={repoStats}
          onDeleteLocalClone={async (repoId) => {
            const repo = repos.find((item) => item.id === repoId);
            if (!repo) return;
            if (!window.confirm(`Apagar o clone local de ${repo.name}?`)) return;
            try {
              await deleteLocalClone(repoId);
              toast(`Clone local de ${repo.name} apagado.`, "success");
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), "error");
            }
          }}
          onDeleteAllLocalClones={async () => {
            if (!window.confirm("Apagar todos os clones locais ociosos?")) return;
            try {
              const result = await purgeLocalClones();
              toast(`Clones limpos: ${result.deleted}. Pulados: ${result.skipped}.`, "success");
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), "error");
            }
          }}
          onOpenSettings={() => setShowSettings(true)}
          onOpenStats={() => setShowStats(true)}
          onOpenSkills={() => setShowSkills(true)}
          onOpenRuntimes={() => setShowRuntimes(true)}
          onOpenTemplates={() => setShowTemplates(true)}
          onOpenInbox={() => setShowInbox(true)}
          onOpenQuickView={() => setShowQuickView(true)}
          onOpenEngines={() => setShowEnginesPanel(true)}
          onOpenSchedules={() => setShowSchedulesPanel(true)}
          connected={connected}
        />

        <div className="flex-1 flex flex-col min-w-0 bg-app overflow-hidden">
          {/* Top Header */}
          <header className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-white/5 bg-surface/20 backdrop-blur-xl z-30">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-dimmed">
                  Workspace
                </span>
                <div className="h-4 w-px bg-white/10" />
                <h2 className="text-sm font-bold text-primary truncate max-w-[200px]">
                  {selectedRepo ? selectedRepo.name : "All Projects"}
                </h2>
              </div>

              <div className="hidden md:flex items-center gap-2 flex-1 max-w-md ml-4">
                <div className="relative w-full group">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted group-focus-within:text-accent transition-colors">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-label="Search icon"
                    >
                      <circle cx="7" cy="7" r="5" />
                      <path d="M11 11l4 4" strokeLinecap="round" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Quick search... (Ctrl+K)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => setShowCommandPalette(true)}
                    className="w-full h-10 pl-10 pr-4 rounded-xl text-xs bg-input/40 border border-default hover:border-strong focus:border-accent/40 focus:ring-4 focus:ring-accent/10 transition-all outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 ml-4 shrink-0">
              <div className="hidden lg:flex items-center gap-1.5 p-1 rounded-xl bg-input/30 border border-default shadow-inner">
                <HeaderAction icon="download" label="Export" onClick={exportBoard} />
                <HeaderAction
                  icon="history"
                  label="Changelog"
                  onClick={() => setShowChangelog(true)}
                />
                <HeaderAction
                  icon="help"
                  label="Shortcuts"
                  onClick={() => setShowShortcuts(true)}
                />
              </div>
              <div className="h-6 w-px bg-white/10 mx-1 hidden lg:block" />

              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-input/30 border border-default mr-2 shadow-inner">
                <HeaderAction
                  icon="plus"
                  label="Task"
                  onClick={() => setShowNewTask(true)}
                  variant="primary"
                />
                {selectedRepo &&
                  (selectedRepo.provider === "github" || selectedRepo.provider === "gitlab") && (
                    <HeaderAction
                      icon="import"
                      label="Issues"
                      onClick={() => setShowIssueImporter(true)}
                    />
                  )}
                <HeaderAction
                  icon="filter"
                  label={showFilterBar ? "Hide" : "Filter"}
                  onClick={() => _setShowFilterBar(!showFilterBar)}
                  active={showFilterBar}
                />
              </div>

              <div className="h-6 w-px bg-white/10 mx-1" />

              <button
                type="button"
                onClick={async () => {
                  await api.auth.logout();
                  onLogout();
                }}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-bold text-secondary hover:text-primary hover:bg-surface-hover border border-transparent hover:border-white/10 transition-all active-shrink cursor-pointer"
              >
                {auth.user?.avatarUrl ? (
                  <img
                    src={auth.user.avatarUrl}
                    alt={auth.user.username}
                    className="w-6 h-6 rounded-full ring-2 ring-accent/20"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[10px] text-white font-black shadow-lg shadow-accent/20">
                    {auth.user?.username[0].toUpperCase()}
                  </div>
                )}
                <span className="hidden lg:inline text-dimmed hover:text-primary transition-colors">
                  @{auth.user?.username}
                </span>
              </button>
            </div>
          </header>

          {/* Filter Bar Panel */}
          {showFilterBar && (
            <div className="px-6 py-4 bg-surface/10 border-b border-white/5 animate-in slide-in-from-top duration-300 ease-out">
              <FilterBar
                filters={filters}
                onFilterChange={setFilters}
                availableEngines={engines.filter((e) => e.available).map((e) => e.name)}
                availableTags={availableTags}
                search={search}
                onSearchChange={setSearch}
              />
            </div>
          )}

          {/* Board Main Area */}
          <main className="flex-1 overflow-hidden relative">
            {tasksLoading ? (
              <SkeletonBoard />
            ) : tasksError ? (
              <div className="flex flex-col items-center justify-center h-full gap-8 animate-in fade-in zoom-in duration-500">
                <div className="w-24 h-24 rounded-[2.5rem] bg-danger/10 border border-danger/20 flex items-center justify-center shadow-2xl shadow-danger/20 rotate-12">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-danger -rotate-12"
                    aria-label="Error icon"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="text-center space-y-3">
                  <h3 className="text-xl font-black text-primary tracking-tight">Sync Lost</h3>
                  <p className="text-sm text-muted max-w-sm mx-auto leading-relaxed">
                    The connection to the orchestrator was lost. Re-establishing secure tunnel...
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refresh}
                  className="bg-accent text-white px-8 h-12 rounded-2xl shadow-xl shadow-accent/25 hover:scale-105 transition-transform active:scale-95 font-bold uppercase tracking-widest text-[10px]"
                >
                  Retry Connection
                </button>
              </div>
            ) : (
              <ErrorBoundary>
                <div className="h-full w-full p-8 overflow-hidden">
                  <Board
                    tasks={filteredTasks}
                    onTaskClick={handleTaskClick}
                    onTaskMove={handleTaskMove}
                    onRetryPR={retryPR}
                    onArchiveDone={async () => {
                      try {
                        await archiveDone();
                        toast("Completed tasks archived", "info");
                      } catch {
                        toast("Failed to archive completed tasks", "error");
                      }
                    }}
                    onClearFailed={async () => {
                      try {
                        await clearFailed();
                        toast("Failed tasks removed", "info");
                      } catch {
                        toast("Failed to clear failed tasks", "error");
                      }
                    }}
                    onRetryAllFailed={async () => {
                      try {
                        await retryAllFailed();
                        toast("Restarting failed tasks", "info");
                      } catch {
                        toast("Failed to retry failed tasks", "error");
                      }
                    }}
                    retryQueueMap={retryQueueMap}
                  />
                </div>
              </ErrorBoundary>
            )}
          </main>
        </div>

        {/* Task Detail Slide-over */}
        {selectedTask && (
          <TaskDetail
            task={selectedTask}
            engines={engines}
            liveLogs={liveLogs[selectedTask.id] ?? []}
            onClose={handleCloseDetail}
            onLaunch={async (id, engine, model) => {
              setLiveLogs((prev) => ({ ...prev, [id]: [] }));
              await launchTask(id, engine, model);
              toast("Agent started", "success");
            }}
            onCancel={async (id) => {
              await cancelTask(id);
              toast("Agent canceled", "info");
            }}
            onRetry={async (id, engine, model) => {
              setLiveLogs((prev) => ({ ...prev, [id]: [] }));
              await retryTask(id, engine, model);
              toast("Agent restarted", "success");
            }}
            onRetryPR={async (id) => {
              await retryPR(id);
              toast("Creating PR...", "info");
            }}
            onApprove={async (id) => {
              await approveTask(id);
              toast("Solicitação aprovada", "success");
            }}
            onReject={async (id) => {
              await rejectTask(id);
              toast("Solicitação rejeitada", "info");
            }}
            onDelete={async (id) => {
              const taskToDelete = tasks.find((t) => t.id === id);
              await removeTask(id);
              handleCloseDetail();
              toast(
                "Task deletada",
                "info",
                taskToDelete
                  ? {
                      label: "Desfazer",
                      onClick: async () => {
                        await createTask({
                          title: taskToDelete.title,
                          description: taskToDelete.description,
                          repoId: taskToDelete.repoId,
                          engine: taskToDelete.engine ?? undefined,
                          tags: taskToDelete.tags,
                        });
                        toast("Task restaurada", "success");
                      },
                    }
                  : undefined
              );
            }}
            onSendInput={(taskId, input) => {
              send({ type: "agent_input", taskId, input });
            }}
            onClone={async (id) => {
              const cloned = await cloneTask(id);
              toast(`"${cloned.title}" clonada`, "success");
            }}
            onUpdateTask={async (id, data) => {
              await updateTask(id, data);
            }}
            onTaskRefresh={refresh}
            onSkillClick={handleSkillClick}
            allTasks={tasks}
          />
        )}

        {showEnginesPanel && (
          <EnginesPanel
            onClose={() => setShowEnginesPanel(false)}
            onOpenSettings={() => {
              setShowEnginesPanel(false);
              setShowSettings(true);
            }}
          />
        )}

        {showSchedulesPanel && (
          <div className="fixed inset-0 z-50 flex items-start justify-end">
            <button
              type="button"
              aria-label="Fechar painel de tasks agendadas"
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowSchedulesPanel(false)}
            />
            <div className="relative h-full w-full max-w-md glass-panel border-l flex flex-col overflow-hidden shadow-2xl shadow-black/40">
              <ScheduledTasksPanel />
              <div className="absolute top-4 right-4 z-10">
                <button
                  type="button"
                  onClick={() => setShowSchedulesPanel(false)}
                  className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        {showTemplates && (
          <TemplatesPanel open={showTemplates} onClose={() => setShowTemplates(false)} />
        )}

        {/* Shortcuts Modal */}
        {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

        {/* Changelog Modal */}
        {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}

        {/* Command Palette */}
        {showCommandPalette && (
          <CommandPalette
            tasks={tasks}
            repos={repos}
            onClose={() => setShowCommandPalette(false)}
            onSelectTask={(task) => {
              setShowCommandPalette(false);
              handleTaskClick(task);
            }}
            onSelectRepo={(repoId) => {
              setShowCommandPalette(false);
              setSelectedRepoId(repoId);
            }}
            onNewTask={() => {
              setShowCommandPalette(false);
              setShowNewTask(true);
            }}
            onAddRepo={() => {
              setShowCommandPalette(false);
              setShowAddRepo(true);
            }}
            onOpenSettings={() => {
              setShowCommandPalette(false);
              setShowSettings(true);
            }}
            onOpenSkills={() => {
              setShowCommandPalette(false);
              setShowSkills(true);
            }}
            onOpenEngines={() => {
              setShowCommandPalette(false);
              setShowEnginesPanel(true);
            }}
            onOpenStats={() => {
              setShowCommandPalette(false);
              setShowStats(true);
            }}
            onOpenRuntimes={() => {
              setShowCommandPalette(false);
              setShowRuntimes(true);
            }}
            onOpenInbox={() => {
              setShowCommandPalette(false);
              setShowInbox(true);
            }}
          />
        )}

        {/* Dialogs */}
        <NewTaskDialog
          open={showNewTask}
          onClose={() => setShowNewTask(false)}
          repos={repos}
          reposLoading={reposLoading}
          engines={engines}
          enginesLoading={enginesLoading}
          enginesError={enginesError}
          onSubmit={async ({
            autoLaunch,
            model,
            schedule,
            baseBranch,
            tags,
            agentId,
            workflowId,
            ...data
          }) => {
            const task = await createTask({
              ...data,
              baseBranch,
              tags,
              model,
              agentId,
              workflowId,
            });
            if (!task) return;

            if (schedule) {
              await api.schedules.upsert(task.id, {
                cronExpression: schedule.cronExpression,
                enabled: true,
              });
              toast(`"${data.title}" agendada (${schedule.cronExpression})`, "success");
            } else if (autoLaunch) {
              await launchTask(task.id, data.engine, model);
              toast(`"${data.title}" iniciada`, "success");
            } else {
              toast(`"${data.title}" adicionada ao backlog`, "success");
            }
          }}
        />

        <AddRepoDialog
          open={showAddRepo}
          onClose={() => setShowAddRepo(false)}
          onSubmit={async (data) => {
            await addRepo(data);
            toast("Repository adicionado — clonando...", "success");
          }}
        />

        <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

        <StatsDialog open={showStats} onClose={() => setShowStats(false)} />

        <RepoQuickView
          open={showQuickView}
          onClose={() => setShowQuickView(false)}
          repos={repos}
          tasks={tasks}
          onSelectRepo={(id) => {
            setSelectedRepoId(id);
          }}
          onOpenRepo={(repo) => {
            setSelectedRepoId(repo.id);
          }}
        />

        <RuntimeDashboard open={showRuntimes} onClose={() => setShowRuntimes(false)} />

        <InboxPanel
          open={showInbox}
          onClose={() => setShowInbox(false)}
          onOpenTask={handleOpenTaskById}
          onOpenEngines={() => setShowEnginesPanel(true)}
          onOpenRuntimes={() => setShowRuntimes(true)}
        />

        {selectedRepo && (
          <IssueImporter
            open={showIssueImporter}
            onClose={() => setShowIssueImporter(false)}
            repo={selectedRepo}
            onImport={handleImportIssues}
          />
        )}

        <SkillsBrowser
          open={showSkills}
          onClose={() => {
            setShowSkills(false);
            setInitialSkillName(null);
          }}
          initialSkillName={initialSkillName ?? undefined}
          matchedSkills={selectedTaskLoadedSkills}
        />

        <Toaster />
      </div>
    </ToastContext.Provider>
  );
}
