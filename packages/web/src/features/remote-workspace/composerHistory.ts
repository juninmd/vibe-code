// Prompt recall and per-session drafts (ideas from Paseo composer/recall and draft, Apache-2.0).
const HISTORY_KEY = "rw-prompt-history";
const DRAFTS_KEY = "rw-drafts";
export const HISTORY_LIMIT = 50;
const DRAFT_LIMIT = 30;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: recall and drafts are conveniences, not data.
  }
}

/** Newest first, without duplicates or blanks. */
export function recordPrompt(history: string[], prompt: string, limit = HISTORY_LIMIT): string[] {
  const text = prompt.trim();
  if (!text) return history;
  return [text, ...history.filter((item) => item !== text)].slice(0, limit);
}

/**
 * Moves through history: -1 is the live draft, 0 the newest prompt.
 * Returns the new position and the text to show, or null at either end.
 */
export function stepHistory(
  history: string[],
  position: number,
  direction: "older" | "newer",
  liveDraft: string
): { position: number; text: string } | null {
  const next = direction === "older" ? position + 1 : position - 1;
  if (next < -1 || next >= history.length) return null;
  return { position: next, text: next === -1 ? liveDraft : history[next] };
}

/** Only recall when the caret sits on the first/last line, so multi-line editing keeps arrows. */
export function caretAtEdge(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "older" | "newer"
): boolean {
  if (selectionStart !== selectionEnd) return false;
  return direction === "older"
    ? !value.slice(0, selectionStart).includes("\n")
    : !value.slice(selectionEnd).includes("\n");
}

export const promptHistory = {
  load: () => read<string[]>(HISTORY_KEY, []).filter((item) => typeof item === "string"),
  save: (history: string[]) => write(HISTORY_KEY, history),
};

/** Keeps the most recently edited drafts so storage stays bounded. */
export function pruneDrafts(drafts: Record<string, string>, limit = DRAFT_LIMIT) {
  const entries = Object.entries(drafts).filter(([, text]) => text.trim());
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - limit)));
}

export const draftStore = {
  load: () => read<Record<string, string>>(DRAFTS_KEY, {}),
  save: (drafts: Record<string, string>) => write(DRAFTS_KEY, pruneDrafts(drafts)),
};
