/**
 * Integration tests for ConflictResolver — end-to-end flow:
 *   conflict detected → child task created → prompt has --force-with-lease → no --force
 */
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createDb } from "../db";
import type { BroadcastHub } from "../ws/broadcast";
import { ConflictResolver } from "./conflict-resolver";

type Db = ReturnType<typeof createDb>;

// Mock Telegram so it doesn't fire real HTTP calls
mock.module("../notifications/telegram", () => ({
  createTelegramNotifier: () => ({
    isConfigured: () => false,
    send: async () => {},
  }),
}));

const { Orchestrator } = await import("./orchestrator");

mock.module("./orchestrator/review", () => ({
  REVIEW_ENABLED: false,
  REVIEW_STRICT: false,
  runReviewPipeline: async () => ({ blockers: [], actionableFindings: [], docsFindings: [] }),
}));

function makeHub(): BroadcastHub {
  return {
    broadcastAll: () => {},
    broadcastToTask: () => {},
    batchLog: () => {},
    flushLogs: () => {},
    addClient: () => ({ ws: {} as unknown, subscribedTasks: new Set() }),
    removeClient: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
  } as unknown as BroadcastHub;
}

function makeDb(): Db {
  const db = createDb(":memory:");
  db.settings.set("litellm_enabled", "false");
  return db;
}

function makeOrchestrator(db: Db) {
  const hub = makeHub();
  const git = {
    cloneBare: async () => {},
    createWorktree: async () => "/tmp/fake-wt",
    removeWorktree: async () => {},
    push: async () => {},
    syncWithBase: async () => ({ ok: true, message: "ok" }),
    currentBranch: async () => "feature-branch",
    listWorktrees: async () => [],
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  } as any;
  const registry = { get: () => undefined, list: () => [] } as any;
  return new Orchestrator(db, git, hub, registry, { maxConcurrent: 2, dataDir: "/tmp" });
}

describe("ConflictResolver", () => {
  let db: Db;
  let resolver: ConflictResolver;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let repoId: string;

  beforeEach(() => {
    db = makeDb();
    orchestrator = makeOrchestrator(db);
    resolver = new ConflictResolver(db, orchestrator as any);

    // Create a test repo
    const repo = db.repos.create({
      name: "test-repo",
      url: "https://github.com/owner/test-repo",
      defaultBranch: "main",
    });
    repoId = repo.id;
  });

  describe("conflict detection — prompt safety", () => {
    it("generated prompt contains git push --force-with-lease", async () => {
      // Create a parent task with a PR
      const parent = db.tasks.create({
        repoId,
        title: "feat: add awesome feature",
        description: "Adds great stuff",
        status: "review",
      });
      db.tasks.updateField(parent.id, "pr_url", "https://github.com/owner/test-repo/pull/42");
      db.tasks.updateField(parent.id, "branch_name", "feat/awesome");

      // Mock isPRConflicting to return true
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mergeable: false, mergeable_state: "dirty" }),
      } as any);

      db.settings.set("github_token", "test-token");

      // Advance the internal timer so check() actually runs
      (resolver as any).lastCheckAt = 0;

      await resolver.check();

      fetchSpy.mockRestore();

      // Child conflict task must exist
      const children = db.tasks.listChildren(parent.id);
      const conflictTask = children.find((t) => t.tags?.includes("conflict-resolution"));
      expect(conflictTask).toBeDefined();

      // Prompt must contain --force-with-lease
      expect(conflictTask!.description).toContain("--force-with-lease");

      // Prompt must NOT contain bare --force (without --lease)
      const descLines = conflictTask!.description!.split("\n");
      const hasBareForcePush = descLines.some((line) => {
        // Match `git push --force` but not `git push --force-with-lease`
        return /git push .*--force(?!-with-lease)/.test(line);
      });
      expect(hasBareForcePush).toBe(false);
    });

    it("does not create duplicate conflict tasks when one is already in_progress", async () => {
      const parent = db.tasks.create({
        repoId,
        title: "feat: another feature",
        status: "review",
      });
      db.tasks.updateField(parent.id, "pr_url", "https://github.com/owner/test-repo/pull/99");
      db.tasks.updateField(parent.id, "branch_name", "feat/another");

      // Manually create an existing conflict child
      db.tasks.create({
        repoId,
        title: "fix(conflicts): existing",
        status: "in_progress",
        parentTaskId: parent.id,
        tags: ["conflict-resolution"],
      });

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ mergeable: false }),
      } as any);

      db.settings.set("github_token", "test-token");
      (resolver as any).lastCheckAt = 0;

      await resolver.check();
      fetchSpy.mockRestore();

      const children = db.tasks.listChildren(parent.id);
      const conflictTasks = children.filter((t) => t.tags?.includes("conflict-resolution"));
      // Must still be exactly 1 — no duplicate created
      expect(conflictTasks).toHaveLength(1);
    });

    it("skips check when called within CONFLICT_CHECK_INTERVAL_MS", async () => {
      const fetchSpy = spyOn(globalThis, "fetch");
      db.settings.set("github_token", "test-token");

      // First call (timer not set yet) — sets lastCheckAt
      (resolver as any).lastCheckAt = Date.now(); // already just ran

      await resolver.check();

      // fetch must NOT have been called because timer throttles
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe("conflict task structure", () => {
    it("child task reuses parent branch and engine", async () => {
      const parent = db.tasks.create({
        repoId,
        title: "feat: branch reuse test",
        status: "review",
        engine: "claude-code",
        model: "claude-sonnet-4-6",
      });
      db.tasks.updateField(parent.id, "pr_url", "https://github.com/owner/test-repo/pull/7");
      db.tasks.updateField(parent.id, "branch_name", "feat/branch-reuse");

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mergeable: false }),
      } as any);

      db.settings.set("github_token", "test-token");
      (resolver as any).lastCheckAt = 0;
      await resolver.check();
      fetchSpy.mockRestore();

      const children = db.tasks.listChildren(parent.id);
      const conflictTask = children.find((t) => t.tags?.includes("conflict-resolution"));
      expect(conflictTask).toBeDefined();
      expect(conflictTask!.engine).toBe("claude-code");
      expect(conflictTask!.model).toBe("claude-sonnet-4-6");
      expect(conflictTask!.branchName).toBe("feat/branch-reuse");
      expect(conflictTask!.parentTaskId).toBe(parent.id);
    });

    it("child task title references parent title", async () => {
      const parent = db.tasks.create({
        repoId,
        title: "feat: implement payment gateway",
        status: "in_progress",
      });
      db.tasks.updateField(parent.id, "pr_url", "https://github.com/owner/test-repo/pull/11");
      db.tasks.updateField(parent.id, "branch_name", "feat/payment");

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mergeable_state: "dirty" }),
      } as any);

      db.settings.set("github_token", "test-token");
      (resolver as any).lastCheckAt = 0;
      await resolver.check();
      fetchSpy.mockRestore();

      const children = db.tasks.listChildren(parent.id);
      const conflictTask = children.find((t) => t.tags?.includes("conflict-resolution"));
      expect(conflictTask!.title).toContain("fix(conflicts):");
      expect(conflictTask!.title).toContain("implement payment gateway");
    });

    it("launches conflict task with the persisted PR branch", async () => {
      const launch = mock(async () => undefined);
      resolver = new ConflictResolver(db, { launch } as any);
      const parent = db.tasks.create({
        repoId,
        title: "feat: launch branch test",
        status: "review",
        engine: "claude-code",
      });
      db.tasks.updateField(parent.id, "pr_url", "https://github.com/owner/test-repo/pull/12");
      db.tasks.updateField(parent.id, "branch_name", "feat/launch-branch");

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mergeable: false }),
      } as any);

      db.settings.set("github_token", "test-token");
      (resolver as any).lastCheckAt = 0;
      await resolver.check();
      fetchSpy.mockRestore();

      expect(launch).toHaveBeenCalledTimes(1);
      expect(launch.mock.calls[0]?.[0].branchName).toBe("feat/launch-branch");
    });
  });

  describe("isPRConflicting — GitHub API parsing", () => {
    it("detects conflict via mergeable=false", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mergeable: false, mergeable_state: "clean" }),
      } as any);

      const result = await (resolver as any).isPRConflicting(
        "https://github.com/owner/repo/pull/1",
        "token"
      );
      expect(result).toBe(true);
      fetchSpy.mockRestore();
    });

    it("detects conflict via mergeable_state=dirty", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mergeable: null, mergeable_state: "dirty" }),
      } as any);

      const result = await (resolver as any).isPRConflicting(
        "https://github.com/owner/repo/pull/2",
        "token"
      );
      expect(result).toBe(true);
      fetchSpy.mockRestore();
    });

    it("returns false for clean PR", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mergeable: true, mergeable_state: "clean" }),
      } as any);

      const result = await (resolver as any).isPRConflicting(
        "https://github.com/owner/repo/pull/3",
        "token"
      );
      expect(result).toBe(false);
      fetchSpy.mockRestore();
    });

    it("returns false for non-GitHub URL", async () => {
      const result = await (resolver as any).isPRConflicting("https://gitlab.com/x/y/mr/1", "tk");
      expect(result).toBe(false);
    });
  });
});
