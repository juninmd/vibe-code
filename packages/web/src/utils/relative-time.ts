/** Compact "2m ago" style formatting for session lists. */
export function formatRelativeTime(input: string | null | undefined, now = Date.now()): string {
  if (!input) return "";
  const value = Date.parse(input);
  if (Number.isNaN(value)) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 45) return "just now";
  // Compare rounded values so 59m40s reads "1h ago", not "60m ago".
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(seconds / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
