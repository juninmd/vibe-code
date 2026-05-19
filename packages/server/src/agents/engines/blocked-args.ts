// Ported from multica server/pkg/agent/claude.go:filterCustomArgs.
// Protects protocol-critical flags from being overridden via user customArgs.

export type BlockedArgMode = "with-value" | "standalone";
export type BlockedArgs = Record<string, BlockedArgMode>;

export function filterCustomArgs(
  args: string[] | undefined,
  blocked: BlockedArgs,
  onBlock?: (flag: string) => void
): string[] {
  if (!args?.length) return [];
  const out: string[] = [];
  let skipNext = false;
  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    let flag = arg;
    let inline = false;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      flag = arg.slice(0, eq);
      inline = true;
    }
    const mode = blocked[flag];
    if (mode) {
      onBlock?.(flag);
      if (mode === "with-value" && !inline) skipNext = true;
      continue;
    }
    out.push(arg);
  }
  return out;
}
