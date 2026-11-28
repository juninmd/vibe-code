// Command registry and shortcut matching (ideas from T3 Code keybindings and Paseo Command Center).
export type CommandSection = "Ações" | "Navegação" | "Sessões";
const SECTIONS: CommandSection[] = ["Ações", "Navegação", "Sessões"];
export interface Command {
  id: string;
  section: CommandSection;
  title: string;
  /** Extra words that should find the command, e.g. the project name. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

/** Shortcuts shown in the palette and handled globally. `mod` is ⌘ on Apple, Ctrl elsewhere. */
export const SHORTCUTS = {
  palette: "mod+k",
  newSession: "mod+shift+o",
  conversation: "alt+1",
  terminal: "alt+2",
  changes: "alt+3",
  context: "mod+.",
  help: "shift+?",
} as const;

const isApple = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function matchShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  shortcut: string,
  apple = isApple()
): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const wants = new Set(parts.slice(0, -1));
  const mod = apple ? event.metaKey : event.ctrlKey;
  if (wants.has("mod") !== mod) return false;
  if (wants.has("alt") !== event.altKey) return false;
  if (wants.has("shift") !== event.shiftKey) return false;
  // Ctrl on Apple / Meta elsewhere are never part of our shortcuts.
  if ((apple ? event.ctrlKey : event.metaKey) && !wants.has("mod")) return false;
  // Alt changes `key` on macOS (alt+1 → "¡"), so digits match on the physical code.
  if (/^\d$/.test(key)) return event.code === `Digit${key}`;
  return event.key.toLowerCase() === key;
}

export function formatShortcut(shortcut: string, apple = isApple()): string {
  const names: Record<string, string> = apple
    ? { mod: "⌘", shift: "⇧", alt: "⌥" }
    : { mod: "Ctrl", shift: "Shift", alt: "Alt" };
  return shortcut
    .split("+")
    .map((part) => names[part] ?? part.toUpperCase())
    .join(apple ? "" : "+");
}

/** True when keys typed should go to a field, not to plain-key shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Every query word must appear; titles that start with the query rank first. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length)
    return commands
      .map((command, index) => ({ command, index }))
      .sort(
        (a, b) =>
          SECTIONS.indexOf(a.command.section) - SECTIONS.indexOf(b.command.section) ||
          a.index - b.index
      )
      .map((hit) => hit.command);
  const q = words.join(" ");
  return commands
    .map((command, index) => {
      const title = normalize(command.title);
      const haystack = `${title} ${normalize(command.keywords ?? "")} ${normalize(command.section)}`;
      if (!words.every((word) => haystack.includes(word))) return null;
      const rank = title.startsWith(q) ? 0 : title.includes(q) ? 1 : 2;
      return { command, rank, index };
    })
    .filter((hit): hit is { command: Command; rank: number; index: number } => hit !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((hit) => hit.command);
}
