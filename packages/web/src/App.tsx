import type { AgentLog, TaskStatus, TaskWithRun, WsServerMessage } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import { AddRepoDialog } from "./components/AddRepoDialog";
import { Board } from "./components/Board";
import { CommandPalette } from "./components/CommandPalette";
import { EnginesPanel } from "./components/EnginesPanel";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { SettingsDialog } from "./components/SettingsDialog";
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
  const [liveLogs, setLiveLogs] = useState<Record<string, AgentLog[]>>({});
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const { repos, addRepo, removeRepo, addOrUpdateRepo } = useRepos();
  const {
    tasks,
    createTask,
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
    refresh,
  } = useTasks(selectedRepoId ?? undefined);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: notify and prevStatusRef are stable refs
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
          updateTaskLocal(updated);
          setSelectedTask((sel) =>
            sel?.id === updated.id ? ({ ...sel, ...updated } as TaskWithRun) : sel
          );
          refresh();
          // Refresh engine active runs when task changes
          refreshEngines();
          break;
        }
        case "repo_updated":
          addOrUpdateRepo(msg.repo);
          break;
        case "agent_log":
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
          break;
        case "run_status":
        case "run_updated":
          refresh();
          refreshEngines();
          break;
      }
    },
    [updateTaskLocal, refresh, addOrUpdateRepo, refreshEngines]
  );

  const { connected, send, subscribe, unsubscribe } = useWebSocket(handleWsMessage);

  // Show toast on disconnect / reconnect
  useEffect(() => {
    if (!connected && wasConnected.current) {
      toast("Conexão perdida. Reconectando...", "error");
    }
    if (connected && wasConnected.current === false && wasConnected.current !== undefined) {
      toast("Reconectado!", "success");
    }
    wasConnected.current = connected;
  }, [connected, toast]);

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
    let result = tasks.filter((t) => t.status !== "archived");

    if (selectedAgent) {
      result = result.filter((t) => t.engine === selectedAgent);
    }

    if (!search.trim()) return result;

    const q = search.toLowerCase();
    return result.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.repo?.name.toLowerCase().includes(q) ||
        t.branchName?.toLowerCase().includes(q)
    );
  }, [tasks, search, selectedAgent]);

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
      // R — add repo
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setShowAddRepo(true);
      }
      // E — engines panel
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setShowEnginesPanel(true);
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
                {selectedRepoId
                  ? (repos.find((r) => r.id === selectedRepoId)?.name ?? "Repositório")
                  : "Todos os Repositórios"}
              </h2>
              <p className="text-xs text-zinc-600">
                {filteredTasks.length !== tasks.length
                  ? `${filteredTasks.length} de ${tasks.length} tarefas`
                  : `${tasks.length} tarefa${tasks.length !== 1 ? "s" : ""}`}
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

            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowNewTask(true)}
              title="Nova tarefa (N)"
            >
              + Tarefa
            </Button>
          </header>

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
              await removeTask(id);
              handleCloseDetail();
              toast("Tarefa deletada", "info");
            }}
            onSendInput={(taskId, input) => {
              send({ type: "agent_input", taskId, input });
            }}
            onTaskRefresh={refresh}
          />
        )}

        {/* Engines Panel */}
        {showEnginesPanel && <EnginesPanel onClose={() => setShowEnginesPanel(false)} />}

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
          onSubmit={async ({ autoLaunch, model, schedule, baseBranch, ...data }) => {
            const task = await createTask({ ...data, baseBranch });
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
