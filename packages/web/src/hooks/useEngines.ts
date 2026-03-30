import type { EngineInfo } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";

export function useEngines() {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.engines
      .list()
      .then(setEngines)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { engines, loading };
}
