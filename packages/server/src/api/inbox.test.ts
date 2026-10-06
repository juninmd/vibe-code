import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Orchestrator } from "../agents/orchestrator";
import type { EngineRegistry } from "../agents/registry";
import { createDb } from "../db";
import { createInboxRouter } from "./inbox";

type Engine = { name: string; displayName: string; available: boolean; setupIssue?: string | null };

async function inbox(engines: Engine[]) {
  const registry = { listEngines: async () => engines } as unknown as EngineRegistry;
  const orchestrator = {
    getActiveRunEngines: () => new Map(),
    activeCount: 0,
    maxConcurrentAgents: 4,
  } as unknown as Orchestrator;
  const app = new Hono();
  app.route("/api/inbox", createInboxRouter(createDb(":memory:"), registry, orchestrator));
  const res = await app.request("/api/inbox");
  return (
    (await res.json()) as {
      data: Array<{ id: string; severity: string; title: string; description: string }>;
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
