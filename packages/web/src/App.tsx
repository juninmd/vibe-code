import type { AgentLog, TaskStatus, TaskWithRun, WsServerMessage } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddRepoDialog } from "./components/AddRepoDialog";
import { Board } from "./components/Board";
import { CommandPalette } from "./components/CommandPalette";
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

import { api } from "./api/client";

export default function App() {
  const toastCtx = useToastState();
  const { toast } = toastCtx;

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskWithRun | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
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
  const { engines } = useEngines();
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
              notify(`✓ Task done: ${updated.title}`, "Agent completed successfully");
            else if (updated.status === "failed")
              notify(`✕ Task failed: ${updated.title}`, "Agent run failed");
            else if (updated.status === "review")
              notify(`◎ PR ready: ${updated.title}`, "Agent pushed a pull request");
          }
          prevStatusRef.current[updated.id] = updated.status;
          updateTaskLocal(updated);
          setSelectedTask((sel) =>
            sel?.id === updated.id ? ({ ...sel, ...updated } as TaskWithRun) : sel
          );
          refresh();
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
          break;
      }
    },
    [updateTaskLocal, refresh, addOrUpdateRepo]
  );

  const { connected, send, subscribe, unsubscribe } = useWebSocket(handleWsMessage);

  // Show toast on disconnect / reconnect
  useEffect(() => {
    if (!connected && wasConnected.current) {
      toast("Connection lost. Reconnecting...", "error");
    }
    if (connected && wasConnected.current === false && wasConnected.current !== undefined) {
      toast("Reconnected!", "success");
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
    if (selectedModel) {
      result = result.filter((t) => t.model === selectedModel);
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
  }, [tasks, search, selectedAgent, selectedModel]);

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
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    showCommandPalette,
    showNewTask,
    showAddRepo,
    showSettings,
    selectedTask,
    search,
    handleCloseDetail,
  ]);

  return (
    <ToastContext.Provider value={toastCtx}>
      <div className="h-screen flex overflow-hidden bg-zinc-950 text-zinc-100">
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
          {/* Reconnect banner */}
          {!connected && (
            <div className="bg-amber-950/80 border-b border-amber-800/60 px-4 py-1.5 text-xs text-amber-300 flex items-center gap-2 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              Disconnected — trying to reconnect...
            </div>
          )}

          {/* Header */}
          <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4 shrink-0">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-medium text-zinc-300 truncate">
                {selectedRepoId
                  ? (repos.find((r) => r.id === selectedRepoId)?.name ?? "Repository")
                  : "All Repositories"}
              </h2>
              <p className="text-xs text-zinc-600">
                {filteredTasks.length !== tasks.length
                  ? `${filteredTasks.length} of ${tasks.length} tasks`
                  : `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
              </p>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <select
                value={selectedAgent ?? ""}
                onChange={(e) => setSelectedAgent(e.target.value || null)}
                className="px-2 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none focus:border-zinc-500"
              >
                <option value="">All Engines</option>
                {engines.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.displayName}
                  </option>
                ))}
              </select>

              <select
                value={selectedModel ?? ""}
                onChange={(e) => setSelectedModel(e.target.value || null)}
                className="px-2 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none focus:border-zinc-500"
              >
                <option value="">All Models</option>
                {Array.from(new Set(tasks.map((t) => t.model).filter(Boolean))).map((m) => (
                  <option key={m} value={m!}>
                    {m}
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
                placeholder="Search tasks..."
                className="pl-6 pr-3 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 w-44 focus:w-56 transition-all"
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
              title="New task (N)"
            >
              + New Task
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
                toast("Completed tasks archived", "info");
              }}
              onClearFailed={async () => {
                await clearFailed();
                toast("Failed tasks cleared", "info");
              }}
              onRetryAllFailed={async () => {
                await retryAllFailed();
                toast("Retrying all failed tasks", "info");
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
              toast("Agent launched", "success");
            }}
            onCancel={async (id) => {
              await cancelTask(id);
              toast("Agent cancelled", "info");
            }}
            onRetry={async (id) => {
              setLiveLogs((prev) => ({ ...prev, [id]: [] }));
              await retryTask(id);
              toast("Agent restarted", "success");
            }}
            onRetryPR={async (id) => {
              await retryPR(id);
              toast("PR retry initiated", "info");
            }}
            onDelete={async (id) => {
              await removeTask(id);
              handleCloseDetail();
              toast("Task deleted", "info");
            }}
            onSendInput={(taskId, input) => {
              send({ type: "agent_input", taskId, input });
            }}
            onTaskRefresh={refresh}
          />
        )}

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
          onSubmit={async ({ autoLaunch, model, schedule, ...data }) => {
            const task = await createTask(data);
            if (!task) return;

            if (schedule) {
              await api.schedules.upsert(task.id, {
                cronExpression: schedule.cronExpression,
                enabled: true,
              });
              toast(`"${data.title}" scheduled (${schedule.cronExpression})`, "success");
            } else if (autoLaunch) {
              await launchTask(task.id, data.engine, model);
              toast(`"${data.title}" started`, "success");
            } else {
              toast(`"${data.title}" added to backlog`, "success");
            }
          }}
        />

        <AddRepoDialog
          open={showAddRepo}
          onClose={() => setShowAddRepo(false)}
          onSubmit={async (data) => {
            await addRepo(data);
            toast("Repository added — cloning...", "success");
          }}
        />

        <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

        <Toaster />
      </div>
    </ToastContext.Provider>
  );
}
