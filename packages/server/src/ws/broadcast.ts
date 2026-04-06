import type { LogStream, WsServerMessage } from "@vibe-code/shared";
import type { ServerWebSocket } from "bun";

export interface WsClient {
  ws: ServerWebSocket<unknown>;
  subscribedTasks: Set<string>;
}

/** How long to accumulate log events before flushing to clients (ms). */
const LOG_BATCH_MS = 30;

export class BroadcastHub {
  private clients = new Set<WsClient>();

  // ─── Log batching ──────────────────────────────────────────────────────────
  // Accumulate agent_log events per task and flush as a single WS message every
  // LOG_BATCH_MS milliseconds. This dramatically reduces WS pressure when an
  // agent emits many lines quickly (e.g. bash output, large file reads).
  private logBatches = new Map<
    string,
    Array<{ runId: string; stream: LogStream; content: string; timestamp: string }>
  >();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  addClient(ws: ServerWebSocket<unknown>): WsClient {
    const client: WsClient = { ws, subscribedTasks: new Set() };
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

  /** Broadcast to all connected clients */
  broadcastAll(message: WsServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      try {
        client.ws.send(data);
      } catch {
        // Client disconnected
        this.clients.delete(client);
      }
    }
  }

  /** Broadcast to clients subscribed to a specific task */
  broadcastToTask(taskId: string, message: WsServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.subscribedTasks.has(taskId)) {
        try {
          client.ws.send(data);
        } catch {
          this.clients.delete(client);
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
