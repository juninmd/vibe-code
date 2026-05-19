// Ported from multica packages/views/common/task-transcript/agent-transcript-dialog.tsx
// (getEventSummary + shortenPath). Single source of truth for one-line previews
// of agent events so timeline, accordions and transcripts read consistent.

/**
 * Truncate a path to its last two segments prefixed with `.../` when it has
 * more than 3 segments. Keeps tooltip-style previews readable without losing
 * the most identifying portion (filename + parent directory).
 *
 * `a.ts` → `a.ts`
 * `src/main.ts` → `src/main.ts`
 * `packages/server/src/agents/engines/opencode.ts` → `.../engines/opencode.ts`
 */
export function shortenPath(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return parts.join("/");
  return `.../${parts.slice(-2).join("/")}`;
}

/**
 * Extract a one-line preview from a tool's input payload using the fallback
 * chain multica settled on. The order is the result of trial-and-error
 * against many agent tool schemas — `query`/`pattern` first because they're
 * unambiguously human-readable; commands and prompts are truncated at 120
 * chars to fit in a single timeline row.
 */
export function summarizeToolInput(input: Record<string, unknown> | null | undefined): string {
  if (!input) return "";
  const s = (k: string): string | null => {
    const v = input[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  const query = s("query") ?? s("pattern") ?? s("glob") ?? s("search");
  if (query) return query;
  const path = s("file_path") ?? s("path") ?? s("filename") ?? s("file");
  if (path) return shortenPath(path);
  const desc = s("description");
  if (desc) return desc;
  const cmd = s("command") ?? s("cmd");
  if (cmd) return cmd.length > 120 ? `${cmd.slice(0, 120)}...` : cmd;
  const prompt = s("prompt");
  if (prompt) return prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt;
  const skill = s("skill") ?? s("name");
  if (skill) return skill;
  const url = s("url");
  if (url) return url;
  // Final fallback: first short string field.
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.length > 0 && v.length < 120) return v;
  }
  return "";
}
