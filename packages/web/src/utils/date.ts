/**
 * Formata uma data para o fuso horário UTC-3 (America/Sao_Paulo)
 * Formato esperado: DD/MM/YYYY, HH:mm:ss
 */
export function formatDateTime(date: string | Date | null): string {
  if (!date) return "-";

  const d = typeof date === "string" ? new Date(date) : date;
  // Intl.DateTimeFormat.format throws RangeError on an invalid Date, which would blank the React tree.
  if (Number.isNaN(d.getTime())) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Formata a duração entre dois timestamps.
 * Formato esperado: "45s", "1m 23s", "2h 3m"
 */
export function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt) return null;
  const ms = new Date(finishedAt ?? Date.now()).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms)) return null;
  // Clock skew between server and browser can make a running task end before it started.
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function formatTime(date: string | Date | number | null): string {
  if (!date) return "--:--:--";

  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "--:--:--";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}
