import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

const POLL_INTERVAL_MS = 15_000;

/** Returns `true` when the REST API backend is reachable. */
export function useApiHealth(): boolean {
  const [apiOk, setApiOk] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    try {
      await api.health();
      setApiOk(true);
    } catch {
      setApiOk(false);
    }
  }, []);

  useEffect(() => {
    check();

    const schedule = () => {
      timerRef.current = setTimeout(async () => {
        await check();
        schedule();
      }, POLL_INTERVAL_MS);
    };
    schedule();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [check]);

  return apiOk;
}
