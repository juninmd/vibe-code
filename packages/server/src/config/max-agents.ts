const DEFAULT_MAX_AGENTS = 4;

function parsePositiveInt(value: string | number | null | undefined): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export function resolveMaxAgents(
  envValue: string | number | null | undefined,
  storedValue: string | number | null | undefined
): number {
  const envMax = parsePositiveInt(envValue) ?? DEFAULT_MAX_AGENTS;
  const storedMax = parsePositiveInt(storedValue) ?? 0;
  const resolved = storedMax > 0 ? Math.min(storedMax, envMax) : envMax;
  return Math.max(1, resolved);
}
