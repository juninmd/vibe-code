/** Compact "2m ago" style formatting for session lists. */
export function formatRelativeTime(input: string | null | undefined, now = Date.now()): string {
  if (!input) return "";
  const value = Date.parse(input);
  if (Number.isNaN(value)) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  const days = Math.round(seconds / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
