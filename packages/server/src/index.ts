import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(import.meta.dir, "../../../.env") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { Orchestrator } from "./agents/orchestrator";
import { EngineRegistry } from "./agents/registry";
import { ScheduleRunner } from "./agents/schedule-runner";
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
const hub = new BroadcastHub();
const registry = new EngineRegistry();
const orchestrator = new Orchestrator(db, git, registry, hub, MAX_AGENTS);
const skillsLoader = new SkillsLoader();
const skillRegistry = new SkillRegistryService();
const scheduleRunner = new ScheduleRunner(db, orchestrator, skillRegistry);

scheduleRunner.start();

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

// redirect root to frontend
app.get("/", (c) => c.redirect("http://localhost:5173"));

const api = new Hono();
api.route("/repos", createReposRouter(db, git, hub));
api.route("/tasks", createTasksRouter(db, orchestrator, git));
api.route("/runs", createRunsRouter(db));
api.route("/engines", createEnginesRouter(registry, orchestrator));
api.route("/workspaces", createWorkspacesRouter(db));
api.route("/settings", createSettingsRouter(db, providerRegistry, skillsLoader));
api.route("/skills", createSkillsRouter(skillsLoader, skillRegistry, db));
api.route("/stats", createStatsRouter(db));
api.route("/reviews", createReviewsRouter(db));
api.route("/runtimes", createRuntimesRouter(db, registry, orchestrator, DATA_DIR, MAX_AGENTS));
api.route("/templates", createTemplatesRouter(db, skillsLoader));
api.route("/inbox", createInboxRouter(db, registry, orchestrator));
api.route("/labels", createLabelsRouter(db));
api.route("/prompts", createPromptsRouter(db));

api.get("/changelog", async (c) => {
  try {
    const path = resolve(import.meta.dir, "../../../CHANGELOG.md");
    const content = await readFile(path, "utf-8");
    return c.json({ content });
  } catch {
    return c.json({ content: "No changelog available." });
  }
});

app.route("/api", api);

app.get("/health", (c) => c.json({ status: "ok" }));

const wsClients = new Map<unknown, ReturnType<typeof hub.addClient>>();

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
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
        if (msg.type === "subscribe" && msg.taskId) {
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
