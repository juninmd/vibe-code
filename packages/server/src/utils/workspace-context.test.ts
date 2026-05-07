import { describe, expect, it, mock } from "bun:test";
import { getWorkspaceContext, requireWorkspaceContext } from "./workspace-context";
import { createDb } from "../db";
import type { Context } from "hono";

function makeDb() {
  return createDb(":memory:");
}

function makeContext(
  headers: Record<string, string> = {},
  query: Record<string, string> = {},
  env: Record<string, any> = {},
  method = "GET",
  body = {}
): Context {
  return {
    req: {
      header: (name: string) => headers[name] || headers[name.toLowerCase()],
      query: (name: string) => query[name],
      method,
      json: async () => body,
    },
    env,
  } as unknown as Context;
}

describe("getWorkspaceContext", () => {
  it("returns null if no user is provided", async () => {
    const db = makeDb();
    const c = makeContext();
    const result = await getWorkspaceContext(c, db, null);
    expect(result).toBeNull();
  });

  it("returns null if no workspace_id can be extracted", async () => {
    const db = makeDb();
    const c = makeContext();
    const user = { username: "testuser", githubId: "123" };
    const result = await getWorkspaceContext(c, db, user);
    expect(result).toBeNull();
  });

  it("extracts workspace_id from env", async () => {
    const db = makeDb();
    const c = makeContext({}, {}, { workspaceId: "env-ws" });
    const user = { username: "testuser", githubId: "123" };
    const result = await getWorkspaceContext(c, db, user);
    expect(result).toEqual({ workspaceId: "env-ws", userId: "testuser" });
    expect(db.settings.get("user_workspace:testuser")).toBe("env-ws");
  });

  it("extracts workspace_id from header", async () => {
    const db = makeDb();
    const c = makeContext({ "x-workspace-id": "header-ws" });
    const user = { username: "testuser", githubId: "123" };
    const result = await getWorkspaceContext(c, db, user);
    expect(result).toEqual({ workspaceId: "header-ws", userId: "testuser" });
    expect(db.settings.get("user_workspace:testuser")).toBe("header-ws");
  });

  it("extracts workspace_id from query", async () => {
    const db = makeDb();
    const c = makeContext({}, { workspace_id: "query-ws" });
    const user = { username: "testuser", githubId: "123" };
    const result = await getWorkspaceContext(c, db, user);
    expect(result).toEqual({ workspaceId: "query-ws", userId: "testuser" });
    expect(db.settings.get("user_workspace:testuser")).toBe("query-ws");
  });

  it("extracts workspace_id from body for non-GET requests", async () => {
    const db = makeDb();
    const c = makeContext({}, {}, {}, "POST", { workspace_id: "body-ws" });
    const user = { username: "testuser", githubId: "123" };
    const result = await getWorkspaceContext(c, db, user);
    expect(result).toEqual({ workspaceId: "body-ws", userId: "testuser" });
    expect(db.settings.get("user_workspace:testuser")).toBe("body-ws");
  });

  it("handles invalid json in body for non-GET requests gracefully", async () => {
    const db = makeDb();
    const req = {
      header: () => undefined,
      query: () => undefined,
      method: "POST",
      json: async () => { throw new Error("Invalid JSON"); }
    };
    const c = { req, env: {} } as unknown as Context;
    const user = { username: "testuser", githubId: "123" };
    const result = await getWorkspaceContext(c, db, user);
    expect(result).toBeNull();
  });

  it("returns null if requested workspace does not match authorized workspace", async () => {
    const db = makeDb();
    db.settings.set("user_workspace:testuser", "authorized-ws");
    const c = makeContext({}, { workspace_id: "unauthorized-ws" });
    const user = { username: "testuser", githubId: "123" };
    const result = await getWorkspaceContext(c, db, user);
    expect(result).toBeNull();
  });

  it("returns workspace context if it matches authorized workspace", async () => {
    const db = makeDb();
    db.settings.set("user_workspace:testuser", "authorized-ws");
    const c = makeContext({}, { workspace_id: "authorized-ws" });
    const user = { username: "testuser", githubId: "123" };
    const result = await getWorkspaceContext(c, db, user);
    expect(result).toEqual({ workspaceId: "authorized-ws", userId: "testuser" });
  });
});

describe("requireWorkspaceContext", () => {
  it("returns null if getWorkspaceContext returns null", async () => {
    const db = makeDb();
    const c = makeContext();
    const result = await requireWorkspaceContext(c, db, null);
    expect(result).toBeNull();
  });

  it("returns workspaceId if valid", async () => {
    const db = makeDb();
    const c = makeContext({}, { workspace_id: "valid-ws" });
    const user = { username: "testuser", githubId: "123" };
    const result = await requireWorkspaceContext(c, db, user);
    expect(result).toBe("valid-ws");
  });
});
