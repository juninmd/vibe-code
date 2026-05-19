import type { AgentLog } from "@vibe-code/shared";

// Ported from multica packages/views/chat/components/task-status-pill.tsx.
// Derives a semantic label ("Thinking", "Reading files", "Running command")
// from the latest meaningful agent log so the operator can tell at a glance
// what the agent is *currently* doing — not just "running".

export type TaskStageKey =
  | "queued"
  | "starting_up"
  | "thinking"
  | "typing"
  | "running_command"
  | "reading_files"
  | "searching_code"
  | "making_edits"
  | "searching_web"
  | "git_operation"
  | "working";

export interface TaskStage {
  key: TaskStageKey;
  label: string;
  /** When true, omit the spinner (terminal / non-progress state). */
  static?: boolean;
}

const LABELS: Record<TaskStageKey, string> = {
  queued: "Queued",
  starting_up: "Starting up",
  thinking: "Thinking",
  typing: "Replying",
  running_command: "Running command",
  reading_files: "Reading files",
  searching_code: "Searching code",
  making_edits: "Making edits",
  searching_web: "Fetching web",
  git_operation: "Git operation",
  working: "Working",
};

// Maps the OpenCode-humanized prefix or tool keyword to a stage key. Order
// matters: more specific matches first.
function stageFromContent(content: string): TaskStageKey | null {
  if (!content) return null;
  const c = content.trim();
  if (/^💭|^Thinking|^\[Thinking\]/.test(c)) return "thinking";
  if (/^Running:|^\[bash\]/i.test(c)) return "running_command";
  if (/^Reading|\[read\]|view_file/i.test(c)) return "reading_files";
  if (/^Searching|\[grep\]|\[glob\]/i.test(c)) return "searching_code";
  if (/^Writing|^Editing|\[edit\]|\[write\]/i.test(c)) return "making_edits";
  if (/^Fetching|\[web\]/i.test(c)) return "searching_web";
  if (/^Git:|\[git\]/i.test(c)) return "git_operation";
  return null;
}

/**
 * Decide the current stage from the status string and the tail of the log
 * buffer. `taskStatus` reflects the orchestrator's view; logs provide the
 * fine-grained "what's happening this second" signal.
 *
 * Logs are scanned from the tail backwards; system heartbeats ("Still running")
 * and stderr noise are skipped so the pill doesn't flicker between
 * meaningful messages.
 */
export function pickTaskStage(taskStatus: string | undefined, logs: AgentLog[]): TaskStage {
  if (taskStatus === "queued" || taskStatus === "scheduled") {
    return { key: "queued", label: LABELS.queued };
  }
  if (taskStatus === "dispatched" || (taskStatus === "in_progress" && logs.length === 0)) {
    return { key: "starting_up", label: LABELS.starting_up };
  }

  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i]!;
    if (log.stream === "stderr") continue;
    const isHeartbeat = log.stream === "system" && /Still running|heartbeat/i.test(log.content);
    if (isHeartbeat) continue;
    const stage = stageFromContent(log.content);
    if (stage) return { key: stage, label: LABELS[stage] };
    // If there's stdout text but no recognizable prefix, treat as "Replying".
    if (log.stream === "stdout" && log.content.trim().length > 0) {
      return { key: "typing", label: LABELS.typing };
    }
  }

  return { key: "thinking", label: LABELS.thinking };
}
