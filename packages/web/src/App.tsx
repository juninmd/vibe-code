import { useState, useCallback } from "react";
import type { TaskWithRun, TaskStatus, AgentLog, WsServerMessage } from "@vibe-code/shared";
import { Board } from "./components/Board";
import { Sidebar } from "./components/Sidebar";
import { TaskDetail } from "./components/TaskDetail";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { AddRepoDialog } from "./components/AddRepoDialog";
import { Button } from "./components/ui/button";
import { useTasks } from "./hooks/useTasks";
import { useRepos } from "./hooks/useRepos";
import { useEngines } from "./hooks/useEngines";
import { useWebSocket } from "./hooks/useWebSocket";

export default function App() {
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskWithRun | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [liveLogs, setLiveLogs] = useState<Record<string, AgentLog[]>>({});

  const { repos, addRepo, removeRepo, addOrUpdateRepo } = useRepos();
  const { tasks, createTask, updateTask, removeTask, launchTask, cancelTask, retryTask, updateTaskLocal, refresh } =
    useTasks(selectedRepoId ?? undefined);
  const engines = useEngines();

  const handleWsMessage = useCallback(
    (msg: WsServerMessage) => {
      switch (msg.type) {
        case "task_updated":
          updateTaskLocal(msg.task as TaskWithRun);
          setSelectedTask((prev) =>
            prev?.id === msg.task.id ? { ...prev, ...msg.task } as TaskWithRun : prev
          );
          refresh();
          break;
        case "repo_updated":
          // Update repo in-place without full refresh
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
    [updateTaskLocal, refresh]
  );

  const { connected, send, subscribe, unsubscribe } = useWebSocket(handleWsMessage);

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

  return (
    <div className="h-screen flex overflow-hidden bg-zinc-950 text-zinc-100">
      <Sidebar
        repos={repos}
        selectedRepoId={selectedRepoId}
        onSelectRepo={setSelectedRepoId}
        onAddRepo={() => setShowAddRepo(true)}
        onRemoveRepo={removeRepo}
        connected={connected}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-medium text-zinc-300">
              {selectedRepoId
                ? repos.find((r) => r.id === selectedRepoId)?.name ?? "Repository"
                : "All Repositories"}
            </h2>
            <p className="text-xs text-zinc-600">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowNewTask(true)}>
            + New Task
          </Button>
        </header>

        {/* Board */}
        <main className="flex-1 overflow-hidden p-4">
          <Board
            tasks={tasks}
            onTaskClick={handleTaskClick}
            onTaskMove={handleTaskMove}
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
          }}
          onCancel={cancelTask}
          onRetry={async (id) => {
            setLiveLogs((prev) => ({ ...prev, [id]: [] }));
            await retryTask(id);
          }}
          onDelete={async (id) => {
            await removeTask(id);
            handleCloseDetail();
          }}
          onSendInput={(taskId, input) => {
            send({ type: "agent_input", taskId, input });
          }}
        />
      )}

      {/* Dialogs */}
      <NewTaskDialog
        open={showNewTask}
        onClose={() => setShowNewTask(false)}
        repos={repos}
        engines={engines}
        onSubmit={async ({ autoLaunch, ...data }) => {
          const task = await createTask(data);
          if (autoLaunch && task) {
            await launchTask(task.id, data.engine);
          }
        }}
      />

      <AddRepoDialog
        open={showAddRepo}
        onClose={() => setShowAddRepo(false)}
        onSubmit={async (data) => {
          await addRepo(data);
        }}
      />
    </div>
  );
}
