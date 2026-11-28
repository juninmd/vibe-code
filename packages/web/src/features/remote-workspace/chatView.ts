// Turn grouping, relative times, scroll anchoring and composer sizing for the
// conversation view (timeline ideas from T3 Code's WorkLog/useTimelineFollow, MIT).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How close to the bottom still counts as "following the conversation". */
export const FOLLOW_SLACK = 80;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface TimelineMessage {
  id: string;
  role: "user" | "assistant";
  /** Set on the divider that marks an engine takeover. */
  handoff?: unknown;
}

export type TurnRole = "user" | "assistant" | "handoff";
export interface Turn<T extends TimelineMessage> {
  key: string;
  role: TurnRole;
  messages: T[];
}

/**
 * One user prompt plus every reply that followed it become a turn, so repeated
 * assistant segments (prose, work log, prose) read as one answer instead of
 * separate bubbles. A handoff divider always stands on its own.
 */
export function groupTurns<T extends TimelineMessage>(messages: T[]): Turn<T>[] {
  const turns: Turn<T>[] = [];
  for (const message of messages) {
    const role: TurnRole = message.handoff ? "handoff" : message.role;
    const last = turns[turns.length - 1];
    if (role === "assistant" && last?.role === "assistant") last.messages.push(message);
    else turns.push({ key: message.id, role, messages: [message] });
  }
  return turns;
}

/** "agora", "há 4 min", "há 2 h", "há 3 d", then the calendar date. */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  const diff = now - value;
  if (diff < MINUTE) return "agora";
  if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;
  if (diff < 7 * DAY) return `há ${Math.floor(diff / DAY)} d`;
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Full timestamp for the tooltip behind a relative time. */
export function absoluteTime(iso: string | undefined): string {
  if (!iso) return "";
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function isAtBottom(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  slack = FOLLOW_SLACK
): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}

/** New messages arrived while the reader was scrolled up. */
export function hasNewContent(behind: boolean, previousCount: number, count: number): boolean {
  return behind && count > previousCount;
}

/** Keeps the textarea between its resting height and the viewport cap. */
export function fitComposerHeight(measured: number, max: number, min = 46): number {
  const ceiling = Math.max(min, max);
  return Math.min(Math.max(measured, min), ceiling);
}
