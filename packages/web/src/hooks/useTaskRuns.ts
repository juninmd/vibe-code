import type { AgentRun } from "@vibe-code/shared";
import { useCallback, useState } from "react";
import { api } from "../api/client";

export function useTaskRuns(taskId: string | null, _limit = 10) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!taskId) return;

    setError(null);
    setLoading(true);

    try {
      console.debug("📜 Fetching runs for task", { taskId });
      const runsList = await api.tasks.runs(taskId);
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
  }, [taskId]);

  return { runs, loading, error, fetch: fetchRuns };
}
