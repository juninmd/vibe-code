import { describe, it, expect, beforeEach } from "bun:test";
import { Orchestrator } from "./orchestrator";
import { createDb } from "../db";
import type { AgentEngine, AgentEvent } from "./engine";
import type { GitService } from "../git/git-service";
import type { EngineRegistry } from "./registry";
import type { BroadcastHub } from "../ws/broadcast";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof createDb>;

function makeDb(): Db {
  return createDb(":memory:");
}

function makeHub(): BroadcastHub {
  return {
    broadcastAll: () => {},
    broadcastToTask: () => {},
    addClient: () => ({ ws: {} as any, subscribedTasks: new Set() }),
    removeClient: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
  } as unknown as BroadcastHub;
}

function makeEngine(events: AgentEvent[]): AgentEngine {
  return {
    name: "mock",
    displayName: "Mock",
    isAvailable: async () => true,
    listModels: async () => [],
    async *execute() {
      for (const e of events) yield e;
    },
    abort: () => {},
    sendInput: () => false,
  };
}

function makeRegistry(engine: AgentEngine): EngineRegistry {
  return {
    get: (_name: string) => engine,
    getFirstAvailable: async () => engine,
    listEngines: async () => [],
    register: () => {},
  } as unknown as EngineRegistry;
}

function makeGit(opts: {
  hasChanges?: boolean;
  hasCommitsAhead?: boolean;
  prUrl?: string;
  failPush?: boolean;
} = {}): GitService {
  const {
    hasChanges = false,
    hasCommitsAhead = true,
    prUrl = "https://github.com/owner/repo/pull/1",
    failPush = false,
  } = opts;
  return {
    hasChanges: async () => hasChanges,
    hasCommitsAhead: async () => hasCommitsAhead,
    commitAll: async () => {},
    push: async () => {
      if (failPush) throw new Error("Network error: push failed");
    },
    createPR: async () => prUrl,
    createWorktree: async () => "/tmp/test-worktree",
    removeWorktree: async () => {},
    getBarePath: () => "/path/repo.git",
    fetchRepo: async () => {},
    cloneRepo: async () => "/path/repo.git",
    branchExists: async () => false,
    checkout: async () => {},
    detectDefaultBranch: async () => "main",
    diffSummary: async () => [],
    diffFileContent: async () => "",
    listGitHubRepos: async () => [],
  } as unknown as GitService;
}

function seedRepo(db: Db, url = "https://github.com/owner/repo.git") {
  const repo = db.repos.create({ url });
  db.repos.updateStatus(repo.id, "ready", "/path/repo.git");
  return db.repos.getById(repo.id)!;
}

/** Poll until task reaches expected status, or throw after timeout */
async function waitForStatus(
  db: Db,
  taskId: string,
  expected: string,
  timeoutMs = 3000
): Promise<ReturnType<Db["tasks"]["getById"]>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = db.tasks.getById(taskId);
    if (task?.status === expected) return task;
    await Bun.sleep(20);
  }
  const task = db.tasks.getById(taskId);
  throw new Error(
    `Task ${taskId} never reached "${expected}" — got "${task?.status}" after ${timeoutMs}ms`
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Orchestrator — task flow", () => {
  let db: Db;
  let hub: BroadcastHub;

  beforeEach(() => {
    db = makeDb();
    hub = makeHub();
  });

  it("moves task to in_progress immediately after launch", async () => {
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "My task", repoId: repo.id });
    const orch = new Orchestrator(db, makeGit(), makeRegistry(makeEngine([])), hub);

    await orch.launch(task);

    const current = db.tasks.getById(task.id);
    expect(current?.status).toBe("in_progress");
  });

  it("creates an agent run record on launch", async () => {
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });
    const orch = new Orchestrator(db, makeGit(), makeRegistry(makeEngine([])), hub);

    const run = await orch.launch(task);

    expect(run.taskId).toBe(task.id);
    expect(run.engine).toBe("mock");
  });

  it("moves task to 'review' with PR when agent makes commits (exit 0)", async () => {
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "Feature", repoId: repo.id });
    const events: AgentEvent[] = [
      { type: "log", stream: "stdout", content: "Implementing feature..." },
      { type: "complete", exitCode: 0 },
    ];
    const orch = new Orchestrator(
      db,
      makeGit({ hasCommitsAhead: true, prUrl: "https://github.com/owner/repo/pull/42" }),
      makeRegistry(makeEngine(events)),
      hub
    );

    await orch.launch(task);
    const final = await waitForStatus(db, task.id, "review");

    expect(final?.status).toBe("review");
    expect(final?.prUrl).toBe("https://github.com/owner/repo/pull/42");
    expect(final?.branchName).toMatch(/^vibe-code\//);
  });

  it("moves task to 'review' even when agent exits with code 1 but made commits (critical fix)", async () => {
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "Fix", repoId: repo.id });
    // Simulate an agent that exits with code 1 but DID commit work (common with Claude Code)
    const events: AgentEvent[] = [
      { type: "log", stream: "stdout", content: "Applied changes." },
      { type: "log", stream: "stderr", content: "[process] Exited with code 1" },
      { type: "complete", exitCode: 1 },
    ];
    const orch = new Orchestrator(
      db,
      makeGit({ hasCommitsAhead: true }),
      makeRegistry(makeEngine(events)),
      hub
    );

    await orch.launch(task);
    const final = await waitForStatus(db, task.id, "review");

    expect(final?.status).toBe("review");
    expect(final?.prUrl).not.toBeNull();
  });

  it("moves task to 'failed' when agent makes no commits", async () => {
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "Nothing to do", repoId: repo.id });
    const events: AgentEvent[] = [
      { type: "log", stream: "stdout", content: "Looked around, nothing to do." },
      { type: "complete", exitCode: 0 },
    ];
    const orch = new Orchestrator(
      db,
      makeGit({ hasCommitsAhead: false }), // no commits!
      makeRegistry(makeEngine(events)),
      hub
    );

    await orch.launch(task);
    const final = await waitForStatus(db, task.id, "failed");

    expect(final?.status).toBe("failed");
  });

  it("moves task to 'review' without PR when push fails (network error)", async () => {
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });
    const orch = new Orchestrator(
      db,
      makeGit({ hasCommitsAhead: true, failPush: true }),
      makeRegistry(makeEngine([{ type: "complete", exitCode: 0 }])),
      hub
    );

    await orch.launch(task);
    const final = await waitForStatus(db, task.id, "review");

    expect(final?.status).toBe("review");
    expect(final?.prUrl).toBeNull();
  });

  it("task goes to 'failed' when uncommitted changes exist but no commits ahead", async () => {
    // Agent left uncommitted files but didn't create commits (commitAll runs but git is lying)
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });
    const orch = new Orchestrator(
      db,
      makeGit({ hasChanges: true, hasCommitsAhead: false }),
      makeRegistry(makeEngine([{ type: "complete", exitCode: 0 }])),
      hub
    );

    await orch.launch(task);
    const final = await waitForStatus(db, task.id, "failed");
    expect(final?.status).toBe("failed");
  });
});

describe("Orchestrator — agent logs", () => {
  it("persists agent log events to the database", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });
    const events: AgentEvent[] = [
      { type: "log", stream: "stdout", content: "Line one" },
      { type: "log", stream: "stderr", content: "Error line" },
      { type: "log", stream: "system", content: "System info" },
      { type: "complete", exitCode: 0 },
    ];
    const orch = new Orchestrator(
      db,
      makeGit({ hasCommitsAhead: true }),
      makeRegistry(makeEngine(events)),
      makeHub()
    );

    const run = await orch.launch(task);
    await waitForStatus(db, task.id, "review");

    const logs = db.logs.listByRun(run.id);
    const contents = logs.map((l) => l.content);
    expect(contents).toContain("Line one");
    expect(contents).toContain("Error line");
    expect(contents).toContain("System info");
  });

  it("saves status events as run currentStatus updates (no log entry)", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });
    const events: AgentEvent[] = [
      { type: "status", content: "Thinking..." },
      { type: "complete", exitCode: 0 },
    ];
    const orch = new Orchestrator(
      db,
      makeGit({ hasCommitsAhead: true }),
      makeRegistry(makeEngine(events)),
      makeHub()
    );

    const run = await orch.launch(task);
    await waitForStatus(db, task.id, "review");

    // Status events should NOT create log entries
    const logs = db.logs.listByRun(run.id);
    const statusLogs = logs.filter((l) => l.content === "Thinking...");
    expect(statusLogs.length).toBe(0);
  });
});

describe("Orchestrator — cancel", () => {
  it("moves stuck in_progress task back to backlog", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });
    // Manually set to in_progress (simulating a stuck task from previous session)
    db.tasks.update(task.id, { status: "in_progress" });

    const orch = new Orchestrator(
      db,
      makeGit(),
      makeRegistry(makeEngine([])),
      makeHub()
    );

    await orch.cancel(task.id);

    const final = db.tasks.getById(task.id);
    expect(final?.status).toBe("backlog");
  });

  it("does nothing if task is not in_progress and has no active run", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });

    const orch = new Orchestrator(
      db,
      makeGit(),
      makeRegistry(makeEngine([])),
      makeHub()
    );

    await orch.cancel(task.id); // Should not throw
    const final = db.tasks.getById(task.id);
    expect(final?.status).toBe("backlog"); // unchanged
  });
});

describe("Orchestrator — launch guards", () => {
  it("throws when no engine is available", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task = db.tasks.create({ title: "T", repoId: repo.id });

    const emptyRegistry = {
      get: () => undefined,
      getFirstAvailable: async () => undefined,
      listEngines: async () => [],
      register: () => {},
    } as unknown as EngineRegistry;

    const orch = new Orchestrator(db, makeGit(), emptyRegistry, makeHub());
    await expect(orch.launch(task)).rejects.toThrow("No AI engines available");
  });

  it("throws when max concurrent agents reached", async () => {
    const db = makeDb();
    const repo = seedRepo(db);
    const task1 = db.tasks.create({ title: "T1", repoId: repo.id });
    const task2 = db.tasks.create({ title: "T2", repoId: repo.id });

    // Slow engine that never finishes during the test
    const slowEngine: AgentEngine = {
      name: "slow",
      displayName: "Slow",
      isAvailable: async () => true,
      listModels: async () => [],
      async *execute() {
        await new Promise(() => {}); // never resolves
      },
      abort: () => {},
      sendInput: () => false,
    };

    const orch = new Orchestrator(
      db,
      makeGit(),
      makeRegistry(slowEngine),
      makeHub(),
      1 // max 1 concurrent
    );

    await orch.launch(task1);
    await expect(orch.launch(task2)).rejects.toThrow("Max concurrent agents");
  });
});
