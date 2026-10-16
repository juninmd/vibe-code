import { useCallback, useEffect, useState } from "react";

/** The two surfaces the operator can switch between. */
export type AppMode = "code" | "kanban";

const MODE_KEY = "harness-remote-mode";
/** Code (chat/remote-control) mode is the default surface. */
const DEFAULT_MODE: AppMode = "code";

function readInitialMode(): AppMode {
  if (typeof localStorage === "undefined") return DEFAULT_MODE;
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === "code" || stored === "kanban") return stored;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_MODE;
}

export interface UseAppMode {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
}

/** Persisted code/kanban mode switch. Defaults to code mode. */
export function useAppMode(): UseAppMode {
  const [mode, setModeState] = useState<AppMode>(readInitialMode);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* storage unavailable */
    }
  }, [mode]);

  const setMode = useCallback((next: AppMode) => setModeState(next), []);
  const toggleMode = useCallback(
    () => setModeState((current) => (current === "code" ? "kanban" : "code")),
    []
  );

  return { mode, setMode, toggleMode };
}
