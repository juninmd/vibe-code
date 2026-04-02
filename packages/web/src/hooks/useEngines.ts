import type { EngineInfo } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

export function useEngines(refreshIntervalMs = 30_000) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    api.engines
      .list()
      .then(setEngines)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, refreshIntervalMs]);

  const availableCount = engines.filter((e) => e.available).length;
  const totalActiveRuns = engines.reduce((sum, e) => sum + e.activeRuns, 0);

  return { engines, loading, refresh, availableCount, totalActiveRuns };
}
