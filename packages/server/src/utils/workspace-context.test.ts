import { beforeEach, describe, expect, it } from "bun:test";
import type { AuthUser } from "@vibe-code/shared";
import type { Context } from "hono";
import { resolveAccountForIdentity } from "../accounts";
import { createDb, type Db } from "../db";
import { getWorkspaceContext, requireWorkspaceContext } from "./workspace-context";

function accountUser(db: Db, email = "jr_acn@hotmail.com", subject = "1"): AuthUser {
  const { account } = resolveAccountForIdentity(db, {
    provider: "github",
    subject,
    email,
    username: "testuser",
    displayName: "Test User",
    avatarUrl: null,
    accessToken: "",
  });
  return {
    githubId: subject,
    username: "testuser",
    displayName: "Test User",
    accountId: account.id,
  };
}

function ownedWorkspace(db: Db, id: string, accountId: string, slug = id) {
  return db.workspaces.create({
    id,
    name: id,
    slug,
    ownerAccountId: accountId,
  });
}

describe("Workspace Context Utilities", () => {
  let db: Db;
  let user: AuthUser;

  beforeEach(() => {
    db = createDb(":memory:");
    user = accountUser(db);
  });

  const createMockContext = (options: {
    header?: string;
    query?: string;
    envWs?: string;
    body?: unknown;
    method?: string;
  }): Context =>
    ({
      req: {
        method: options.method || "GET",
        header: (name: string) => (name === "x-workspace-id" ? options.header : undefined),
        query: (name: string) => (name === "workspace_id" ? options.query : undefined),
        json: async () => {
          if (options.body === "error") throw new Error("Invalid JSON");
          return options.body;
        },
      },
      env: { workspaceId: options.envWs },
    }) as unknown as Context;

  describe("getWorkspaceContext", () => {
    it("returns null without an authenticated user", async () => {
      expect(await getWorkspaceContext(createMockContext({}), db, null)).toBeNull();
    });

    it("returns null for an API-key user (operator scope is handled elsewhere)", async () => {
      const operator: AuthUser = { githubId: "api-key", username: "api-key", provider: "api-key" };
      expect(await getWorkspaceContext(createMockContext({}), db, operator)).toBeNull();
    });

    it("uses c.env.workspaceId when the account owns it", async () => {
      ownedWorkspace(db, "env-ws", user.accountId as string);
      const result = await getWorkspaceContext(createMockContext({ envWs: "env-ws" }), db, user);
      expect(result).toEqual({ workspaceId: "env-ws", userId: user.accountId as string });
    });

    it("uses the x-workspace-id header when owned", async () => {
      ownedWorkspace(db, "header-ws", user.accountId as string);
      const result = await getWorkspaceContext(
        createMockContext({ header: "header-ws" }),
        db,
        user
      );
      expect(result).toEqual({ workspaceId: "header-ws", userId: user.accountId as string });
    });

    it("uses the workspace_id query when owned", async () => {
      ownedWorkspace(db, "query-ws", user.accountId as string);
      const result = await getWorkspaceContext(createMockContext({ query: "query-ws" }), db, user);
      expect(result).toEqual({ workspaceId: "query-ws", userId: user.accountId as string });
    });

    it("uses workspace_id from the body on non-GET requests when owned", async () => {
      ownedWorkspace(db, "body-ws", user.accountId as string);
      const result = await getWorkspaceContext(
        createMockContext({ method: "POST", body: { workspace_id: "body-ws" } }),
        db,
        user
      );
      expect(result).toEqual({ workspaceId: "body-ws", userId: user.accountId as string });
    });

    it("ignores an invalid JSON body", async () => {
      const result = await getWorkspaceContext(
        createMockContext({ method: "POST", body: "error" }),
        db,
        user
      );
      expect(result?.workspaceId).toBeDefined();
      expect(result?.userId).toBe(user.accountId);
    });

    it("prioritizes c.env > header > query", async () => {
      ownedWorkspace(db, "env", user.accountId as string);
      ownedWorkspace(db, "header", user.accountId as string);
      ownedWorkspace(db, "query", user.accountId as string);
      const c = createMockContext({
        envWs: "env",
        header: "header",
        query: "query",
        method: "POST",
        body: { workspace_id: "query" },
      });
      const result = await getWorkspaceContext(c, db, user);
      expect(result?.workspaceId).toBe("env");
    });

    it("creates a default workspace owned by the account when none is requested", async () => {
      const result = await getWorkspaceContext(createMockContext({}), db, user);
      expect(result?.userId).toBe(user.accountId);
      const ws = db.workspaces.get(result?.workspaceId as string);
      expect(ws?.name).toBe("Test User");
      expect(ws?.ownerAccountId).toBe(user.accountId);
      expect(ws?.slug).toStartWith("personal-");
    });

    it("reuses the account's default workspace on the next call", async () => {
      const first = await getWorkspaceContext(createMockContext({}), db, user);
      const second = await getWorkspaceContext(createMockContext({}), db, user);
      expect(second?.workspaceId).toBe(first?.workspaceId);
      expect(db.workspaces.listByOwner(user.accountId as string)).toHaveLength(1);
    });

    it("denies a workspace owned by another account", async () => {
      const other = accountUser(db, "juninho140695@gmail.com", "2");
      ownedWorkspace(db, "other-ws", other.accountId as string);
      const result = await getWorkspaceContext(createMockContext({ header: "other-ws" }), db, user);
      expect(result).toBeNull();
    });

    it("denies a workspace that does not exist", async () => {
      const result = await getWorkspaceContext(createMockContext({ header: "missing" }), db, user);
      expect(result).toBeNull();
    });

    it("denies a legacy workspace without an owner", async () => {
      db.workspaces.create({ id: "legacy", name: "Legacy", slug: "legacy" });
      const result = await getWorkspaceContext(createMockContext({ header: "legacy" }), db, user);
      expect(result).toBeNull();
    });

    it("keeps accounts isolated: each gets its own default", async () => {
      const other = accountUser(db, "juninho140695@gmail.com", "2");
      const mine = await getWorkspaceContext(createMockContext({}), db, user);
      const theirs = await getWorkspaceContext(createMockContext({}), db, other);
      expect(mine?.workspaceId).not.toBe(theirs?.workspaceId);
    });
  });

  describe("requireWorkspaceContext", () => {
    it("returns the workspace id for the owner", async () => {
      ownedWorkspace(db, "ws-1", user.accountId as string);
      expect(await requireWorkspaceContext(createMockContext({ header: "ws-1" }), db, user)).toBe(
        "ws-1"
      );
    });

    it("returns null when the account does not own the workspace", async () => {
      const other = accountUser(db, "juninho140695@gmail.com", "2");
      ownedWorkspace(db, "my-ws", other.accountId as string);
      expect(await requireWorkspaceContext(createMockContext({ header: "my-ws" }), db, user)).toBe(
        null
      );
    });
  });
});
