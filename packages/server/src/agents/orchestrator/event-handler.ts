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
    (event.type === "log" || event.type === "error" || event.type === "status") &&
    event.content
  ) {
    onActivity?.();
  }

  if (event.type === "log" && event.content) {
    const stream = (event.stream ?? "stdout") as LogStream;
    db.logs.create(runId, stream, event.content);
    // Log to server terminal in real-time
    logAgentEvent(taskId, stream, event.content);
    // Only broadcast to clients subscribed to this task
    hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId,
      taskId,
      stream,
      content: event.content,
      timestamp: new Date().toISOString(),
    });
  } else if (event.type === "error" && event.content) {
    db.logs.create(runId, "stderr", event.content);
    logAgentEvent(taskId, "stderr", event.content);
    hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId,
      taskId,
      stream: "stderr",
      content: event.content,
      timestamp: new Date().toISOString(),
    });
  } else if (event.type === "status" && event.content) {
    // Status updates go to all clients (kanban board reflects live status)
    const run = db.runs.getById(runId);
    if (run) {
      const updated = db.runs.updateStatus(runId, run.status, {
        current_status: event.content,
      });
      if (updated) {
        hub.broadcastAll({ type: "run_updated", run: updated });
      }
    }
  }
}
