// Engine handoff mid-conversation (idea from T3 Code's provider handoff, MIT): the new
// engine starts a fresh CLI session, so it gets the conversation so far as context.

export interface HandoffLog {
  stream: string;
  content: string;
}

const TOOL_LINE = /^\s{2,}\S/;
const DEFAULT_LIMIT = 12_000;

/** User turns and the agent's prose, oldest first, trimmed from the start to fit `limit`. */
export function handoffTranscript(logs: HandoffLog[], limit = DEFAULT_LIMIT): string {
  const turns: { role: "Usuário" | "Agente"; text: string }[] = [];
  for (const log of logs) {
    const role = log.stream === "stdin" ? "Usuário" : log.stream === "stdout" ? "Agente" : null;
    if (!role) continue;
    const text = log.content
      .split("\n")
      .filter((line) => role === "Usuário" || !TOOL_LINE.test(line))
      .join("\n")
      .trim();
    if (!text) continue;
    const last = turns.at(-1);
    if (last?.role === role) last.text += `\n${text}`;
    else turns.push({ role, text });
  }
  const blocks = turns.map((turn) => `${turn.role}: ${turn.text}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (size + blocks[i].length > limit) {
      // A single turn over the limit still hands over its most recent part.
      if (!kept.length) kept.unshift(`…${blocks[i].slice(-limit)}`);
      break;
    }
    kept.unshift(blocks[i]);
    size += blocks[i].length + 2;
  }
  if (kept.length < blocks.length) kept.unshift("[início da conversa omitido]");
  return kept.join("\n\n");
}

/** Without `fromEngine`, the operator rewound the conversation and this session restarts from there. */
export function handoffPreamble(transcript: string, fromEngine?: string): string {
  return [
    fromEngine
      ? `This conversation started with another coding agent (${fromEngine}). You are taking over in the same workspace; its edits are already on disk.`
      : "The user rewound this conversation to an earlier point: later turns were discarded and the workspace files were restored to how they were then.",
    "Conversation so far (oldest first):",
    transcript || "(no messages yet)",
    "Continue from here with the user's new message below.",
  ].join("\n\n");
}
