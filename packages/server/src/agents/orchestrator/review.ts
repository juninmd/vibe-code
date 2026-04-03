import type { AgentRun, LogStream, Task } from "@vibe-code/shared";
import type { Db } from "../../db";
import type { BroadcastHub } from "../../ws/broadcast";
import { PERSONA_LABELS, type ReviewPersona, runPersonaReview } from "../engines/reviewer";

const ALL_PERSONAS: ReviewPersona[] = ["frontend", "backend", "security", "quality"];
export const REVIEW_ENABLED = process.env.VIBE_CODE_REVIEW_ENABLED !== "false";
// Set VIBE_CODE_REVIEW_STRICT=true to block PR on review failures (default: advisory only)
export const REVIEW_STRICT = process.env.VIBE_CODE_REVIEW_STRICT === "true";

export async function runReviewPipeline(
  task: Task,
  run: AgentRun,
  wtPath: string,
  defaultBranch: string,
  db: Db,
  hub: BroadcastHub,
  sysLog: (runId: string, taskId: string, content: string) => void
): Promise<string[]> {
  sysLog(run.id, task.id, "Starting review pipeline (4 agents)...");

  const results = await Promise.all(
    ALL_PERSONAS.map((persona) =>
      runPersonaReview({
        persona,
        worktreePath: wtPath,
        taskTitle: task.title,
        taskDescription: task.description,
        defaultBranch,
      })
    )
  );

  const blockers: string[] = [];

  for (const result of results) {
    const label = PERSONA_LABELS[result.persona];
    const header = `[REVIEW:${result.persona}] ${label} Review`;
    const separator = "─".repeat(50);

    // Log header + content as review stream
    reviewLog(run.id, task.id, `${header}\n${separator}`, db, hub);
    for (const line of result.content.split("\n")) {
      reviewLog(run.id, task.id, line, db, hub);
    }
    reviewLog(run.id, task.id, separator, db, hub);

    if (result.hasBlocker) {
      const blockerLines = result.content
        .split("\n")
        .filter((l) => l.startsWith("BLOCKER:"))
        .map((l) => `[${label}] ${l}`);
      blockers.push(...blockerLines);
    }
  }

  if (blockers.length === 0) {
    sysLog(run.id, task.id, "Review pipeline passed — no blockers found.");
  } else {
    sysLog(run.id, task.id, `Review pipeline failed — ${blockers.length} blocker(s) found.`);
  }

  return blockers;
}

/** Broadcast and persist a review log line. */
function reviewLog(
  runId: string,
  taskId: string,
  content: string,
  db: Db,
  hub: BroadcastHub
): void {
  db.logs.create(runId, "review", content);
  hub.broadcastToTask(taskId, {
    type: "agent_log",
    runId,
    taskId,
    stream: "review" as LogStream,
    content,
    timestamp: new Date().toISOString(),
  });
}
