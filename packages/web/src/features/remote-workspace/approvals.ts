// Supervised mode and approval cards (ideas from T3 Code's approval mode, MIT).
import { SUPERVISED_TAG } from "@vibe-code/shared";

const LABELS: Record<string, string> = {
  edit: "Editar arquivo",
  bash: "Rodar comando",
  webfetch: "Acessar a web",
  external_directory: "Sair do workspace",
};

export function permissionLabel(permission: string): string {
  return LABELS[permission] ?? `Usar ${permission}`;
}

/** Tags with the supervised flag set or cleared, keeping every other tag. */
export function withSupervised(tags: readonly string[], supervised: boolean): string[] {
  const rest = tags.filter((tag) => tag !== SUPERVISED_TAG);
  return supervised ? [...rest, SUPERVISED_TAG] : rest;
}

/** Diff lines with a kind, so the card can color them without parsing twice. */
export function diffLines(
  diff: string,
  limit = 80
): { kind: "add" | "del" | "meta" | "ctx"; text: string }[] {
  return diff
    .split("\n")
    .filter((line) => !line.startsWith("Index:") && !/^={3,}/.test(line))
    .slice(0, limit)
    .map((text) => ({
      kind:
        text.startsWith("+++") || text.startsWith("---") || text.startsWith("@@")
          ? "meta"
          : text.startsWith("+")
            ? "add"
            : text.startsWith("-")
              ? "del"
              : "ctx",
      text,
    }));
}
