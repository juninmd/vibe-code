import type { LogStream } from "@vibe-code/shared";
import type { Db } from "../../db";
import { sanitizeRunForExternal } from "../../security/access-control";
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
  const emitExecutionEvent = (
    payload: Omit<
      import("@vibe-code/shared").ExecutionTimelineEvent,
      "id" | "runId" | "taskId" | "timestamp"
    >
  ) => {
    const event = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      runId,
      taskId,
      timestamp: new Date().toISOString(),
      ...payload,
    };
    hub.broadcastToTask(taskId, {
      type: "execution_event",
      taskId,
      runId,
      event,
    });
  };

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
    emitExecutionEvent({
      type: "log",
      content: event.content,
      metadata: { stream },
    });
  } else if (event.type === "error" && event.content) {
    db.logs.create(runId, "stderr", event.content);
    logAgentEvent(taskId, "stderr", event.content);
    hub.batchLog(taskId, runId, "stderr", event.content, new Date().toISOString());
    emitExecutionEvent({
      type: "log",
      content: event.content,
      metadata: { stream: "stderr" },
    });
  } else if (event.type === "status" && event.content) {
    const run = db.runs.getById(runId);
    if (run) {
      const updated = db.runs.updateStatus(runId, run.status, {
        current_status: event.content,
      });
      if (updated) {
        hub.broadcastAll({ type: "run_updated", run: sanitizeRunForExternal(db, updated) });
      }
    }
    emitExecutionEvent({
      type: "status",
      content: event.content,
    });
  } else if (event.type === "cost" && event.costStats) {
    db.runs.updateCostStats(runId, event.costStats);
    const run = db.runs.getById(runId);
    if (run) {
      hub.broadcastAll({
        type: "run_updated",
        run: sanitizeRunForExternal(db, { ...run, costStats: event.costStats }),
      });
    }
    emitExecutionEvent({
      type: "cost",
      costStats: event.costStats,
    });
  } else if (event.type === "session" && event.sessionId) {
    db.runs.updateSessionId(runId, event.sessionId);
    const run = db.runs.getById(runId);
    if (run) {
      hub.broadcastAll({ type: "run_updated", run: sanitizeRunForExternal(db, run) });
    }
  } else if (event.type === "tool_use" && event.toolUse) {
    onActivity?.();
    const ts = new Date().toISOString();
    hub.broadcastToTask(taskId, {
      type: "agent_tool_use",
      runId,
      taskId,
      toolId: event.toolUse.toolId,
      toolName: event.toolUse.toolName,
      parameters: event.toolUse.parameters,
      timestamp: ts,
    });
    emitExecutionEvent({
      type: "tool_use",
      toolId: event.toolUse.toolId,
      toolName: event.toolUse.toolName,
      metadata: { parameters: event.toolUse.parameters },
    });
  } else if (event.type === "tool_result" && event.toolResult) {
    const ts = new Date().toISOString();
    hub.broadcastToTask(taskId, {
      type: "agent_tool_result",
      runId,
      taskId,
      toolId: event.toolResult.toolId,
      output: event.toolResult.output,
      status: event.toolResult.status ?? "success",
      timestamp: ts,
    });
    emitExecutionEvent({
      type: "tool_result",
      toolId: event.toolResult.toolId,
      toolStatus: event.toolResult.status ?? "success",
      content: event.toolResult.output,
    });
  }
}
