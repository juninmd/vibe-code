import type { AgentLog, TaskStatus, TaskWithRun, WsServerMessage } from "@vibe-code/shared";
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
import { CommandPalette } from "./components/CommandPalette";
import { EnginesPanel } from "./components/EnginesPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FilterBar, type Filters } from "./components/FilterBar";
import { InboxPanel } from "./components/InboxPanel";
import { IssueImporter } from "./components/IssueImporter";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { RuntimeDashboard } from "./components/RuntimeDashboard";
import { ScheduledTasksPanel } from "./components/ScheduledTasksPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { Sidebar } from "./components/Sidebar";
import { SkeletonBoard } from "./components/Skeleton";
import { SkillsBrowser } from "./components/SkillsBrowser";
import { StatsDialog } from "./components/StatsDialog";
import { TaskDetail } from "./components/TaskDetail";
import { Button } from "./components/ui/button";
import { getEngineMeta } from "./components/ui/engine-icons";
import { Toaster } from "./components/ui/Toaster";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import { useBrowserNotifications } from "./hooks/useBrowserNotifications";
import { useEngines } from "./hooks/useEngines";
import { useRepos } from "./hooks/useRepos";
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

export default function App() {
  const toastCtx = useToastState();
  const { toast } = toastCtx;

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
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
  const [showRuntimes, setShowRuntimes] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [showIssueImporter, setShowIssueImporter] = useState(false);
  const [initialSkillName, setInitialSkillName] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    engine: null,
    priority: null,
    hasPR: false,
    tags: [],
  });
  const [liveLogs, setLiveLogs] = useState<Record<string, AgentLog[]>>({});
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const focusedLogCursorRef = useRef(0);
  const refreshEnginesThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTaskRef = useRef(selectedTask);
  selectedTaskRef.current = selectedTask;
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { repos, addRepo, removeRepo, deleteLocalClone, purgeLocalClones, addOrUpdateRepo } =
    useRepos();
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
    updateTaskLocal,
    updateRunLocal,
    setTasksSnapshot,
    refresh,
  } = useTasks(selectedRepoId ?? undefined);
  const deferredTasks = useDeferredValue(tasks);
  const deferredSearch = useDeferredValue(search);

  const {
    engines,
    loading: enginesLoading,
    error: enginesError,
    availableCount,
    totalActiveRuns,
    refresh: refreshEngines,
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
      refreshEngines();
    }, 1500);
  }, [refreshEngines]);

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
                    stream: "system",
                    content: `[tool] ${msg.toolName}${msg.toolId ? ` (${msg.toolId})` : ""}${msg.parameters ? ` ${JSON.stringify(msg.parameters)}` : ""}`,
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
                    stream: "system",
                    content: `[tool result] ${msg.status}${msg.toolId ? ` (${msg.toolId})` : ""}: ${msg.output.length > 120 ? `${msg.output.slice(0, 120)}...` : msg.output}`,
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

    if (!connected && wasConnected.current) {
      toast("Conexão perdida. Reconectando...", "error");
    }
    if (connected && wasConnected.current === false && wasConnected.current !== undefined) {
      toast("Reconectado!", "success");
      // Resync state after reconnect: clear live logs then fetch fresh
      (async () => {
        try {
          await refresh();
          if (selectedTask?.id) {
            const data = await api.tasks.poll(selectedRepoId ?? undefined, selectedTask.id, 0);
            if (canceled) return;
            startTransition(() => {
              setTasksSnapshot(data.tasks);
              if (data.focusedTask) setSelectedTask(data.focusedTask);
              // Replace (not append) to avoid duplicates after reconnect
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
        if (showEnginesPanel) {
          setShowEnginesPanel(false);
          return;
        }
        if (showSchedulesPanel) {
          setShowSchedulesPanel(false);
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
      // O — add repo
      if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setShowAddRepo(true);
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
          onOpenInbox={() => setShowInbox(true)}
          connected={connected}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Reconnect banner — only show after first successful connection is lost */}
          {!connected && wasConnected.current && (
            <div className="bg-warning/15 border-b border-warning/30 px-4 py-1.5 text-xs text-warning flex items-center gap-2 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              Disconnected — attempting to reconnect...
            </div>
          )}

          {/* Header */}
          <header className="bg-app/50 backdrop-blur-md border-b border-default px-4 py-3 flex items-center gap-4 shrink-0">
            {/* Workspace Selector */}
            <div className="hidden md:block min-w-max">
              <WorkspaceSelector />
            </div>

            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-medium text-secondary truncate">
                {selectedRepoId ? (selectedRepo?.name ?? "Repository") : "All Repositories"}
              </h2>
              <p className="text-xs text-dimmed flex items-center gap-2">
                {filteredTasks.length !== tasks.length
                  ? `${filteredTasks.length} de ${tasks.length} tasks`
                  : `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
                {selectedRepo?.url && (
                  <a
                    href={selectedRepo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary0 hover:text-secondary transition-colors"
                    title={selectedRepo.url}
                  >
                    open repo
                  </a>
                )}
              </p>
            </div>

            {/* Schedules indicator */}
            <button
              type="button"
              onClick={() => setShowSchedulesPanel(true)}
              title="Manage Scheduled Tasks"
              aria-label="Manage Scheduled Tasks"
              className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-strong bg-surface/50 hover:bg-surface-hover hover:border-strong cursor-pointer transition-colors group"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Schedule"
                className="opacity-70 group-hover:opacity-100 transition-opacity text-primary0 group-hover:text-primary"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </button>

            {/* Engine status indicator */}
            <button
              type="button"
              onClick={() => setShowEnginesPanel(true)}
              title="Manage AI Services (E)"
              className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-strong bg-surface/50 hover:bg-surface-hover hover:border-strong cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-1">
                {engines.slice(0, 4).map((e) => (
                  <span
                    key={e.name}
                    className={`w-1.5 h-1.5 rounded-full ${
                      e.available ? "bg-emerald-400" : "bg-border-strong"
                    } ${e.activeRuns > 0 ? "animate-pulse" : ""}`}
                    title={`${e.displayName}: ${e.available ? "disponível" : "não instalado"}${e.activeRuns > 0 ? ` · ${e.activeRuns} rodando` : ""}`}
                  />
                ))}
              </div>
              <span className="text-xs text-secondary group-hover:text-primary transition-colors">
                {availableCount}/{engines.length}
              </span>
              {totalActiveRuns > 0 && (
                <span className="text-xs bg-info/15 text-info border border-info/30 rounded-full px-1.5 py-0.5 leading-none font-medium">
                  {totalActiveRuns} active{totalActiveRuns !== 1 ? "s" : ""}
                </span>
              )}
            </button>

            {/* Filters */}
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-surface border border-strong focus-within:ring-1 focus-within:ring-[var(--accent)] transition-all">
              {(() => {
                const eng = selectedAgent ? getEngineMeta(selectedAgent) : null;
                const Icon = eng?.icon;
                return Icon ? (
                  <span className={eng?.color}>
                    <Icon size={12} />
                  </span>
                ) : (
                  <svg
                    aria-hidden="true"
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="text-secondary opacity-70"
                  >
                    <path d="M8 2C5.5 5 4 6.5 4 8C4 9.5 5.5 11 8 14C10.5 11 12 9.5 12 8C12 6.5 10.5 5 8 2Z" />
                  </svg>
                );
              })()}
              <select
                value={selectedAgent ?? ""}
                onChange={(e) => setSelectedAgent(e.target.value || null)}
                className="bg-transparent border-none text-secondary focus:outline-none cursor-pointer outline-none w-full"
              >
                <option value="">All Engines</option>
                {engines
                  .filter((e) => e.available)
                  .map((e) => (
                    <option key={e.name} value={e.name}>
                      {e.displayName}
                    </option>
                  ))}
              </select>
            </div>

            {/* Search */}
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-primary0 text-xs pointer-events-none">
                /
              </span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => {
                  if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                  searchTimeoutRef.current = setTimeout(() => {
                    setSearch(e.target.value);
                  }, 200);
                }}
                placeholder="Search tasks..."
                className="pl-6 pr-3 py-1.5 text-xs rounded-md bg-surface border border-strong text-secondary placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 w-40 focus:w-52 transition-all"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-primary0 hover:text-secondary cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowCommandPalette(true)}
              title="Command palette (⌘K)"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-primary0 hover:text-secondary border border-strong hover:border-strong rounded-md bg-surface/50 cursor-pointer transition-colors"
            >
              <span>⌘K</span>
            </button>

            <button
              type="button"
              onClick={exportBoard}
              title="Exportar board como JSON"
              className="hidden sm:flex items-center px-2.5 py-1.5 text-xs text-primary0 hover:text-secondary border border-strong hover:border-strong rounded-md bg-surface/50 cursor-pointer transition-colors"
            >
              ↓ Export
            </button>

            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              title="Atalhos (?) "
              className="hidden sm:flex items-center px-2 py-1.5 text-xs text-primary0 hover:text-secondary border border-strong hover:border-strong rounded-md bg-surface/50 cursor-pointer transition-colors"
            >
              ?
            </button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowNewTask(true)}
              title="Nova task (N)"
            >
              + Task
            </Button>
            {selectedRepo &&
              (selectedRepo.provider === "github" || selectedRepo.provider === "gitlab") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowIssueImporter(true)}
                  title="Importar issues como tasks"
                >
                  ↓ Issues
                </Button>
              )}
          </header>

          {/* Filter Bar */}
          {showFilterBar && (
            <FilterBar
              filters={filters}
              onFilterChange={setFilters}
              availableEngines={engines.filter((e) => e.available).map((e) => e.name)}
              availableTags={availableTags}
              search={search}
              onSearchChange={setSearch}
            />
          )}

          {/* Board */}
          <main className="flex-1 overflow-hidden p-4">
            {tasksLoading ? (
              <SkeletonBoard />
            ) : tasksError ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-14 h-14 rounded-full bg-danger/15 border border-danger/30 flex items-center justify-center">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-danger"
                      aria-label="Error icon"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold text-primary">Falha ao carregar tasks</h3>
                    <p className="text-xs text-secondary max-w-xs">{tasksError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={refresh}
                  className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors cursor-pointer"
                >
                  Tentar novamente
                </button>
              </div>
            ) : (
              <ErrorBoundary>
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
                />
              </ErrorBoundary>
            )}
          </main>
        </div>

        {/* Task Detail Slide-over */}
        {selectedTask && (
          <TaskDetail
            task={selectedTask}
            liveLogs={liveLogs[selectedTask.id] ?? []}
            onClose={handleCloseDetail}
            onLaunch={async (id, engine) => {
              setLiveLogs((prev) => ({ ...prev, [id]: [] }));
              await launchTask(id, engine);
              toast("Agent started", "success");
            }}
            onCancel={async (id) => {
              await cancelTask(id);
              toast("Agent canceled", "info");
            }}
            onRetry={async (id) => {
              setLiveLogs((prev) => ({ ...prev, [id]: [] }));
              await retryTask(id);
              toast("Agent restarted", "success");
            }}
            onRetryPR={async (id) => {
              await retryPR(id);
              toast("Creating PR...", "info");
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

        {/* Shortcuts Modal */}
        {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

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
          matchedSkills={selectedTask?.matchedSkills}
        />

        <Toaster />
      </div>
    </ToastContext.Provider>
  );
}
