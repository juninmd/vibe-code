import type { ExternalTerminal, SessionCard } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { subscribeTerminal } from "./terminalBus";

export interface UseExternalTerminal {
  terminal: ExternalTerminal | null;
  busy: boolean;
  error: string | null;
  open: () => void;
  stop: () => void;
}

/**
 * Terminal for a CLI session started outside vibe-code. Reattaches when the app already
 * owns one, otherwise opens a fresh PTY that resumes the session in its own CLI.
 * `size` reports the terminal grid so the PTY opens at the right dimensions.
 */
export function useExternalTerminal(
  card: Pick<SessionCard, "source" | "sessionId">,
  size: () => { cols?: number; rows?: number } | undefined,
  onError?: (message: string) => void
): UseExternalTerminal {
  const [terminal, setTerminal] = useState<ExternalTerminal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ size, onError });
  callbacks.current = { size, onError };

  const open = useCallback(() => {
    setBusy(true);
    setError(null);
    api.sessions.terminal
      .start(card.source, card.sessionId, callbacks.current.size() ?? {})
      .then((next) => setTerminal({ ...next, source: card.source, sessionId: card.sessionId }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        callbacks.current.onError?.(message);
      })
      .finally(() => setBusy(false));
  }, [card.source, card.sessionId]);

  // Keyed on the session identity only: re-running on every parent render would remount
  // the terminal on each poll and respawn a CLI the operator had just stopped.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    let cancelled = false;
    setTerminal(null);
    setError(null);
    api.sessions.terminal
      .state(card.source, card.sessionId)
      .then((live) => {
        if (cancelled) return;
        if (live) setTerminal(live);
        else openRef.current();
      })
      .catch(() => {
        if (!cancelled) openRef.current();
      });
    return () => {
      cancelled = true;
    };
  }, [card.source, card.sessionId]);

  useEffect(
    () =>
      subscribeTerminal(terminal?.id ?? "", (event) => {
        if (event.kind === "closed") setTerminal(null);
      }),
    [terminal?.id]
  );

  const stop = useCallback(() => {
    setBusy(true);
    api.sessions.terminal
      .stop(card.source, card.sessionId)
      .then(() => setTerminal(null))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [card.source, card.sessionId]);

  return { terminal, busy, error, open, stop };
}
