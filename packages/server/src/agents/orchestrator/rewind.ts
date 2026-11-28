import type { Db } from "../../db";
import { CheckpointConflict, restoreCheckpoint } from "./checkpoints";

export type RewindOutcome =
  | { ok: true; rewound: string[]; message: string }
  | { ok: false; status: 400 | 404 | 409; error: string; message: string };

/**
 * Rewinds a conversational session to just before `runId`: the worktree goes back to that
 * turn's checkpoint and the turn plus everything after it leave the conversation. The next
 * message starts a fresh agent session with the remaining transcript.
 */
export async function rewindSession(db: Db, taskId: string, runId: string): Promise<RewindOutcome> {
  const runs = db.runs.listByTask(taskId); // newest first
  const index = runs.findIndex((run) => run.id === runId);
  const target = runs[index];
  if (!target) return { ok: false, status: 404, error: "not_found", message: "Turn not found" };
  if (index === runs.length - 1)
    return {
      ok: false,
      status: 400,
      error: "first_turn",
      message: "The first turn starts the session; start a new session instead.",
    };
  if (target.rewoundAt)
    return {
      ok: false,
      status: 409,
      error: "already_rewound",
      message: "This turn was already undone.",
    };
  if (!target.checkpoint || !target.worktreePath)
    return {
      ok: false,
      status: 409,
      error: "no_checkpoint",
      message: "This turn has no checkpoint to go back to.",
    };
  try {
    await restoreCheckpoint(target.worktreePath, target.checkpoint);
  } catch (error) {
    if (error instanceof CheckpointConflict)
      return { ok: false, status: 409, error: "checkpoint_conflict", message: error.message };
    throw error;
  }
  const rewound = runs
    .slice(0, index + 1)
    .filter((run) => !run.rewoundAt)
    .map((run) => run.id);
  db.runs.markRewound(rewound);
  const message = db.logs.listByRun(target.id).find((log) => log.stream === "stdin")?.content ?? "";
  return { ok: true, rewound, message };
}
