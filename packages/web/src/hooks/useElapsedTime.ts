import { useEffect, useState } from "react";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}

export function useElapsedTime(startedAt: string | null | undefined, active: boolean): string {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!active || !startedAt) {
      setElapsed("");
      return;
    }
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(formatElapsed(Date.now() - start));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  return elapsed;
}
