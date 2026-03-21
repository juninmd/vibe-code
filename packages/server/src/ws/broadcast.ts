import type { WsServerMessage } from "@vibe-code/shared";
import type { ServerWebSocket } from "bun";

export interface WsClient {
  ws: ServerWebSocket<unknown>;
  subscribedTasks: Set<string>;
}

export class BroadcastHub {
  private clients = new Set<WsClient>();

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
}
