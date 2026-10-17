import { useCallback, useEffect, useState } from "react";

/** The surfaces the operator can switch between. */
export type AppMode = "code" | "kanban" | "terminals";

const MODE_KEY = "harness-remote-mode";
/** Code (chat/remote-control) mode is the default surface. */
const DEFAULT_MODE: AppMode = "code";

const MODES: AppMode[] = ["code", "kanban", "terminals"];

function readInitialMode(): AppMode {
  if (typeof localStorage === "undefined") return DEFAULT_MODE;
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored && (MODES as string[]).includes(stored)) return stored as AppMode;
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
    () =>
      setModeState((current) => {
        const index = MODES.indexOf(current);
        return MODES[(index + 1) % MODES.length] ?? "code";
      }),
    []
  );

  return { mode, setMode, toggleMode };
}
