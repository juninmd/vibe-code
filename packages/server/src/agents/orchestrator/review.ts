import type { AgentRun, LogStream, Task } from "@vibe-code/shared";
import type { Db } from "../../db";
import type { BroadcastHub } from "../../ws/broadcast";
import { PERSONA_LABELS, type ReviewPersona, runPersonaReview } from "../engines/reviewer";

const ALL_PERSONAS: ReviewPersona[] = ["frontend", "backend", "security", "quality", "docs"];
export const REVIEW_ENABLED = process.env.VIBE_CODE_REVIEW_ENABLED !== "false";
// Set VIBE_CODE_REVIEW_STRICT=true to block PR on review failures (default: advisory only)
export const REVIEW_STRICT = process.env.VIBE_CODE_REVIEW_STRICT === "true";

export interface ReviewPipelineResult {
  blockers: string[];
  actionableFindings: string[];
  docsFindings: string[];
}

export async function runReviewPipeline(
  task: Task,
  run: AgentRun,
  wtPath: string,
  defaultBranch: string,
  db: Db,
  hub: BroadcastHub,
  sysLog: (runId: string, taskId: string, content: string) => void,
  reviewEngine?: string,
  reviewModel?: string,
  litellmKey?: string,
  litellmBaseUrl?: string,
  nativeApiKeys?: { gemini?: string; anthropic?: string }
): Promise<ReviewPipelineResult> {
  sysLog(run.id, task.id, `Starting review pipeline (${ALL_PERSONAS.length} parallel agents)...`);

  const reviewPromises = ALL_PERSONAS.map((persona) =>
    runPersonaReview({
      persona,
      worktreePath: wtPath,
      taskTitle: task.title,
      taskDescription: task.description,
      defaultBranch,
      reviewEngine,
      reviewModel,
      litellmKey: litellmKey ?? "",
      litellmBaseUrl: litellmBaseUrl ?? "http://localhost:4000",
      nativeGeminiKey: nativeApiKeys?.gemini,
      nativeAnthropicKey: nativeApiKeys?.anthropic,
    })
  );
  const results = await Promise.all(reviewPromises);

  // Keep deterministic reporting order regardless of completion order.
  const personaOrder = new Map(ALL_PERSONAS.map((persona, idx) => [persona, idx]));
  results.sort((a, b) => {
    const left = personaOrder.get(a.persona) ?? Number.MAX_SAFE_INTEGER;
    const right = personaOrder.get(b.persona) ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });

  const blockers: string[] = [];
  const actionableFindings: string[] = [];
  const docsFindings: string[] = [];

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

    const actionableLines = result.content
      .split("\n")
      .filter(
        (l) =>
          (l.startsWith("WARNING:") || l.startsWith("INFO:")) &&
          !l.includes("[reviewer:") &&
          !l.includes(":stderr")
      )
      .map((l) => `[${label}] ${l}`);
    if (result.persona === "docs") {
      docsFindings.push(...actionableLines);
    } else {
      actionableFindings.push(...actionableLines);
    }
  }

  if (blockers.length === 0) {
    sysLog(run.id, task.id, "Review pipeline passed — no blockers found.");
  } else {
    sysLog(run.id, task.id, `Review pipeline finished with ${blockers.length} blocker(s).`);
  }

  return {
    blockers,
    actionableFindings,
    docsFindings,
  };
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
