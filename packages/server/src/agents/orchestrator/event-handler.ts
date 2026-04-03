import type { LogStream } from "@vibe-code/shared";
import type { Db } from "../../db";
import type { BroadcastHub } from "../../ws/broadcast";
import type { AgentEvent } from "../engine";

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
    db.logs.create(runId, event.stream ?? "stdout", event.content);
    hub.broadcastAll({
      type: "agent_log",
      runId,
      taskId,
      stream: (event.stream ?? "stdout") as LogStream,
      content: event.content,
      timestamp: new Date().toISOString(),
    });
  } else if (event.type === "error" && event.content) {
    db.logs.create(runId, "stderr", event.content);
    hub.broadcastAll({
      type: "agent_log",
      runId,
      taskId,
      stream: "stderr",
      content: event.content,
      timestamp: new Date().toISOString(),
    });
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
  }
}
