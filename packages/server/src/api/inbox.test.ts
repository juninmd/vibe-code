import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Orchestrator } from "../agents/orchestrator";
import type { EngineRegistry } from "../agents/registry";
import { createDb } from "../db";
import { createInboxRouter } from "./inbox";

type Engine = { name: string; displayName: string; available: boolean; setupIssue?: string | null };

async function inbox(
  engines: Engine[],
  db = createDb(":memory:"),
  orchestratorProps: Partial<Orchestrator> = {}
) {
  const registry = { listEngines: async () => engines } as unknown as EngineRegistry;
  const orchestrator = {
    getActiveRunEngines: () => new Map(),
    activeCount: 0,
    maxConcurrentAgents: 4,
    ...orchestratorProps,
  } as unknown as Orchestrator;
  const app = new Hono();
  app.route("/api/inbox", createInboxRouter(db, registry, orchestrator));
  const res = await app.request("/api/inbox");
  return (
    (await res.json()) as {
      data: Array<{
        id: string;
        type: string;
        severity: string;
        title: string;
        description: string;
        createdAt: string;
      }>;
    }
  ).data;
}

const engine = (name: string, available: boolean): Engine => ({
  name,
  displayName: name,
  available,
});

describe("GET /api/inbox engine signals", () => {
  it("is quiet when an agent is installed and nothing else is wrong", async () => {
    const items = await inbox([engine("claude-code", true)]);
    expect(items).toEqual([]);
  });

  it("collapses every missing CLI into a single low-priority row", async () => {
    const items = await inbox([
      engine("claude-code", true),
      engine("aider", false),
      engine("codex", false),
      engine("gemini", false),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "engine_unavailable:others", severity: "info" });
    expect(items[0].title).toBe("3 more engines not installed");
    expect(items[0].description).toBe("aider, codex, gemini");
  });

  it("warns once, and clearly, when no agent harness is installed", async () => {
    const items = await inbox([engine("aider", false), engine("codex", false)]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "engine_unavailable:harness", severity: "warning" });
    expect(items[0].description).toContain("Claude Code or OpenCode");
  });

  it("treats an installed OpenCode as a working agent too", async () => {
    const items = await inbox([engine("opencode", true), engine("claude-code", false)]);
    expect(items.map((item) => item.id)).toEqual(["engine_unavailable:others"]);
    expect(items[0].title).toBe("1 more engine not installed");
  });
});

describe("GET /api/inbox tasks signals", () => {
  it("fetches failed, review, and running tasks and sorts by severity and date", async () => {
    const db = createDb(":memory:");

    // Create a repo first because tasks rely on repo_id (foreign key)
    const repo = db.repos.create({
      url: "https://github.com/owner/repo1",
      defaultBranch: "main",
    });

    // Create tasks with different statuses
    db.tasks.create({
      repoId: repo.id,
      title: "Task 1 Failed",
      status: "failed",
      engine: "aider",
    });

    db.tasks.create({
      repoId: repo.id,
      title: "Task 2 Review",
      status: "review",
      engine: "claude-code",
    });

    db.tasks.create({
      repoId: repo.id,
      title: "Task 3 Running",
      status: "in_progress",
      engine: "opencode",
    });

    db.tasks.create({
      repoId: repo.id,
      title: "Task 4 Review PR",
      status: "review",
    });

    // update PR url for task 4 to test branch logic
    const tasks = db.tasks.list(repo.id);
    const task4 = tasks.find((t) => t.title === "Task 4 Review PR");
    if (task4) {
      db.tasks.updateField(task4.id, "pr_url", "https://github.com/owner/repo1/pull/42");
    }

    const items = await inbox([engine("claude-code", true)], db);

    // Filter out engine items to focus on tasks
    const taskItems = items.filter((i) => i.type?.startsWith("task_"));

    expect(taskItems).toHaveLength(4);

    // Severities mapping: critical (failed) -> warning -> success (review) -> info (running)
    // Critical should be first.
    expect(taskItems[0].type).toBe("task_failed");
    expect(taskItems[0].severity).toBe("critical");
    expect(taskItems[0].title).toBe("Task 1 Failed");
    expect(taskItems[0].description).toContain("Falha em repo1 usando aider.");

    // Next should be success (review) items. There are two.
    expect(taskItems[1].type).toBe("task_review");
    expect(taskItems[1].severity).toBe("success");
    // Date sorting: the one updated later should be first. Wait, sorting is by updated_at.
    // They are created quickly, but we can just check types.
    expect(taskItems[1].description).toContain("repo1");

    expect(taskItems[2].type).toBe("task_review");
    expect(taskItems[2].severity).toBe("success");

    // Next should be info (running).
    expect(taskItems[3].type).toBe("task_running");
    expect(taskItems[3].severity).toBe("info");
    expect(taskItems[3].title).toBe("Task 3 Running");
    expect(taskItems[3].description).toContain("Execucao ativa em repo1 com opencode.");

    // Check specific PR message
    const prItem = taskItems.find((t) => t.title === "Task 4 Review PR");
    expect(prItem?.description).toBe("PR pronto em repo1.");
  });

  it("adds runtime saturated warning if active count is >= max slots", async () => {
    const db = createDb(":memory:");
    const items = await inbox([engine("claude-code", true)], db, {
      activeCount: 4,
      maxConcurrentAgents: 4,
    });

    const saturatedItem = items.find((i) => i.type === "runtime_saturated");
    expect(saturatedItem).toBeDefined();
    expect(saturatedItem?.severity).toBe("warning");
    expect(saturatedItem?.title).toBe("Runtime local saturado");
  });
});
