// Ported from multica packages/views/chat/lib/format.ts.
// Drops the seconds part on round minutes so "3m" reads cleaner than "3m 0s".

export function formatElapsedSecs(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function formatElapsedMs(ms: number): string {
  return formatElapsedSecs(Math.max(0, Math.round(ms / 1000)));
}
