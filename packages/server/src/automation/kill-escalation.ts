export const SIGKILL_GRACE_MS = 10_000;

interface Killable {
  kill: (signal?: NodeJS.Signals | number) => unknown;
  killed?: boolean;
  exitCode?: number | null;
}

/** SIGTERM, then SIGKILL if the process is still alive after the grace period. Returns a cancel fn. */
export function killWithEscalation(proc: Killable, graceMs = SIGKILL_GRACE_MS): () => void {
  proc.kill("SIGTERM");
  const timer = setTimeout(() => {
    try {
      if (proc.exitCode == null) proc.kill("SIGKILL");
    } catch {
      // already dead
    }
  }, graceMs);
  (timer as { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
}
