import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AntigravitySessionReader } from "./readers/antigravity";
import { ClaudeCodeSessionReader } from "./readers/claude-code";
import { OpenCodeSessionReader } from "./readers/opencode";
import { deriveStatus, SessionService } from "./session-service";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vibe-sessions-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(value), "utf-8");
}

async function writeLines(file: string, records: unknown[]): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, records.map((r) => JSON.stringify(r)).join("\n"), "utf-8");
}

describe("deriveStatus", () => {
  test("an explicit terminal state from the CLI wins over activity", () => {
    expect(deriveStatus({ updatedAt: NOW, explicitStatus: "failed" }, NOW, MINUTE, HOUR)).toBe(
      "failed"
    );
    expect(deriveStatus({ updatedAt: NOW, explicitStatus: "done" }, NOW, MINUTE, HOUR)).toBe(
      "done"
    );
  });

  test("falls back to how recently the session was touched", () => {
    const call = (ageMs: number) =>
      deriveStatus({ updatedAt: NOW - ageMs, explicitStatus: null }, NOW, 15 * MINUTE, 24 * HOUR);

    expect(call(MINUTE)).toBe("active");
    expect(call(15 * MINUTE)).toBe("active");
    expect(call(30 * MINUTE)).toBe("idle");
    expect(call(23 * HOUR)).toBe("idle");
    expect(call(48 * HOUR)).toBe("done");
  });
});

describe("ClaudeCodeSessionReader", () => {
  test("projects a transcript onto the fields a card needs", async () => {
    const file = join(root, "claude", "-home-user-proj", "sess-1.jsonl");
    await writeLines(file, [
      {
        type: "user",
        sessionId: "sess-1",
        cwd: "/home/user/proj",
        gitBranch: "feat/login",
        timestamp: "2026-08-05T11:00:00.000Z",
        message: { role: "user", content: "Fix the flaky login test\nsecond line" },
      },
      {
        type: "assistant",
        sessionId: "sess-1",
        timestamp: "2026-08-05T11:05:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "on it" }] },
      },
    ]);

    const [session] = await new ClaudeCodeSessionReader([join(root, "claude")]).read();

    expect(session).toBeDefined();
    expect(session?.sessionId).toBe("sess-1");
    expect(session?.title).toBe("Fix the flaky login test");
    expect(session?.cwd).toBe("/home/user/proj");
    expect(session?.branch).toBe("feat/login");
    expect(session?.messageCount).toBe(2);
    expect(session?.createdAt).toBe(Date.parse("2026-08-05T11:00:00.000Z"));
    expect(session?.updatedAt).toBe(Date.parse("2026-08-05T11:05:00.000Z"));
    expect(session?.explicitStatus).toBeNull();
  });

  test("prefers the summary record and skips slash-command envelopes", async () => {
    const file = join(root, "claude", "proj", "sess-2.jsonl");
    await writeLines(file, [
      { type: "summary", summary: "Refactor the billing module" },
      {
        type: "user",
        sessionId: "sess-2",
        isMeta: true,
        timestamp: "2026-08-05T11:00:00.000Z",
        message: { role: "user", content: "<command-name>/health</command-name>" },
      },
      {
        type: "user",
        sessionId: "sess-2",
        timestamp: "2026-08-05T11:01:00.000Z",
        message: { role: "user", content: "go" },
      },
    ]);

    const [session] = await new ClaudeCodeSessionReader([join(root, "claude")]).read();
    expect(session?.title).toBe("Refactor the billing module");
  });

  test("marks a transcript whose last turn is an API error as failed", async () => {
    const file = join(root, "claude", "proj", "sess-3.jsonl");
    await writeLines(file, [
      {
        type: "user",
        sessionId: "sess-3",
        timestamp: "2026-08-05T11:00:00.000Z",
        message: { role: "user", content: "hello" },
      },
      {
        type: "assistant",
        sessionId: "sess-3",
        isApiErrorMessage: true,
        timestamp: "2026-08-05T11:00:30.000Z",
        message: { role: "assistant", content: "API Error: overloaded" },
      },
    ]);

    const [session] = await new ClaudeCodeSessionReader([join(root, "claude")]).read();
    expect(session?.explicitStatus).toBe("failed");
  });

  test("tolerates truncated lines from a session still being written", async () => {
    const file = join(root, "claude", "proj", "sess-4.jsonl");
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({
        type: "user",
        sessionId: "sess-4",
        timestamp: "2026-08-05T11:00:00.000Z",
        message: { role: "user", content: "still going" },
      })}\n{"type":"assistant","messa`,
      "utf-8"
    );

    const [session] = await new ClaudeCodeSessionReader([join(root, "claude")]).read();
    expect(session?.messageCount).toBe(1);
    expect(session?.title).toBe("still going");
  });

  test("ignores directories with no transcripts", async () => {
    await mkdir(join(root, "claude", "empty-project"), { recursive: true });
    expect(await new ClaudeCodeSessionReader([join(root, "claude")]).read()).toEqual([]);
  });
});

describe("OpenCodeSessionReader", () => {
  test("reads sessions from either storage layout and counts messages", async () => {
    const storage = join(root, "opencode", "project", "abc123", "storage");
    await writeJson(join(storage, "session", "proj", "ses_1.json"), {
      id: "ses_1",
      title: "Add pagination to the repo list",
      directory: "/home/user/dev/vibe-code",
      time: { created: 1_754_000_000_000, updated: 1_754_000_600_000 },
    });
    await writeJson(join(storage, "message", "ses_1", "msg_1.json"), { id: "msg_1" });
    await writeJson(join(storage, "message", "ses_1", "msg_2.json"), { id: "msg_2" });

    const [session] = await new OpenCodeSessionReader([join(root, "opencode")]).read();

    expect(session?.sessionId).toBe("ses_1");
    expect(session?.title).toBe("Add pagination to the repo list");
    expect(session?.cwd).toBe("/home/user/dev/vibe-code");
    expect(session?.messageCount).toBe(2);
    expect(session?.createdAt).toBe(1_754_000_000_000);
    expect(session?.updatedAt).toBe(1_754_000_600_000);
  });

  test("skips sub-agent sessions", async () => {
    const storage = join(root, "opencode", "storage");
    await writeJson(join(storage, "session", "ses_parent.json"), {
      id: "ses_parent",
      title: "Parent",
      time: { created: 1, updated: 2 },
    });
    await writeJson(join(storage, "session", "ses_child.json"), {
      id: "ses_child",
      parentID: "ses_parent",
      title: "Child",
      time: { created: 1, updated: 2 },
    });

    const sessions = await new OpenCodeSessionReader([join(root, "opencode")]).read();
    expect(sessions.map((s) => s.sessionId)).toEqual(["ses_parent"]);
  });

  test("treats a recorded completion time as done", async () => {
    await writeJson(join(root, "opencode", "storage", "session", "ses_done.json"), {
      id: "ses_done",
      title: "Done",
      time: { created: 1, updated: 2, completed: 3 },
    });

    const [session] = await new OpenCodeSessionReader([join(root, "opencode")]).read();
    expect(session?.explicitStatus).toBe("done");
  });
});

describe("AntigravitySessionReader", () => {
  test("reads a session object regardless of field naming", async () => {
    await writeJson(join(root, "ag", "session-1.json"), {
      session_id: "ag-1",
      name: "Wire up the settings page",
      workspacePath: "/home/user/dev/app",
      created_at: "2026-08-05T10:00:00.000Z",
      last_active_at: "2026-08-05T10:30:00.000Z",
      state: "completed",
      messages: [{}, {}, {}],
    });

    const [session] = await new AntigravitySessionReader([join(root, "ag")]).read();

    expect(session?.sessionId).toBe("ag-1");
    expect(session?.title).toBe("Wire up the settings page");
    expect(session?.cwd).toBe("/home/user/dev/app");
    expect(session?.messageCount).toBe(3);
    expect(session?.explicitStatus).toBe("done");
    expect(session?.updatedAt).toBe(Date.parse("2026-08-05T10:30:00.000Z"));
  });

  test("unwraps a `{ sessions: [...] }` container", async () => {
    await writeJson(join(root, "ag", "index.json"), {
      sessions: [
        { id: "ag-2", title: "One", updatedAt: "2026-08-05T10:00:00.000Z" },
        { id: "ag-3", title: "Two", updatedAt: "2026-08-05T11:00:00.000Z" },
      ],
    });

    const sessions = await new AntigravitySessionReader([join(root, "ag")]).read();
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(["ag-2", "ag-3"]);
  });

  test("folds a JSONL event log into a single session", async () => {
    await writeLines(join(root, "ag", "ag-4.jsonl"), [
      { sessionId: "ag-4", cwd: "/home/user/dev/api", timestamp: "2026-08-05T09:00:00.000Z" },
      {
        role: "user",
        content: "Migrate the auth service",
        timestamp: "2026-08-05T09:01:00.000Z",
      },
      { role: "assistant", content: "sure", timestamp: "2026-08-05T09:02:00.000Z" },
      { status: "error", timestamp: "2026-08-05T09:03:00.000Z" },
    ]);

    const [session] = await new AntigravitySessionReader([join(root, "ag")]).read();

    expect(session?.sessionId).toBe("ag-4");
    expect(session?.title).toBe("Migrate the auth service");
    expect(session?.cwd).toBe("/home/user/dev/api");
    expect(session?.messageCount).toBe(2);
    expect(session?.explicitStatus).toBe("failed");
    expect(session?.updatedAt).toBe(Date.parse("2026-08-05T09:03:00.000Z"));
  });

  test("ignores files that carry no session at all", async () => {
    await writeJson(join(root, "ag", "config.json"), { theme: "dark" });
    const sessions = await new AntigravitySessionReader([join(root, "ag")]).read();
    // A bare object still yields a card keyed by filename only if it has no id;
    // config-shaped files fall back to the filename, so assert it is not titled.
    expect(sessions.every((s) => s.title === "Untitled session")).toBe(true);
  });
});

describe("SessionService", () => {
  function service(now = NOW) {
    return new SessionService({
      readers: [
        new OpenCodeSessionReader([join(root, "opencode")]),
        new ClaudeCodeSessionReader([join(root, "claude")]),
        new AntigravitySessionReader([join(root, "ag")]),
      ],
      now: () => now,
      cacheTtlMs: 0,
    });
  }

  test("merges every CLI into one board, newest first", async () => {
    await writeJson(join(root, "opencode", "storage", "session", "ses_1.json"), {
      id: "ses_1",
      title: "OpenCode work",
      directory: "/home/user/dev/vibe-code",
      time: { created: NOW - 2 * HOUR, updated: NOW - 2 * MINUTE },
    });
    await writeLines(join(root, "claude", "proj", "sess-1.jsonl"), [
      {
        type: "user",
        sessionId: "sess-1",
        cwd: "/home/user/dev/api",
        timestamp: new Date(NOW - 3 * HOUR).toISOString(),
        message: { role: "user", content: "Claude work" },
      },
    ]);
    await writeJson(join(root, "ag", "ag-1.json"), {
      id: "ag-1",
      title: "Antigravity work",
      cwd: "/home/user/dev/web",
      updatedAt: new Date(NOW - 40 * HOUR).toISOString(),
    });

    const board = await service().list();

    expect(board.cards.map((c) => c.id)).toEqual([
      "opencode:ses_1",
      "claude-code:sess-1",
      "antigravity:ag-1",
    ]);
    expect(board.cards.map((c) => c.status)).toEqual(["active", "idle", "done"]);
    expect(board.cards[0]?.project).toBe("vibe-code");
    expect(board.sources.map((s) => s.source)).toEqual(["opencode", "claude-code", "antigravity"]);
    expect(board.sources.every((s) => s.error === null)).toBe(true);
  });

  test("reports a source as unavailable when its store is absent", async () => {
    const board = await service().list();
    expect(board.cards).toEqual([]);
    for (const source of board.sources) {
      expect(source.available).toBe(false);
      expect(source.roots).toEqual([]);
      expect(source.cards).toBe(0);
    }
  });

  test("cards expose only the projected fields", async () => {
    await writeJson(join(root, "opencode", "storage", "session", "ses_1.json"), {
      id: "ses_1",
      title: "Minimal card",
      directory: "/home/user/dev/vibe-code",
      // Fields the projection deliberately drops:
      version: "0.14.2",
      projectID: "abc",
      share: { url: "https://opencode.ai/s/x" },
      time: { created: NOW - HOUR, updated: NOW },
    });

    const [card] = (await service().list()).cards;

    expect(Object.keys(card ?? {}).sort()).toEqual([
      "branch",
      "createdAt",
      "id",
      "messageCount",
      "project",
      "sessionId",
      "source",
      "status",
      "title",
      "updatedAt",
    ]);
  });

  test("filters by source and honours the limit", async () => {
    await writeJson(join(root, "ag", "ag-1.json"), { id: "ag-1", title: "A", updatedAt: NOW });
    await writeJson(join(root, "ag", "ag-2.json"), { id: "ag-2", title: "B", updatedAt: NOW - 1 });
    await writeJson(join(root, "opencode", "storage", "session", "ses_1.json"), {
      id: "ses_1",
      title: "C",
      time: { created: NOW, updated: NOW },
    });

    const onlyAg = await service().list({ source: "antigravity" });
    expect(onlyAg.cards.map((c) => c.sessionId).sort()).toEqual(["ag-1", "ag-2"]);

    const limited = await service().list({ limit: 1 });
    expect(limited.cards).toHaveLength(1);
    // The unfiltered board is still reported per source.
    expect(limited.sources.find((s) => s.source === "opencode")?.cards).toBe(1);
  });

  test("serves repeat reads from cache within the TTL", async () => {
    await writeJson(join(root, "ag", "ag-1.json"), { id: "ag-1", title: "A", updatedAt: NOW });

    const cached = new SessionService({
      readers: [new AntigravitySessionReader([join(root, "ag")])],
      now: () => NOW,
      cacheTtlMs: 60_000,
    });

    const first = await cached.list();
    await writeJson(join(root, "ag", "ag-2.json"), { id: "ag-2", title: "B", updatedAt: NOW });

    expect((await cached.list()).cards).toHaveLength(first.cards.length);
    expect((await cached.list({ refresh: true })).cards).toHaveLength(first.cards.length + 1);
  });

  test("a failing reader degrades to an error on its own source", async () => {
    const boom = {
      source: "opencode" as const,
      roots: () => [],
      read: () => Promise.reject(new Error("permission denied")),
    };
    const board = await new SessionService({ readers: [boom], now: () => NOW }).list();

    expect(board.cards).toEqual([]);
    expect(board.sources[0]?.error).toBe("permission denied");
  });
});
