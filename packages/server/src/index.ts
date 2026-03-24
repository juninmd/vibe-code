import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBunWebSocket } from "hono/bun";
import { join } from "path";
import { homedir } from "os";

import { createDb } from "./db";
import { createReposRouter } from "./api/repos";
import { createTasksRouter } from "./api/tasks";
import { createRunsRouter } from "./api/runs";
import { createEnginesRouter } from "./api/engines";
import { createSettingsRouter } from "./api/settings";
import { GitService } from "./git/git-service";
import { EngineRegistry } from "./agents/registry";
import { Orchestrator } from "./agents/orchestrator";
import { BroadcastHub } from "./ws/broadcast";
import { PrPoller } from "./git/pr-poller";
import type { WsClientMessage } from "@vibe-code/shared";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.VIBE_CODE_DATA_DIR || join(homedir(), ".vibe-code");
const DB_PATH = join(DATA_DIR, "vibe-code.db");
const MAX_AGENTS = Number(process.env.VIBE_CODE_MAX_AGENTS) || 4;

// ─── Initialize Services ────────────────────────────────────────────────────

import { mkdir } from "fs/promises";
await mkdir(DATA_DIR, { recursive: true });

const db = createDb(DB_PATH);
const git = new GitService(DATA_DIR);
const registry = new EngineRegistry();
const hub = new BroadcastHub();
const orchestrator = new Orchestrator(db, git, registry, hub, MAX_AGENTS);

await git.init();

const prPoller = new PrPoller(db, hub);
prPoller.start();

// ─── Hono App ────────────────────────────────────────────────────────────────

const { upgradeWebSocket, websocket } = createBunWebSocket();

const app = new Hono();

// Middleware
app.use("/api/*", cors({ origin: "*" }));

// REST Routes
app.route("/api/repos", createReposRouter(db, git, hub));
app.route("/api/tasks", createTasksRouter(db, orchestrator, git));
app.route("/api/runs", createRunsRouter(db));
app.route("/api/engines", createEnginesRouter(registry));
app.route("/api/settings", createSettingsRouter(db));

// Health check
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    activeAgents: orchestrator.activeCount,
    maxAgents: MAX_AGENTS,
  });
});

// WebSocket
const wsClients = new Map<unknown, ReturnType<BroadcastHub["addClient"]>>();

app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      const rawWs = (ws as any).raw;
      const client = hub.addClient(rawWs);
      wsClients.set(ws, client);
    },
    onMessage(evt, ws) {
      try {
        const msg: WsClientMessage = JSON.parse(
          typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer)
        );
        const client = wsClients.get(ws);
        if (!client) return;

        if (msg.type === "subscribe") {
          hub.subscribe(client, msg.taskId);
        } else if (msg.type === "unsubscribe") {
          hub.unsubscribe(client, msg.taskId);
        } else if (msg.type === "agent_input") {
          orchestrator.sendInput(msg.taskId, msg.input);
        }
      } catch {
        // Invalid message, ignore
      }
    },
    onClose(_evt, ws) {
      const client = wsClients.get(ws);
      if (client) {
        hub.removeClient(client);
        wsClients.delete(ws);
      }
    },
  }))
);

// ─── Start Server ────────────────────────────────────────────────────────────

const server = Bun.serve({
  fetch: app.fetch,
  websocket,
  port: PORT,
});

console.log(`
╔══════════════════════════════════════════════╗
║          🚀 vibe-code server                 ║
║                                              ║
║  API:  http://localhost:${PORT}               ║
║  WS:   ws://localhost:${PORT}/ws              ║
║  Data: ${DATA_DIR}
║  Max agents: ${MAX_AGENTS}                         ║
╚══════════════════════════════════════════════╝
`);

// List available engines on startup
const engines = await registry.listEngines();
for (const engine of engines) {
  const status = engine.available ? "✓" : "✗";
  console.log(`  ${status} ${engine.displayName} (${engine.name})`);
}
console.log();
