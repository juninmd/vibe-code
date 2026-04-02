import type { EngineInfo } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

export function useEngines(refreshIntervalMs = 30_000) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    api.engines
      .list()
      .then((list) => {
        setEngines(list);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, refreshIntervalMs]);

  const availableCount = engines.filter((e) => e.available).length;
  const totalActiveRuns = engines.reduce((sum, e) => sum + e.activeRuns, 0);

  return { engines, loading, error, refresh, availableCount, totalActiveRuns };
}
