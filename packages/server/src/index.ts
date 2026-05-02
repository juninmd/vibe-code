import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";

const rootDir = join(__dirname, "..", "..");
config({ path: join(rootDir, ".env") });

import type { WsClientMessage } from "@vibe-code/shared";
import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { checkLiteLLMHealth, getLiteLLMBaseUrl } from "./agents/litellm-client";
import { Orchestrator } from "./agents/orchestrator";
import { EngineRegistry } from "./agents/registry";
import { ScheduleRunner } from "./agents/schedule-runner";
import { createEnginesRouter } from "./api/engines";
import { createInboxRouter } from "./api/inbox";
import { createLabelsRouter } from "./api/labels";
import { createPromptsRouter } from "./api/prompts";
import { createReposRouter } from "./api/repos";
import { createRunsRouter } from "./api/runs";
import { createRuntimesRouter } from "./api/runtimes";
import { createSettingsRouter } from "./api/settings";
import { createSkillsRouter } from "./api/skills";
import { createStatsRouter } from "./api/stats";
import { createTasksRouter } from "./api/tasks";
import { createTemplatesRouter } from "./api/templates";
import workspacesRouter from "./api/workspaces";
import { authMiddleware, createAuthRouter } from "./auth";
import { createDb } from "./db";
import { GitService } from "./git/git-service";
import { PrPoller } from "./git/pr-poller";
import { ProviderRegistry } from "./git/providers/registry";
// NOTE: workspaceMiddleware removed - API is now public (no authentication)
// import { workspaceMiddleware } from "./middleware/workspace.middleware";
import { SkillsLoader } from "./skills/loader";
import { SkillRegistryService } from "./skills/registry";
import { BroadcastHub } from "./ws/broadcast";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.VIBE_CODE_DATA_DIR || join(homedir(), ".vibe-code");
const DB_PATH = join(DATA_DIR, "vibe-code.db");
const MAX_AGENTS = Number(process.env.VIBE_CODE_MAX_AGENTS) || 4;

// ─── Initialize Services ────────────────────────────────────────────────────

import { mkdir } from "node:fs/promises";

await mkdir(DATA_DIR, { recursive: true });

const db = createDb(DB_PATH);

// ─── LiteLLM startup check ───────────────────────────────────────────────────
// When enabled, all CLI engines route through LiteLLM. Warn if the proxy is not reachable.
{
  const litellmEnabled = db.settings.get("litellm_enabled") !== "false";
  if (litellmEnabled) {
    if (!process.env.LITELLM_MASTER_KEY?.trim()) {
      console.warn(
        "[startup] WARNING: LITELLM_MASTER_KEY not set. LiteLLM proxy features may not work."
      );
    }
    const litellmBaseUrl = getLiteLLMBaseUrl(db.settings.get("litellm_base_url"));
    console.info(`[startup] Checking LiteLLM proxy at ${litellmBaseUrl} ...`);
    const healthy = await checkLiteLLMHealth(litellmBaseUrl);
    if (!healthy) {
      console.warn(
        `[startup] WARNING: LiteLLM proxy at ${litellmBaseUrl} is not reachable. ` +
          "Engines will use native API keys. Start the proxy or disable LiteLLM in settings."
      );
    } else {
      console.info("[startup] LiteLLM proxy is healthy ✓");
    }
  } else {
    console.info("[startup] LiteLLM proxy disabled — engines will use native API keys.");
  }
}
const git = new GitService(DATA_DIR);
const registry = new EngineRegistry();
const hub = new BroadcastHub();
const providerRegistry = new ProviderRegistry(db);
git.providers = providerRegistry;
const orchestrator = new Orchestrator(db, git, registry, hub, MAX_AGENTS);
const skillsPath = db.settings.get("skills_path") || "~/.agents";
const skillsLoader = new SkillsLoader(skillsPath);
const skillRegistry = new SkillRegistryService(skillsPath);
await skillRegistry.init();
orchestrator.skillsLoader = skillsLoader;

await git.init();

// ─── Recover stuck tasks ─────────────────────────────────────────────────────
// Tasks left as "in_progress" from a previous server session will never finish.
// Use state_snapshot to emit a richer log message when available.
// Reset them to "failed" so the user can retry.
{
  const stuck = db.tasks.list(undefined, "in_progress");
  for (const task of stuck) {
    db.tasks.update(task.id, { status: "failed" });
    const run = db.runs.getLatestByTask(task.id);
    if (run && run.status === "running") {
      let phase = "unknown";
      try {
        if (run.stateSnapshot) {
          const snap = JSON.parse(run.stateSnapshot) as { phase?: string; ts?: string };
          if (snap.phase) phase = snap.phase;
        }
      } catch {
        /* ignore parse errors */
      }
      db.runs.updateStatus(run.id, "failed", {
        finished_at: new Date().toISOString(),
        error_message: `Server restarted while task was running (phase: ${phase})`,
      });
    }
    console.log(`  ↩ Recovered stuck task: "${task.title}" → failed`);
  }
}

// ─── Auto-cleanup (30 days) ──────────────────────────────────────────────────
{
  const cleaned = db.tasks.cleanupArchived(30);
  if (cleaned > 0) {
    console.log(`  🗑️ Auto-cleanup: Removed ${cleaned} archived tasks older than 30 days`);
  }
  const cleanupInterval = setInterval(
    () => {
      try {
        db.tasks.cleanupArchived(30);
      } catch (err) {
        console.error("[cleanup] Failed to archive old tasks:", err);
      }
    },
    24 * 60 * 60 * 1000
  );
  process.on("SIGTERM", () => {
    clearInterval(cleanupInterval);
    process.exit(0);
  });
}

const prPoller = new PrPoller(db, hub);
prPoller.setProviderRegistry(providerRegistry);
prPoller.start();

const scheduleRunner = new ScheduleRunner(db, orchestrator);
scheduleRunner.start();

// ─── Hono App ────────────────────────────────────────────────────────────────

const { upgradeWebSocket, websocket } = createBunWebSocket();

const app = new Hono();

// Middleware
const allowedCorsOrigins = new Set(
  [
    process.env.VIBE_CODE_PUBLIC_URL,
    process.env.VIBE_CODE_ALLOWED_ORIGIN,
    `http://localhost:${PORT}`,
    "http://localhost:5173",
  ].filter(Boolean) as string[]
);
app.use(
  "/api/*",
  cors({
    origin: (origin) =>
      allowedCorsOrigins.has(origin) ? origin : allowedCorsOrigins.values().next().value,
    credentials: true,
  })
);
app.use("/api/*", authMiddleware(db));
app.use("/ws", authMiddleware(db));

// REST Routes
app.route("/api/auth", createAuthRouter(db));
app.route("/api/workspaces", workspacesRouter);
app.route("/api/repos", createReposRouter(db, git, hub));
app.route("/api/tasks", createTasksRouter(db, orchestrator, git));
app.route("/api/runs", createRunsRouter(db));
app.route("/api/runtimes", createRuntimesRouter(db, registry, orchestrator, DATA_DIR, MAX_AGENTS));
app.route("/api/engines", createEnginesRouter(registry, orchestrator));
app.route("/api/inbox", createInboxRouter(db, registry, orchestrator));
app.route("/api/settings", createSettingsRouter(db, providerRegistry, skillsLoader));
app.route("/api/prompts", createPromptsRouter(db));
app.route("/api/stats", createStatsRouter(db));
app.route("/api/skills", createSkillsRouter(skillsLoader, skillRegistry));
app.route("/api/templates", createTemplatesRouter(db, skillsLoader));
app.route("/api/labels", createLabelsRouter(db));

// Changelog route
app.get("/api/changelog", async (c) => {
  try {
    const changelog = await Bun.file(join(__dirname, "../../../CHANGELOG.md")).text();
    return c.json({ content: changelog });
  } catch (_err) {
    return c.json({ error: "Changelog not found" }, 404);
  }
});

// Health check
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    activeAgents: orchestrator.activeCount,
    maxAgents: MAX_AGENTS,
  });
});

// Serve static frontend files
app.get("/*", serveStatic({ root: "../web/dist" }));
app.get("*", serveStatic({ path: "../web/dist/index.html" }));

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
          typeof evt.data === "string"
            ? evt.data
            : new TextDecoder().decode(evt.data as ArrayBuffer)
        );
        const client = wsClients.get(ws);
        if (!client) return;

        if (msg.type === "subscribe") {
          hub.subscribe(client, msg.taskId);
        } else if (msg.type === "unsubscribe") {
          hub.unsubscribe(client, msg.taskId);
        } else if (msg.type === "agent_input") {
          orchestrator.sendInput(msg.taskId, msg.input);
        } else if (msg.type === "ping") {
          // Liveness reply — no-op; any incoming frame resets client pong counter
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

const _server = Bun.serve({
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
