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

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTask = useCallback(
    async (data: CreateTaskRequest) => {
      const task = await api.tasks.create(data);
      await refresh();
      return task;
    },
    [refresh]
  );

  const updateTask = useCallback(
    async (id: string, data: UpdateTaskRequest) => {
      const task = await api.tasks.update(id, data);
      await refresh();
      return task;
    },
    [refresh]
  );

  const removeTask = useCallback(
    async (id: string) => {
      await api.tasks.remove(id);
      await refresh();
    },
    [refresh]
  );

  const launchTask = useCallback(
    async (id: string, engine?: string, model?: string) => {
      const payload = engine || model ? { engine, model } : undefined;
      const run = await api.tasks.launch(id, payload);
      await refresh();
      return run;
    },
    [refresh]
  );

  const cancelTask = useCallback(
    async (id: string) => {
      try {
        await api.tasks.cancel(id);
      } catch (err) {
        console.error("Failed to cancel task:", err);
      }
      await refresh();
    },
    [refresh]
  );

  const retryTask = useCallback(
    async (id: string) => {
      const run = await api.tasks.retry(id);
      await refresh();
      return run;
    },
    [refresh]
  );

  const retryPR = useCallback(
    async (id: string) => {
      const result = await api.tasks.retryPR(id);
      await refresh();
      return result;
    },
    [refresh]
  );

  // Update a single task in-place (from WebSocket)
  const updateTaskLocal = useCallback((updatedTask: TaskWithRun) => {
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } : t)));
  }, []);

  return {
    tasks,
    loading,
    refresh,
    createTask,
    updateTask,
    removeTask,
    launchTask,
    cancelTask,
    retryTask,
    retryPR,
    updateTaskLocal,
  };
}
