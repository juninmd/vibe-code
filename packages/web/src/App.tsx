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
import { FilterBar, type Filters } from "./components/FilterBar";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { Sidebar } from "./components/Sidebar";
import { TaskDetail } from "./components/TaskDetail";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/Toaster";
import { useBrowserNotifications } from "./hooks/useBrowserNotifications";
import { useEngines } from "./hooks/useEngines";
import { useRepos } from "./hooks/useRepos";
import { useTasks } from "./hooks/useTasks";
import { ToastContext, useToastState } from "./hooks/useToast";
import { useWebSocket } from "./hooks/useWebSocket";

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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(false);
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

  const { repos, addRepo, removeRepo, deleteLocalClone, purgeLocalClones, addOrUpdateRepo } =
    useRepos();
  const {
    tasks,
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

  const handleWsMessage = useCallback(
    (msg: WsServerMessage) => {
      switch (msg.type) {
        case "task_updated": {
          const updated = msg.task as TaskWithRun;
          const prev = prevStatusRef.current[updated.id];
          // Browser notification on terminal status change
          if (prev && prev !== updated.status) {
            if (updated.status === "done")
              notify(`✓ Tarefa concluída: ${updated.title}`, "Agente executou com sucesso");
            else if (updated.status === "failed")
              notify(`✕ Tarefa falhou: ${updated.title}`, "Execução do agente falhou");
            else if (updated.status === "review")
              notify(`◎ PR pronto: ${updated.title}`, "Agente abriu um pull request");
          }
          prevStatusRef.current[updated.id] = updated.status;
          startTransition(() => {
            updateTaskLocal(updated);
            setSelectedTask((sel) =>
              sel?.id === updated.id ? ({ ...sel, ...updated } as TaskWithRun) : sel
            );
          });
          break;
        }
        case "repo_updated":
          addOrUpdateRepo(msg.repo);
          break;
        case "agent_log":
          // Only update state if this is the task the user is currently looking at.
          // This avoids re-rendering the whole App for every background task log.
          if (selectedTask?.id === msg.taskId) {
            startTransition(() => {
              setLiveLogs((prev) => ({
                ...prev,
                [msg.taskId]: [
                  ...(prev[msg.taskId] ?? []),
                  {
                    id: Date.now(),
                    runId: msg.runId,
                    stream: msg.stream,
                    content: msg.content,
                    timestamp: msg.timestamp,
                  },
                ],
              }));
            });
          }
          break;
        case "agent_logs_batch":
          // Batched log delivery — single state update for multiple lines.
          if (selectedTask?.id === msg.taskId) {
            startTransition(() => {
              setLiveLogs((prev) => ({
                ...prev,
                [msg.taskId]: [
                  ...(prev[msg.taskId] ?? []),
                  ...msg.logs.map((l, i) => ({
                    id: Date.now() + i,
                    runId: l.runId,
                    stream: l.stream,
                    content: l.content,
                    timestamp: l.timestamp,
                  })),
                ],
              }));
            });
          }
          break;
        case "run_updated":
          startTransition(() => {
            updateRunLocal(msg.run.taskId, msg.run);
            setSelectedTask((sel) =>
              sel?.id === msg.run.taskId ? ({ ...sel, latestRun: msg.run } as TaskWithRun) : sel
            );
          });
          // Debounced engine refresh would be better, but for now we'll just keep it
          // as it's less frequent than logs.
          refreshEngines();
          break;
        case "run_status":
          startTransition(() => {
            updateRunLocal(msg.taskId, {
              id: msg.runId,
              taskId: msg.taskId,
              engine: selectedTask?.latestRun?.engine ?? "unknown",
              status: msg.status,
              currentStatus: selectedTask?.latestRun?.currentStatus ?? null,
              worktreePath: selectedTask?.latestRun?.worktreePath ?? null,
              startedAt: selectedTask?.latestRun?.startedAt ?? null,
              finishedAt: selectedTask?.latestRun?.finishedAt ?? null,
              exitCode: selectedTask?.latestRun?.exitCode ?? null,
              errorMessage: selectedTask?.latestRun?.errorMessage ?? null,
              createdAt: selectedTask?.latestRun?.createdAt ?? new Date().toISOString(),
            });
          });
          refreshEngines();
          break;
      }
    },
    [
      addOrUpdateRepo,
      notify,
      refreshEngines,
      selectedTask?.id,
      selectedTask?.latestRun,
      updateRunLocal,
      updateTaskLocal,
    ]
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
              [selectedTask.id]: [...(prev[selectedTask.id] ?? []), ...data.focusedLogs],
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
      // Resync state after reconnect: refresh tasks and focused logs once
      (async () => {
        try {
          await refresh();
          if (selectedTask?.id) {
            const data = await api.tasks.poll(selectedRepoId ?? undefined, selectedTask.id, 0);
            if (canceled) return;
            startTransition(() => {
              setTasksSnapshot(data.tasks);
              if (data.focusedTask) setSelectedTask(data.focusedTask);
              if (data.focusedLogs.length > 0) {
                const newestId = data.focusedLogs[data.focusedLogs.length - 1]?.id ?? 0;
                focusedLogCursorRef.current = Math.max(focusedLogCursorRef.current, newestId);
                setLiveLogs((prev) => ({
                  ...prev,
                  [selectedTask.id]: [...(prev[selectedTask.id] ?? []), ...data.focusedLogs],
                }));
              }
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
        if (selectedTask) {
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
      // F — toggle filter bar
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setShowFilterBar((v) => !v);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    showCommandPalette,
    showEnginesPanel,
    showNewTask,
    showAddRepo,
    showSettings,
    showShortcuts,
    selectedTask,
    search,
    handleCloseDetail,
  ]);

  return (
    <ToastContext.Provider value={toastCtx}>
      <div className="h-screen flex overflow-hidden bg-zinc-950/30 text-zinc-100">
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
          connected={connected}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Reconnect banner — only show after first successful connection is lost */}
          {!connected && wasConnected.current && (
            <div className="bg-amber-950/80 border-b border-amber-800/60 px-4 py-1.5 text-xs text-amber-300 flex items-center gap-2 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              Desconectado — tentando reconectar...
            </div>
          )}

          {/* Header */}
          <header className="glass-panel border-b px-4 py-3 flex items-center gap-3 shrink-0">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-medium text-zinc-300 truncate">
                {selectedRepoId ? (selectedRepo?.name ?? "Repositório") : "Todos os Repositórios"}
              </h2>
              <p className="text-xs text-zinc-600 flex items-center gap-2">
                {filteredTasks.length !== tasks.length
                  ? `${filteredTasks.length} de ${tasks.length} tarefas`
                  : `${tasks.length} tarefa${tasks.length !== 1 ? "s" : ""}`}
                {selectedRepo?.url && (
                  <a
                    href={selectedRepo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                    title={selectedRepo.url}
                  >
                    abrir repo
                  </a>
                )}
              </p>
            </div>

            {/* Engine status indicator */}
            <button
              type="button"
              onClick={() => setShowEnginesPanel(true)}
              title="Gerenciar serviços de IA (E)"
              className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-600 cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-1">
                {engines.slice(0, 4).map((e) => (
                  <span
                    key={e.name}
                    className={`w-1.5 h-1.5 rounded-full ${
                      e.available ? "bg-emerald-400" : "bg-zinc-600"
                    } ${e.activeRuns > 0 ? "animate-pulse" : ""}`}
                    title={`${e.displayName}: ${e.available ? "disponível" : "não instalado"}${e.activeRuns > 0 ? ` · ${e.activeRuns} rodando` : ""}`}
                  />
                ))}
              </div>
              <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
                {availableCount}/{engines.length}
              </span>
              {totalActiveRuns > 0 && (
                <span className="text-xs bg-blue-900/50 text-blue-300 border border-blue-700/40 rounded-full px-1.5 py-0.5 leading-none font-medium">
                  {totalActiveRuns} ativo{totalActiveRuns !== 1 ? "s" : ""}
                </span>
              )}
            </button>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <select
                value={selectedAgent ?? ""}
                onChange={(e) => setSelectedAgent(e.target.value || null)}
                className="px-2 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none focus:border-zinc-500"
              >
                <option value="">Todos Engines</option>
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
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs pointer-events-none">
                /
              </span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar tarefas..."
                className="pl-6 pr-3 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 w-40 focus:w-52 transition-all"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowCommandPalette(true)}
              title="Command palette (⌘K)"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-600 rounded-md bg-zinc-800/50 cursor-pointer transition-colors"
            >
              <span>⌘K</span>
            </button>

            <button
              type="button"
              onClick={exportBoard}
              title="Exportar board como JSON"
              className="hidden sm:flex items-center px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-600 rounded-md bg-zinc-800/50 cursor-pointer transition-colors"
            >
              ↓ Export
            </button>

            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              title="Atalhos (?) "
              className="hidden sm:flex items-center px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-600 rounded-md bg-zinc-800/50 cursor-pointer transition-colors"
            >
              ?
            </button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowNewTask(true)}
              title="Nova tarefa (N)"
            >
              + Tarefa
            </Button>
          </header>

          {/* Filter Bar */}
          {showFilterBar && (
            <FilterBar
              filters={filters}
              onFilterChange={setFilters}
              availableEngines={engines.filter((e) => e.available).map((e) => e.name)}
              availableTags={availableTags}
            />
          )}

          {/* Board */}
          <main className="flex-1 overflow-hidden p-4">
            <Board
              tasks={filteredTasks}
              onTaskClick={handleTaskClick}
              onTaskMove={handleTaskMove}
              onRetryPR={retryPR}
              onArchiveDone={async () => {
                await archiveDone();
                toast("Tarefas concluídas arquivadas", "info");
              }}
              onClearFailed={async () => {
                await clearFailed();
                toast("Tarefas com falha removidas", "info");
              }}
              onRetryAllFailed={async () => {
                await retryAllFailed();
                toast("Reiniciando tarefas com falha", "info");
              }}
            />
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
              toast("Agente iniciado", "success");
            }}
            onCancel={async (id) => {
              await cancelTask(id);
              toast("Agente cancelado", "info");
            }}
            onRetry={async (id) => {
              setLiveLogs((prev) => ({ ...prev, [id]: [] }));
              await retryTask(id);
              toast("Agente reiniciado", "success");
            }}
            onRetryPR={async (id) => {
              await retryPR(id);
              toast("Criando PR...", "info");
            }}
            onDelete={async (id) => {
              const taskToDelete = tasks.find((t) => t.id === id);
              await removeTask(id);
              handleCloseDetail();
              toast(
                "Tarefa deletada",
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
                        toast("Tarefa restaurada", "success");
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
          />
        )}

        {showEnginesPanel && <EnginesPanel onClose={() => setShowEnginesPanel(false)} />}

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
          onSubmit={async ({ autoLaunch, model, schedule, baseBranch, tags, ...data }) => {
            const task = await createTask({ ...data, baseBranch, tags });
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
            toast("Repositório adicionado — clonando...", "success");
          }}
        />

        <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

        <Toaster />
      </div>
    </ToastContext.Provider>
  );
}
