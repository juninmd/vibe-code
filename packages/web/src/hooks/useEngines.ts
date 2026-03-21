import { useState, useEffect } from "react";
import type { EngineInfo } from "@vibe-code/shared";
import { api } from "../api/client";

export function useEngines() {
  const [engines, setEngines] = useState<EngineInfo[]>([]);

  useEffect(() => {
    api.engines.list().then(setEngines).catch(console.error);
  }, []);

  return engines;
}
