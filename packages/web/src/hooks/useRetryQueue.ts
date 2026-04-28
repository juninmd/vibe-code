import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

interface RetryState {
  taskId: string;
  attempt: number;
  dueAt: number;
  reason: string;
}

export function useRetryQueue(enabled: boolean): Map<string, RetryState> {
  const [queue, setQueue] = useState<Map<string, RetryState>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setQueue(new Map());
      return;
    }

    function poll() {
      api.runtimes
        .list()
        .then((runtimes) => {
          const entries = runtimes.flatMap((r) => r.retryQueue ?? []);
          const now = Date.now();
          const next = new Map<string, RetryState>();
          for (const e of entries) {
            next.set(e.taskId, {
              taskId: e.taskId,
              attempt: e.attempt,
              dueAt: now + e.dueInMs,
              reason: e.reason,
            });
          }
          setQueue(next);
        })
        .catch(() => {});
    }

    poll();
    timerRef.current = setInterval(poll, 5_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled]);

  return queue;
}

export type { RetryState };
