/**
 * E2E tests for sidecar tools.
 * Spins up a real Hono HTTP+WS server with in-memory SQLite.
 * Calls tool handlers directly (no LLM) to verify the full client→server cycle.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { Hono } from "hono";
import type { Orchestrator } from "../packages/server/src/agents/orchestrator";
import { createReposRouter } from "../packages/server/src/api/repos";
import { createTasksRouter } from "../packages/server/src/api/tasks";
import { createDb } from "../packages/server/src/db";
import type { GitService } from "../packages/server/src/git/git-service";
import { BroadcastHub } from "../packages/server/src/ws/broadcast";
import type { SidecarConfig } from "./sidecar";
import { initSidecarDb } from "./sidecar-db";
import { buildTools } from "./sidecar-tools";

type Db = ReturnType<typeof createDb>;

// ── helpers ──────────────────────────────────────────────────────────────────

function makeGit(): GitService {
  return {
    isRepoSource: async () => true,
    detectDefaultBranch: async () => "main",
    cloneRepo: async () => "/tmp/test.git",
    listGitHubRepos: async () => [],
    deleteLocalRepo: async () => {},
  } as unknown as GitService;
}

function makeOrchestrator(hub: BroadcastHub, db: Db): Orchestrator {
  return {
    launch: async (task: { id: string }) => {
      const run = {
        id: `run-${task.id}`,
        taskId: task.id,
        engine: "opencode",
        status: "queued" as const,
        currentStatus: null,
        worktreePath: null,
        startedAt: null,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      };
      // emit task_updated{done} after delay so watchTask WS subscribe arrives first
      setTimeout(() => {
        const updated = db.tasks.update(task.id, { status: "done" });
        if (updated) hub.broadcastAll({ type: "task_updated", task: updated });
      }, 500);
      return run;
    },
    cancel: async () => {},
    retry: async (task: { id: string }) => ({
      id: `run-retry-${task.id}`,
      taskId: task.id,
      engine: "opencode",
      status: "queued" as const,
      currentStatus: null,
      worktreePath: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    }),
    sendInput: () => {},
    activeCount: 0,
  } as unknown as Orchestrator;
}

function makeOrchestratorFailing(hub: BroadcastHub, db: Db): Orchestrator {
  return {
    ...makeOrchestrator(hub, db),
    launch: async (task: { id: string }) => {
      setTimeout(() => {
        const updated = db.tasks.update(task.id, { status: "failed" });
        if (updated) hub.broadcastAll({ type: "task_updated", task: updated });
      }, 500);
      return {
        id: `run-${task.id}`,
        taskId: task.id,
        engine: "opencode",
        status: "queued" as const,
        currentStatus: null,
        worktreePath: null,
        startedAt: null,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      };
    },
  } as unknown as Orchestrator;
}

interface TestServer {
  url: string;
  server: Server;
  db: Db;
  hub: BroadcastHub;
  sidecarDb: ReturnType<typeof initSidecarDb>;
  tools: ReturnType<typeof buildTools>;
  config: SidecarConfig;
}

function createTestServer(
  orchestratorFactory?: (hub: BroadcastHub, db: Db) => Orchestrator
): TestServer {
  const db = createDb(":memory:");
  db.settings.set("auth_enabled", "false");
  const hub = new BroadcastHub();
  const git = makeGit();
  const orch = (orchestratorFactory ?? makeOrchestrator)(hub, db);

  const app = new Hono();
  app.route("/api/repos", createReposRouter(db, git, hub));
  app.route("/api/tasks", createTasksRouter(db, orch, git));

  const wsClients = new Map<unknown, ReturnType<typeof hub.addClient>>();

  let server!: Server;
  server = Bun.serve({
    port: 0,
    fetch(req, s) {
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        s.upgrade(req);
        return undefined as unknown as Response;
      }
      return app.fetch(req, { server: s });
    },
    websocket: {
      open(ws) {
        wsClients.set(ws, hub.addClient(ws));
      },
      message(ws, message) {
        const client = wsClients.get(ws);
        if (!client) return;
        try {
          const msg = JSON.parse(String(message));
          if (msg.type === "subscribe" && msg.taskId) hub.subscribe(client, msg.taskId);
        } catch {}
      },
      close(ws) {
        const client = wsClients.get(ws);
        if (client) hub.removeClient(client);
        wsClients.delete(ws);
      },
    },
  });

  const url = `http://localhost:${server.port}`;
  const sidecarDb = initSidecarDb(":memory:");
  const config: SidecarConfig = {
    serverUrl: url,
    intervalMinutes: 60,
    provider: "openrouter",
    repos: [],
  };
  const tools = buildTools({ config, db: sidecarDb });

  return { url, server, db, hub, sidecarDb, tools, config };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("sidecar tools E2E", () => {
  let ctx: TestServer;

  beforeEach(() => {
    ctx = createTestServer();
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.sidecarDb.close();
  });

  it("happy path: create_and_launch_task → watch_task → completed → save_learning persists", async () => {
    // Seed a ready repo directly in the test DB
    const repo = ctx.db.repos.create({ url: "https://github.com/test/repo.git" });
    ctx.db.repos.updateStatus(repo.id, "ready", "/tmp/test.git");

    const launchResult = await ctx.tools.create_and_launch_task.execute(
      {
        repo_url: "https://github.com/test/repo.git",
        title: "Improve test coverage",
        description: "Add missing unit tests",
      },
      { messages: [], toolCallId: "tc1", abortSignal: new AbortController().signal }
    );

    expect(launchResult).toHaveProperty("task_id");
    expect(launchResult).toHaveProperty("run_id");
    expect(launchResult).not.toHaveProperty("error");

    const { task_id, record_id } = launchResult as {
      task_id: string;
      record_id: string;
      run_id: string;
    };

    const watchResult = await ctx.tools.watch_task.execute(
      { task_id, record_id, timeout_minutes: 1 },
      { messages: [], toolCallId: "tc2", abortSignal: new AbortController().signal }
    );

    expect(watchResult).toEqual({ status: "completed" });

    await ctx.tools.save_learning.execute(
      { repo_url: "https://github.com/test/repo.git", note: "Tests improved successfully" },
      { messages: [], toolCallId: "tc3", abortSignal: new AbortController().signal }
    );

    const learningsResult = await ctx.tools.get_learnings.execute(
      { repo_url: "https://github.com/test/repo.git" },
      { messages: [], toolCallId: "tc4", abortSignal: new AbortController().signal }
    );

    expect(Array.isArray(learningsResult)).toBe(true);
    expect((learningsResult as Array<{ note: string }>)[0].note).toBe(
      "Tests improved successfully"
    );
  });

  it("idempotência: ensureRepo duas vezes retorna mesmo repoId", async () => {
    const repo = ctx.db.repos.create({ url: "https://github.com/test/idempotent.git" });
    ctx.db.repos.updateStatus(repo.id, "ready", "/tmp/test.git");

    const r1 = await ctx.tools.create_and_launch_task.execute(
      {
        repo_url: "https://github.com/test/idempotent.git",
        title: "Task A",
        description: "desc",
      },
      { messages: [], toolCallId: "tc1", abortSignal: new AbortController().signal }
    );
    const r2 = await ctx.tools.create_and_launch_task.execute(
      {
        repo_url: "https://github.com/test/idempotent.git",
        title: "Task B",
        description: "desc",
      },
      { messages: [], toolCallId: "tc2", abortSignal: new AbortController().signal }
    );

    // Both should succeed (no error)
    expect(r1).not.toHaveProperty("error");
    expect(r2).not.toHaveProperty("error");
    // Repo should only exist once
    const repos = ctx.db.repos.list();
    expect(repos.filter((r) => r.url === "https://github.com/test/idempotent.git").length).toBe(1);
  });

  it("task failed: watch_task retorna failed quando orquestrador falha", async () => {
    ctx.server.stop(true);
    ctx = createTestServer(makeOrchestratorFailing);

    const repo = ctx.db.repos.create({ url: "https://github.com/test/fail.git" });
    ctx.db.repos.updateStatus(repo.id, "ready", "/tmp/test.git");

    const launchResult = await ctx.tools.create_and_launch_task.execute(
      {
        repo_url: "https://github.com/test/fail.git",
        title: "Will fail",
        description: "desc",
      },
      { messages: [], toolCallId: "tc1", abortSignal: new AbortController().signal }
    );

    const { task_id } = launchResult as { task_id: string };
    const watchResult = await ctx.tools.watch_task.execute(
      { task_id, timeout_minutes: 1 },
      { messages: [], toolCallId: "tc2", abortSignal: new AbortController().signal }
    );

    expect(watchResult).toEqual({ status: "failed" });
  });

  it("get_run_history: retorna runs inseridos no sidecar DB", async () => {
    ctx.sidecarDb.insertRun({
      id: "r1",
      repo_url: "https://github.com/test/history.git",
      task_id: "t1",
      prompt: "some prompt",
      status: "completed",
      logs_summary: null,
    });

    const result = await ctx.tools.get_run_history.execute(
      { repo_url: "https://github.com/test/history.git", limit: 5 },
      { messages: [], toolCallId: "tc1", abortSignal: new AbortController().signal }
    );

    const runs = result as Array<{ id: string; status: string }>;
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe("r1");
    expect(runs[0].status).toBe("completed");
  });

  it("list_repos: retorna repos do vibe-code", async () => {
    ctx.db.repos.create({ url: "https://github.com/org/one.git" });
    ctx.db.repos.create({ url: "https://github.com/org/two.git" });

    const result = await ctx.tools.list_repos.execute(
      {},
      { messages: [], toolCallId: "tc1", abortSignal: new AbortController().signal }
    );

    const repos = result as Array<{ url: string }>;
    expect(repos.length).toBe(2);
    expect(repos.map((r) => r.url)).toContain("https://github.com/org/one.git");
  });
});
