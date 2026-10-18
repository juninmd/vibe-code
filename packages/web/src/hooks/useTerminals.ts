import type { TerminalLiveSession } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

export interface UseTerminals {
  /** Every live terminal the server currently holds. */
  sessions: TerminalLiveSession[];
  /** The same sessions keyed by task, for quick lookups while rendering cards. */
  byTask: Map<string, TerminalLiveSession>;
  error: string | null;
  refresh: () => void;
}

/**
 * Polls the server for the live terminals of the running worktrees, each with a text
 * preview of its screen. `enabled` keeps the polling off while the Terminals view is
 * not on screen, so a closed tab does not hammer the API.
 */
export function useTerminals(enabled = true, intervalMs = 3_000): UseTerminals {
  const [sessions, setSessions] = useState<TerminalLiveSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.terminal
      .list()
      .then((next) => {
        setSessions(next);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [enabled, load, intervalMs]);

  const byTask = useMemo(() => {
    const map = new Map<string, TerminalLiveSession>();
    for (const session of sessions) map.set(session.taskId, session);
    return map;
  }, [sessions]);

  return { sessions, byTask, error, refresh: load };
}
