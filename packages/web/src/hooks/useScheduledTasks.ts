import type { TaskScheduleWithTask } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";

export function useScheduledTasks(refreshIntervalMs = 15_000) {
  const [tasks, setTasks] = useState<TaskScheduleWithTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      console.debug("📋 Fetching scheduled tasks");

      const response = await fetch("/api/tasks/schedules");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const schedules: TaskScheduleWithTask[] = data.data || [];

      console.info(
        `✅ Loaded ${schedules.length} scheduled tasks (polling in ${refreshIntervalMs}ms)`
      );

      setTasks(schedules);
      setError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("❌ Failed to fetch schedules:", errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [refreshIntervalMs]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, refreshIntervalMs]);

  return { tasks, loading, error, refetch: refresh };
}
