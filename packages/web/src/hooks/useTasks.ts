import type { CreateTaskRequest, TaskWithRun, UpdateTaskRequest } from "@vibe-code/shared";
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
  const updateTaskLocal = useCallback((updatedTask: TaskWithRun) => {
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } : t)));
  }, []);

  const createTask = useCallback(async (data: CreateTaskRequest) => {
    const task = await api.tasks.create(data);
    // Add to list instead of full refresh
    setTasks((prev) => [task, ...prev]);
    return task;
  }, []);

  const updateTask = useCallback(
    async (id: string, data: UpdateTaskRequest) => {
      const task = await api.tasks.update(id, data);
      updateTaskLocal(task);
      return task;
    },
    [updateTaskLocal]
  );

  const removeTask = useCallback(async (id: string) => {
    await api.tasks.remove(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const archiveDone = useCallback(async () => {
    await api.tasks.archiveDone(repoFilter);
    // Filter out done tasks instead of full refresh
    setTasks((prev) => prev.filter((t) => t.status !== "done"));
  }, [repoFilter]);

  const clearFailed = useCallback(async () => {
    await api.tasks.clearFailed(repoFilter);
    setTasks((prev) => prev.filter((t) => t.status !== "failed"));
  }, [repoFilter]);

  const retryAllFailed = useCallback(async () => {
    await api.tasks.retryFailed(repoFilter);
    // Just mark them as backlog locally
    setTasks((prev) =>
      prev.map((t) => (t.status === "failed" ? { ...t, status: "backlog" as const } : t))
    );
  }, [repoFilter]);

  const launchTask = useCallback(
    async (id: string, engine?: string, model?: string) => {
      const payload = engine || model ? { engine, model } : undefined;
      const run = await api.tasks.launch(id, payload);
      // Update task status to in_progress optimistically
      const task = tasks.find((t) => t.id === id);
      if (task) {
        updateTaskLocal({ ...task, status: "in_progress" });
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
        updateTaskLocal({ ...task, status: "in_progress" });
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
  };
}
