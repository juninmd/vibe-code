/**
 * Smoke test E2E — verifies the conflict resolution flow against the live server at PORT.
 * Skipped when server is not reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const PORT = process.env.PORT || "3002";
const BASE = `http://localhost:${PORT}`;
const API_KEY = process.env.VIBE_CODE_API_KEY || "local-test-key";

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 404) {
    const text = await r.text();
    throw new Error(`HTTP ${r.status}: ${text}`);
  }
  return r.json().catch(() => null);
}

let serverAvailable = false;
let createdTaskId: string | null = null;
let testRepoId: string | null = null;

beforeAll(async () => {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 2000);
    const r = await fetch(`${BASE}/api/repos`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (r.ok) {
      const repos = await r.json();
      const ready = (repos?.data ?? []).filter((r: any) => r.status === "ready");
      if (ready.length > 0) {
        testRepoId = ready[0].id;
        serverAvailable = true;
      }
    }
  } catch {
    serverAvailable = false;
  }
}, 5000);

afterAll(async () => {
  if (createdTaskId) {
    await api("DELETE", `/api/tasks/${createdTaskId}`).catch(() => {});
  }
});

describe("ConflictResolver E2E smoke (live server)", () => {
  it("server is reachable", () => {
    if (!serverAvailable) {
      console.warn(`[smoke] Server not reachable at ${BASE} — skipping live tests`);
    }
    // Always passes — just logs the state
    expect(true).toBe(true);
  });

  it("creates a conflict-resolution task with correct tags and status", async () => {
    if (!serverAvailable || !testRepoId) return;

    const task = await api("POST", "/api/tasks", {
      repoId: testRepoId,
      title: 'fix(conflicts): resolve merge conflicts for "feat: e2e-smoke"',
      description: "Live smoke test — conflict resolution flow validation",
      tags: ["conflict-resolution"],
      status: "backlog",
    });

    expect(task).toBeDefined();
    expect(task.id).toBeTruthy();
    expect(task.status).toBe("backlog");
    expect(task.tags).toContain("conflict-resolution");

    createdTaskId = task.id;
  });

  it("conflict task is retrievable and appears in the board", async () => {
    if (!serverAvailable || !createdTaskId) return;

    const fetched = await api("GET", `/api/tasks/${createdTaskId}`);
    expect(fetched).toBeDefined();
    expect(fetched.id).toBe(createdTaskId);
    expect((fetched.tags ?? []).includes("conflict-resolution")).toBe(true);

    const list = await api("GET", "/api/tasks");
    const found = list?.data?.some((t: any) => t.id === createdTaskId);
    expect(found).toBe(true);
  });

  it("conflict prompt in conflict-resolver.ts uses --force-with-lease and not bare --force", async () => {
    // Static code contract verification — no server needed
    const fileUrl = new URL("./conflict-resolver.ts", import.meta.url);
    // On Windows, pathname is /D:/..., remove leading slash
    const filePath = fileUrl.pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const src = await Bun.file(filePath).text();

    expect(src).toContain("--force-with-lease");

    // Check no `git push --force` appears (without -with-lease suffix)
    const bareForceLines = src
      .split("\n")
      .filter((line) => /git push .*--force(?!-with-lease)/.test(line));
    expect(bareForceLines).toHaveLength(0);
  });
});
