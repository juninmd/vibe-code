/**
 * Formata uma data para o fuso horário UTC-3 (America/Sao_Paulo)
 * Formato esperado: DD/MM/YYYY, HH:mm:ss
 */
export function formatDateTime(date: string | Date | null): string {
  if (!date) return "-";

  const d = typeof date === "string" ? new Date(date) : date;

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
 * Formata apenas a hora para o fuso horário UTC-3 (America/Sao_Paulo)
 * Formato esperado: HH:mm:ss
 */
export function formatTime(date: string | Date | number | null): string {
  if (!date) return "--:--:--";

  const d = new Date(date);

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}
