import type { AgentLog, TaskWithRun } from "@vibe-code/shared";

export type ChatItem =
  | { kind: "prompt"; id: string; text: string; timestamp: string }
  | { kind: "assistant"; id: string; text: string; timestamp: string }
  | { kind: "error"; id: string; text: string; timestamp: string }
  | { kind: "system"; id: string; text: string; timestamp: string };

// ANSI CSI escape sequences, built from a string so no literal control
// character appears in the source.
const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/** Remove ANSI color/cursor escapes so text can be rendered as markdown. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

const MAX_ITEMS = 500;

function toSort(timestamp: string | null | undefined): number {
  if (!timestamp) return 0;
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Fold a task plus its streamed logs into an ordered chat transcript.
 *
 * Consecutive log lines of the same stream collapse into one bubble so the
 * transcript reads like a conversation instead of one bubble per stdout line.
 */
export function buildChatItems(
  task: Pick<TaskWithRun, "id" | "description" | "goal" | "createdAt" | "title">,
  logs: AgentLog[]
): ChatItem[] {
  const items: ChatItem[] = [];

  const prompt = (task.description ?? "").trim() || (task.goal ?? "").trim();
  if (prompt) {
    items.push({
      kind: "prompt",
      id: `prompt-${task.id}`,
      text: prompt,
      timestamp: task.createdAt ?? new Date(0).toISOString(),
    });
  }

  const ordered = logs
    .map((log, index) => ({ log, index, sort: toSort(log.timestamp) }))
    .sort((a, b) => a.sort - b.sort || a.index - b.index);

  let buffer: { kind: "assistant" | "error"; lines: string[]; timestamp: string } | null = null;
  let counter = 0;

  const flush = () => {
    if (!buffer) return;
    const text = buffer.lines.join("\n").trim();
    if (text) {
      items.push({
        kind: buffer.kind,
        id: `item-${counter++}`,
        text,
        timestamp: buffer.timestamp,
      });
    }
    buffer = null;
  };

  const push = (item: ChatItem) => {
    flush();
    items.push(item);
  };

  for (const { log } of ordered) {
    const content = stripAnsi(log.content ?? "").replace(/\s+$/, "");
    if (!content.trim()) continue;

    switch (log.stream) {
      case "stdout": {
        if (buffer && buffer.kind !== "assistant") flush();
        buffer ??= { kind: "assistant", lines: [], timestamp: log.timestamp };
        buffer.lines.push(content);
        break;
      }
      case "stderr": {
        if (buffer && buffer.kind !== "error") flush();
        buffer ??= { kind: "error", lines: [], timestamp: log.timestamp };
        buffer.lines.push(content);
        break;
      }
      default: {
        // system / review / stdin are discrete notices, never merged.
        push({
          kind: "system",
          id: `sys-${counter++}`,
          text: content,
          timestamp: log.timestamp,
        });
      }
    }
  }
  flush();

  return items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items;
}

/** Short human label for a session row. */
export function sessionLabel(task: Pick<TaskWithRun, "title" | "description">): string {
  const title = task.title?.trim();
  if (title) return title;
  const first = (task.description ?? "").split(/\r?\n/).find((line) => line.trim());
  return first?.trim().slice(0, 80) || "Untitled session";
}
