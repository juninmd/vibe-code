import type { LogStream, WsServerMessage } from "@vibe-code/shared";
import type { ServerWebSocket } from "bun";
import type { Db } from "../db";

export interface WsClient {
  ws: ServerWebSocket<any>;
  subscribedTasks: Set<string>;
  workspaceId: string | null;
}

/** How long to accumulate log events before flushing to clients (ms). */
const LOG_BATCH_MS = 30;

export class BroadcastHub {
  private clients = new Set<WsClient>();
  private taskWorkspaceCache = new Map<string, string | null>();
  private repoWorkspaceCache = new Map<string, string | null>();

  constructor(private db?: Db) {}

  // ─── Log batching ──────────────────────────────────────────────────────────
  // Accumulate agent_log events per task and flush as a single WS message every
  // LOG_BATCH_MS milliseconds. This dramatically reduces WS pressure when an
  // agent emits many lines quickly (e.g. bash output, large file reads).
  private logBatches = new Map<
    string,
    Array<{ runId: string; stream: LogStream; content: string; timestamp: string }>
  >();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  addClient(ws: ServerWebSocket<any>): WsClient {
    const workspaceId = (ws.data as any)?.workspaceId || null;
    const client: WsClient = { ws, subscribedTasks: new Set(), workspaceId };
    this.clients.add(client);
    return client;
  }

  removeClient(client: WsClient): void {
    this.clients.delete(client);
  }

  subscribe(client: WsClient, taskId: string): void {
    client.subscribedTasks.add(taskId);
  }

  unsubscribe(client: WsClient, taskId: string): void {
    client.subscribedTasks.delete(taskId);
  }

  private resolveWorkspaceFromTaskId(taskId: string): string | null {
    if (this.taskWorkspaceCache.has(taskId)) {
      return this.taskWorkspaceCache.get(taskId) ?? null;
    }
    if (!this.db) return null;
    try {
      const row = this.db.raw
        .query(
          "SELECT r.workspace_id FROM tasks t JOIN repositories r ON t.repo_id = r.id WHERE t.id = ?"
        )
        .get(taskId) as { workspace_id: string } | undefined;
      const workspaceId = row?.workspace_id ?? null;
      this.taskWorkspaceCache.set(taskId, workspaceId);
      return workspaceId;
    } catch (err) {
      console.warn(`[BroadcastHub] Failed to resolve workspace for task ${taskId}:`, err);
      return null;
    }
  }

  private resolveWorkspaceFromRepoId(repoId: string): string | null {
    if (this.repoWorkspaceCache.has(repoId)) {
      return this.repoWorkspaceCache.get(repoId) ?? null;
    }
    if (!this.db) return null;
    try {
      const row = this.db.raw
        .query("SELECT workspace_id FROM repositories WHERE id = ?")
        .get(repoId) as { workspace_id: string } | undefined;
      const workspaceId = row?.workspace_id ?? null;
      this.repoWorkspaceCache.set(repoId, workspaceId);
      return workspaceId;
    } catch (err) {
      console.warn(`[BroadcastHub] Failed to resolve workspace for repo ${repoId}:`, err);
      return null;
    }
  }

  private getWorkspaceIdForMessage(message: WsServerMessage): string | null {
    if ("taskId" in message && message.taskId) {
      return this.resolveWorkspaceFromTaskId(message.taskId);
    }
    if (message.type === "task_created" || message.type === "task_updated") {
      if (message.task?.repoId) {
        return this.resolveWorkspaceFromRepoId(message.task.repoId);
      }
    }
    if (message.type === "repo_updated") {
      if (message.repo?.workspaceId) {
        return message.repo.workspaceId;
      }
    }
    if (message.type === "run_updated") {
      if (message.run?.taskId) {
        return this.resolveWorkspaceFromTaskId(message.run.taskId);
      }
    }
    return null;
  }

  /** Broadcast to all connected clients */
  broadcastAll(message: WsServerMessage): void {
    const msgWorkspaceId = this.getWorkspaceIdForMessage(message);
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (
        msgWorkspaceId === null ||
        client.workspaceId === null ||
        client.workspaceId === msgWorkspaceId
      ) {
        try {
          client.ws.send(data);
        } catch {
          // Client disconnected
          this.clients.delete(client);
        }
      }
    }
  }

  /** Broadcast to clients subscribed to a specific task */
  broadcastToTask(taskId: string, message: WsServerMessage): void {
    const msgWorkspaceId = this.getWorkspaceIdForMessage(message);
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.subscribedTasks.has(taskId)) {
        if (
          msgWorkspaceId === null ||
          client.workspaceId === null ||
          client.workspaceId === msgWorkspaceId
        ) {
          try {
            client.ws.send(data);
          } catch {
            this.clients.delete(client);
          }
        }
      }
    }
  }

  /**
   * Enqueue a log line for batched delivery. Logs are flushed every LOG_BATCH_MS
   * as a single `agent_logs_batch` message (or `agent_log` when only 1 item).
   */
  batchLog(
    taskId: string,
    runId: string,
    stream: LogStream,
    content: string,
    timestamp: string
  ): void {
    const batch = this.logBatches.get(taskId) ?? [];
    batch.push({ runId, stream, content, timestamp });
    this.logBatches.set(taskId, batch);

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushLogBatches(), LOG_BATCH_MS);
    }
  }

  /** Flush any pending log batches immediately (e.g. on task completion). */
  flushLogs(taskId: string): void {
    const batch = this.logBatches.get(taskId);
    if (!batch || batch.length === 0) return;
    this.logBatches.delete(taskId);
    this.sendBatch(taskId, batch);
    // If all batches are empty, cancel the pending timer
    if (this.logBatches.size === 0 && this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  private flushLogBatches(): void {
    this.batchTimer = null;
    for (const [taskId, logs] of this.logBatches) {
      this.sendBatch(taskId, logs);
    }
    this.logBatches.clear();
  }

  private sendBatch(
    taskId: string,
    logs: Array<{ runId: string; stream: LogStream; content: string; timestamp: string }>
  ): void {
    if (logs.length === 0) return;
    if (logs.length === 1) {
      this.broadcastToTask(taskId, {
        type: "agent_log",
        runId: logs[0].runId,
        taskId,
        stream: logs[0].stream,
        content: logs[0].content,
        timestamp: logs[0].timestamp,
      });
    } else {
      this.broadcastToTask(taskId, { type: "agent_logs_batch", taskId, logs });
    }
  }
}
