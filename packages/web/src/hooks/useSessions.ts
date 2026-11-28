import type { SessionBoardResponse, SessionSource } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

const EMPTY: SessionBoardResponse = { cards: [], sources: [], scannedAt: "" };

/**
 * Polls the server's projection of the local coding-CLI session stores.
 * `enabled` keeps the disk scan off while the board is not on screen.
 */
export function useSessions(enabled = true, refreshIntervalMs = 10_000) {
  const [board, setBoard] = useState<SessionBoardResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((refresh = false) => {
    api.sessions
      .list({ refresh })
      .then((next) => {
        setBoard(next);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    load();
    const interval = setInterval(() => load(), refreshIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, load, refreshIntervalMs]);

  /** Forces a fresh disk scan, bypassing the server-side cache. */
  const refresh = useCallback(() => load(true), [load]);

  const countBySource = board.cards.reduce(
    (acc, card) => {
      acc[card.source] = (acc[card.source] ?? 0) + 1;
      return acc;
    },
    {} as Record<SessionSource, number>
  );

  return { board, loading, error, refresh, countBySource };
}
