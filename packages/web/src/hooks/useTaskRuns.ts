import type { AgentRun } from "@vibe-code/shared";
import { useCallback, useState } from "react";

export function useTaskRuns(taskId: string | null, limit = 10) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!taskId) return;

    setError(null);
    setLoading(true);

    try {
      console.debug("📜 Fetching runs for task", {
        taskId,
        limit,
      });

      const response = await window.fetch(`/api/tasks/${taskId}/runs?limit=${limit}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const runsList: AgentRun[] = Array.isArray(data) ? data : data.data || [];

      console.info(`✅ Loaded ${runsList.length} runs for task ${taskId}`);

      setRuns(runsList);
      setError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("❌ Failed to fetch task runs:", errorMsg, { taskId });
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [taskId, limit]);

  return { runs, loading, error, fetch };
}
