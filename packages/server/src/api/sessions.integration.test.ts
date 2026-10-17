import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AntigravitySessionReader } from "../sessions/readers/antigravity";
import { OpenCodeSessionReader } from "../sessions/readers/opencode";
import { SessionService } from "../sessions/session-service";
import type { TerminalController } from "../terminal/controller";
import { createSessionsRouter } from "./sessions";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vibe-sessions-api-"));

  const sessionFile = join(root, "opencode", "storage", "session", "ses_1.json");
  await mkdir(join(sessionFile, ".."), { recursive: true });
  await writeFile(
    sessionFile,
    JSON.stringify({
      id: "ses_1",
      title: "Ship the sessions board",
      directory: "/home/user/dev/vibe-code",
      time: { created: NOW - 600_000, updated: NOW - 60_000 },
    }),
    "utf-8"
  );

  const agFile = join(root, "ag", "ag-1.json");
  await mkdir(join(agFile, ".."), { recursive: true });
  await writeFile(
    agFile,
    JSON.stringify({ id: "ag-1", title: "Antigravity run", updatedAt: NOW - 120_000 }),
    "utf-8"
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function buildApp(overrides: Partial<Record<keyof TerminalController, unknown>> = {}) {
  const service = new SessionService({
    readers: [
      new OpenCodeSessionReader([join(root, "opencode")]),
      new AntigravitySessionReader([join(root, "ag")]),
    ],
    now: () => NOW,
    cacheTtlMs: 0,
  });
  const terminals = {
    listExternal: () => [],
    startExternal: async () => ({
      id: "ext:opencode:ses_1",
      source: "opencode" as const,
      sessionId: "ses_1",
      cwd: "/home/user/dev/vibe-code",
    }),
    stopExternal: () => true,
    ...overrides,
  } as unknown as TerminalController;
  const app = new Hono();
  app.route("/api/sessions", createSessionsRouter(service, terminals));
  return app;
}

describe("GET /api/sessions", () => {
  it("returns every local CLI session as a card", async () => {
    const res = await buildApp().request("/api/sessions");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.cards.map((c: { id: string }) => c.id)).toEqual([
      "opencode:ses_1",
      "antigravity:ag-1",
    ]);
    expect(body.data.cards[0].status).toBe("active");
    expect(body.data.cards[0].project).toBe("vibe-code");
    expect(body.data.scannedAt).toBe("2026-08-05T12:00:00.000Z");
  });

  it("filters by source", async () => {
    const res = await buildApp().request("/api/sessions?source=antigravity");
    const body = await res.json();

    expect(body.data.cards).toHaveLength(1);
    expect(body.data.cards[0].source).toBe("antigravity");
  });

  it("applies the limit", async () => {
    const res = await buildApp().request("/api/sessions?limit=1");
    const body = await res.json();
    expect(body.data.cards).toHaveLength(1);
  });

  it("rejects an unknown source", async () => {
    const res = await buildApp().request("/api/sessions?source=cursor");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_query");
  });

  it("rejects a non-numeric limit", async () => {
    const res = await buildApp().request("/api/sessions?limit=abc");
    expect(res.status).toBe(400);
  });
});

describe("/api/sessions/:source/:sessionId/terminal", () => {
  const post = (app: Hono, path: string, body: unknown = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("opens a terminal in the session's own directory and resumes the CLI", async () => {
    const calls: unknown[] = [];
    const app = buildApp({
      startExternal: async (request: unknown) => {
        calls.push(request);
        return { id: "ext:opencode:ses_1", source: "opencode", sessionId: "ses_1", cwd: "/d" };
      },
    });

    const res = await post(app, "/api/sessions/opencode/ses_1/terminal", { cols: 100, rows: 30 });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe("ext:opencode:ses_1");
    expect(calls).toEqual([
      {
        source: "opencode",
        sessionId: "ses_1",
        cwd: "/home/user/dev/vibe-code",
        cols: 100,
        rows: 30,
      },
    ]);
  });

  it("refuses a session with no known working directory", async () => {
    const res = await post(buildApp(), "/api/sessions/antigravity/ag-1/terminal");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  it("404s an unknown session and rejects an unknown CLI", async () => {
    expect((await post(buildApp(), "/api/sessions/opencode/nope/terminal")).status).toBe(404);
    expect((await post(buildApp(), "/api/sessions/cursor/ses_1/terminal")).status).toBe(400);
  });

  it("reports and stops the terminal it owns", async () => {
    const app = buildApp({
      listExternal: () => [
        { id: "ext:opencode:ses_1", source: "opencode", sessionId: "ses_1", cwd: "/d" },
      ],
    });
    const state = await app.request("/api/sessions/opencode/ses_1/terminal");
    expect((await state.json()).data.id).toBe("ext:opencode:ses_1");

    const stop = await app.request("/api/sessions/opencode/ses_1/terminal", { method: "DELETE" });
    expect((await stop.json()).data.stopped).toBe(true);
  });
});
