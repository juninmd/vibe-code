import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(import.meta.dir, "../../../.env") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { AgentTemplateRegistry } from "./agents/agent-templates";
import { Orchestrator } from "./agents/orchestrator";
import { EngineRegistry } from "./agents/registry";
import { ScheduleRunner } from "./agents/schedule-runner";
import { createAgentTemplatesRouter } from "./api/agent-templates";
import { createEnginesRouter } from "./api/engines";
import { createInboxRouter } from "./api/inbox";
import { createLabelsRouter } from "./api/labels";
import { createPromptsRouter } from "./api/prompts";
import { createReposRouter } from "./api/repos";
import { createReviewsRouter } from "./api/reviews";
import { createRunsRouter } from "./api/runs";
import { createRuntimesRouter } from "./api/runtimes";
import { createSettingsRouter } from "./api/settings";
import { createSkillsRouter } from "./api/skills";
import { createStatsRouter } from "./api/stats";
import { createTasksRouter } from "./api/tasks";
import { createTemplatesRouter } from "./api/templates";
import { createWorkspacesRouter } from "./api/workspaces";
import { authMiddleware, createAuthRouter } from "./auth";
import { createDb } from "./db";
import { GitService } from "./git/git-service";
import { ProviderRegistry } from "./git/providers/registry";
import { SkillsLoader } from "./skills/loader";
import { SkillRegistryService } from "./skills/registry";
import { logValidationReport, validateSkills } from "./skills/validator";
import { BroadcastHub } from "./ws/broadcast";

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.VIBE_CODE_DATA_DIR
  ? process.env.VIBE_CODE_DATA_DIR.replace(/^~/, homedir())
  : join(homedir(), ".vibe-code");
const DB_PATH = join(DATA_DIR, "vibe.db");
const MAX_AGENTS = Number(process.env.VIBE_CODE_MAX_AGENTS) || 4;

const db = createDb(DB_PATH);
const git = new GitService(DATA_DIR);
const providerRegistry = new ProviderRegistry(db);
git.providers = providerRegistry;
const hub = new BroadcastHub(db);
const registry = new EngineRegistry();
// Restore max_agents from DB (overrides env var if previously set via UI)
const storedMaxAgents = Number(db.settings.get("max_agents") || 0);
const orchestrator = new Orchestrator(db, git, registry, hub, storedMaxAgents || MAX_AGENTS);
const agentTemplates = new AgentTemplateRegistry();
const skillsLoader = new SkillsLoader();
validateSkills(skillsLoader)
  .then(logValidationReport)
  .catch((err) => {
    console.error("[startup] Skills validation failed with error:", err);
  });
const skillRegistry = new SkillRegistryService();
const scheduleRunner = new ScheduleRunner(db, orchestrator, skillRegistry);

scheduleRunner.start();

// Mark orphaned runs (stuck in 'running' after pod restart) as cancelled
try {
  const orphanedRunsResult = db.raw
    .query(
      "UPDATE agent_runs SET status = 'cancelled', finished_at = datetime('now'), error_message = 'Process interrupted by server restart' WHERE status = 'running'"
    )
    .run() as { changes: number };
  if (orphanedRunsResult.changes > 0) {
    console.log(`[startup] Marked ${orphanedRunsResult.changes} orphaned runs as cancelled`);
  }
} catch (err) {
  console.warn("[startup] Failed to cleanup orphaned runs:", err);
}

orchestrator.recoverInProgressTasks().catch((err) => {
  console.warn("[startup] recoverInProgressTasks failed:", err);
});

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
  })
);

// auth routes are public (no middleware)
const authRouter = createAuthRouter(db);
app.route("/api/auth", authRouter);

// all other /api/* routes require authentication
app.use("/api/*", authMiddleware(db));

// Serve web/dist in production; redirect to Vite dev server in development
const WEB_DIST = resolve(import.meta.dir, "../../web/dist");
const isProduction = process.env.NODE_ENV === "production";

async function serveStatic(_c: import("hono").Context, filePath: string): Promise<Response> {
  try {
    const content = await readFile(filePath);
    const ext = filePath.split(".").pop() ?? "";
    const mime: Record<string, string> = {
      html: "text/html; charset=utf-8",
      js: "application/javascript",
      css: "text/css",
      svg: "image/svg+xml",
      png: "image/png",
      ico: "image/x-icon",
      json: "application/json",
      woff2: "font/woff2",
      woff: "font/woff",
    };
    return new Response(content, {
      headers: { "Content-Type": mime[ext] ?? "application/octet-stream" },
    });
  } catch {
    // file not found — fall through to index.html (SPA routing)
    const index = await readFile(join(WEB_DIST, "index.html"));
    return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

const api = new Hono();
api.route("/repos", createReposRouter(db, git, hub));
api.route("/tasks", createTasksRouter(db, orchestrator, git));
api.route("/runs", createRunsRouter(db));
api.route("/engines", createEnginesRouter(registry, orchestrator));
api.route("/workspaces", createWorkspacesRouter(db));
api.route("/settings", createSettingsRouter(db, providerRegistry, skillsLoader, orchestrator));
api.route("/skills", createSkillsRouter(skillsLoader, skillRegistry, db));
api.route("/stats", createStatsRouter(db));
api.route("/reviews", createReviewsRouter(db));
api.route("/runtimes", createRuntimesRouter(db, registry, orchestrator, DATA_DIR, MAX_AGENTS));
api.route("/templates", createTemplatesRouter(db, skillsLoader));
api.route("/agent-templates", createAgentTemplatesRouter(agentTemplates));
api.route("/inbox", createInboxRouter(db, registry, orchestrator));
api.route("/labels", createLabelsRouter(db));
api.route("/prompts", createPromptsRouter(db));

api.get("/changelog", async (c) => {
  // Try cwd-relative first (works in Docker/production), fallback to dev path
  const candidates = [
    resolve(process.cwd(), "CHANGELOG.md"),
    resolve(import.meta.dir, "../../../CHANGELOG.md"),
  ];
  for (const filePath of candidates) {
    try {
      const content = await readFile(filePath, "utf-8");
      return c.json({ content });
    } catch {
      // try next candidate
    }
  }
  console.warn("[changelog] CHANGELOG.md not found in any candidate path");
  return c.json({ content: "No changelog available." });
});

api.get("/health", (c) => c.json({ ok: true, version: process.env.npm_package_version ?? "dev" }));

app.route("/api", api);

app.get("/health", (c) => c.json({ status: "ok" }));

if (isProduction) {
  // Serve static assets
  app.get("/assets/*", (c) => serveStatic(c, join(WEB_DIST, c.req.path)));
  app.get("/favicon.*", (c) => serveStatic(c, join(WEB_DIST, c.req.path)));
  // SPA catch-all: must be registered AFTER all API routes
  app.get("*", (c) => serveStatic(c, join(WEB_DIST, "index.html")));
} else {
  const devFrontend = process.env.VITE_DEV_URL || "http://localhost:5173";
  app.get("/", (c) => c.redirect(devFrontend));
}

const wsClients = new Map<unknown, ReturnType<typeof hub.addClient>>();

const server = Bun.serve({
  port: PORT,
  reusePort: true,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const workspaceId = url.searchParams.get("workspaceId") || null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const success = (server as any).upgrade(req, { data: { workspaceId } });
      if (success) return undefined;
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      const client = hub.addClient(ws);
      wsClients.set(ws, client);
    },
    message(ws, message) {
      const client = wsClients.get(ws);
      if (!client) return;
      try {
        const msg = JSON.parse(message as string);
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        } else if (msg.type === "subscribe" && msg.taskId) {
          hub.subscribe(client, msg.taskId);
        } else if (msg.type === "unsubscribe" && msg.taskId) {
          hub.unsubscribe(client, msg.taskId);
        }
      } catch {
        // ignore malformed messages
      }
    },
    close(ws) {
      const client = wsClients.get(ws);
      if (client) hub.removeClient(client);
      wsClients.delete(ws);
    },
  },
});

console.log(`vibe-code server running on http://localhost:${server.port}`);
