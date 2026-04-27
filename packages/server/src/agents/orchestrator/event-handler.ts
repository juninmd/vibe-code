import type { LogStream } from "@vibe-code/shared";
import type { Db } from "../../db";
import type { BroadcastHub } from "../../ws/broadcast";
import type { AgentEvent } from "../engine";
import { logAgentEvent } from "./terminal-logger";

export async function handleAgentEvent(
  event: AgentEvent,
  runId: string,
  taskId: string,
  db: Db,
  hub: BroadcastHub,
  onActivity?: () => void
): Promise<void> {
  if (
    (event.type === "log" ||
      event.type === "error" ||
      event.type === "status" ||
      event.type === "cost") &&
    event.content
  ) {
    onActivity?.();
  }

  if (event.type === "log" && event.content) {
    const stream = (event.stream ?? "stdout") as LogStream;
    db.logs.create(runId, stream, event.content);
    logAgentEvent(taskId, stream, event.content);
    hub.batchLog(taskId, runId, stream, event.content, new Date().toISOString());
  } else if (event.type === "error" && event.content) {
    db.logs.create(runId, "stderr", event.content);
    logAgentEvent(taskId, "stderr", event.content);
    hub.batchLog(taskId, runId, "stderr", event.content, new Date().toISOString());
  } else if (event.type === "status" && event.content) {
    const run = db.runs.getById(runId);
    if (run) {
      const updated = db.runs.updateStatus(runId, run.status, {
        current_status: event.content,
      });
      if (updated) {
        hub.broadcastAll({ type: "run_updated", run: updated });
      }
    }
  } else if (event.type === "cost" && event.costStats) {
    db.runs.updateCostStats(runId, event.costStats);
    const run = db.runs.getById(runId);
    if (run) {
      hub.broadcastAll({ type: "run_updated", run: { ...run, costStats: event.costStats } });
    }
  }
}
