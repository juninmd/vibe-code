import type {
  AgentRun,
  CreateTaskRequest,
  TaskWithRun,
  UpdateTaskRequest,
} from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

export function useTasks(repoFilter?: string) {
  const [tasks, setTasks] = useState<TaskWithRun[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.tasks.list(repoFilter);
      setTasks(data);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
    } finally {
      setLoading(false);
    }
  }, [repoFilter]);

  // Load initial tasks on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Update a single task in-place (from WebSocket or optimistic updates)
  const updateTaskLocal = useCallback((updatedTask: Partial<TaskWithRun> & { id: string }) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === updatedTask.id ? ({ ...t, ...updatedTask } as TaskWithRun) : t))
    );
  }, []);

  const updateRunLocal = useCallback((taskId: string, latestRun: AgentRun) => {
    setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, latestRun } : task)));
  }, []);

  const setTasksSnapshot = useCallback((nextTasks: TaskWithRun[]) => {
    setTasks(nextTasks);
  }, []);

  const createTask = useCallback(async (data: CreateTaskRequest) => {
    const created = await api.tasks.create(data);
    // Fetch full TaskWithRun (includes repo) to avoid undefined repo on TaskCard
    const task = await api.tasks.get(created.id);
    setTasks((prev) => [task, ...prev]);
    return task;
  }, []);

  const cloneTask = useCallback(async (id: string) => {
    const created = await api.tasks.clone(id);
    const task = await api.tasks.get(created.id);
    setTasks((prev) => [task, ...prev]);
    return task;
  }, []);

  const updateTask = useCallback(
    async (id: string, data: UpdateTaskRequest) => {
      // Optimistic update
      setTasks((prev) => prev.map((t) => (t.id === id ? ({ ...t, ...data } as TaskWithRun) : t)));
      try {
        const task = await api.tasks.update(id, data);
        updateTaskLocal(task);
        return task;
      } catch (err) {
        // Rollback on error? We'd need the original task.
        // For now, let's just refresh to be safe if it fails.
        refresh();
        throw err;
      }
    },
    [updateTaskLocal, refresh]
  );

  const removeTask = useCallback(async (id: string) => {
    try {
      await api.tasks.remove(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error("Failed to remove task:", err);
      throw err;
    }
  }, []);

  const archiveDone = useCallback(async () => {
    try {
      await api.tasks.archiveDone(repoFilter);
      setTasks((prev) => prev.filter((t) => t.status !== "done"));
    } catch (err) {
      console.error("Failed to archive done tasks:", err);
      throw err;
    }
  }, [repoFilter]);

  const clearFailed = useCallback(async () => {
    try {
      await api.tasks.clearFailed(repoFilter);
      setTasks((prev) => prev.filter((t) => t.status !== "failed"));
    } catch (err) {
      console.error("Failed to clear failed tasks:", err);
      throw err;
    }
  }, [repoFilter]);

  const retryAllFailed = useCallback(async () => {
    try {
      await api.tasks.retryFailed(repoFilter);
      setTasks((prev) =>
        prev.map((t) => (t.status === "failed" ? { ...t, status: "backlog" as const } : t))
      );
    } catch (err) {
      console.error("Failed to retry all failed:", err);
      throw err;
    }
  }, [repoFilter]);

  const launchTask = useCallback(
    async (id: string, engine?: string, model?: string) => {
      const payload = engine || model ? { engine, model } : undefined;
      const run = await api.tasks.launch(id, payload);
      const task = tasks.find((t) => t.id === id);
      if (task) {
        updateTaskLocal({ ...task, status: "in_progress", latestRun: run });
      }
      return run;
    },
    [tasks, updateTaskLocal]
  );

  const cancelTask = useCallback(
    async (id: string) => {
      try {
        await api.tasks.cancel(id);
        // Update to backlog optimistically
        const task = tasks.find((t) => t.id === id);
        if (task) {
          updateTaskLocal({ ...task, status: "backlog" });
        }
      } catch (err) {
        console.error("Failed to cancel task:", err);
      }
    },
    [tasks, updateTaskLocal]
  );

  const retryTask = useCallback(
    async (id: string) => {
      const run = await api.tasks.retry(id);
      const task = tasks.find((t) => t.id === id);
      if (task) {
        updateTaskLocal({ ...task, status: "in_progress", latestRun: run });
      }
      return run;
    },
    [tasks, updateTaskLocal]
  );

  const retryPR = useCallback(async (id: string) => {
    const result = await api.tasks.retryPR(id);
    return result;
  }, []);

  return {
    tasks,
    loading,
    refresh,
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
  };
}
