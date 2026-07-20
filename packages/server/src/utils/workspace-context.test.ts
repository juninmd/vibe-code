import { describe, expect, it, beforeEach, mock } from "bun:test";
import { getWorkspaceContext, requireWorkspaceContext } from "./workspace-context";
import { createDb, type Db } from "../db";
import type { AuthUser } from "@vibe-code/shared";
import type { Context } from "hono";

describe("Workspace Context Utilities", () => {
  let db: Db;
  let user: AuthUser;

  beforeEach(() => {
    db = createDb(":memory:");
    user = {
      githubId: "123",
      username: "testuser",
      displayName: "Test User",
    };
  });

  const createMockContext = (options: {
    header?: string;
    query?: string;
    envWs?: string;
    body?: any;
    method?: string;
  }): Context => {
    return {
      req: {
        method: options.method || "GET",
        header: (name: string) => (name === "x-workspace-id" ? options.header : undefined),
        query: (name: string) => (name === "workspace_id" ? options.query : undefined),
        json: async () => {
          if (options.body === "error") throw new Error("Invalid JSON");
          return options.body;
        },
      } as any,
      env: {
        workspaceId: options.envWs,
      } as any,
    } as Context;
  };

  describe("getWorkspaceContext", () => {
    it("should return null if user is null", async () => {
      const c = createMockContext({});
      const result = await getWorkspaceContext(c, db, null);
      expect(result).toBeNull();
    });

    it("should extract workspaceId from c.env.workspaceId", async () => {
      const c = createMockContext({ envWs: "env-ws" });
      const result = await getWorkspaceContext(c, db, user);
      expect(result).toEqual({ workspaceId: "env-ws", userId: "testuser" });
    });

    it("should extract workspaceId from header x-workspace-id", async () => {
      const c = createMockContext({ header: "header-ws" });
      const result = await getWorkspaceContext(c, db, user);
      expect(result).toEqual({ workspaceId: "header-ws", userId: "testuser" });
    });

    it("should extract workspaceId from query workspace_id", async () => {
      const c = createMockContext({ query: "query-ws" });
      const result = await getWorkspaceContext(c, db, user);
      expect(result).toEqual({ workspaceId: "query-ws", userId: "testuser" });
    });

    it("should extract workspaceId from body json in non-GET request", async () => {
      const c = createMockContext({ method: "POST", body: { workspace_id: "body-ws" } });
      const result = await getWorkspaceContext(c, db, user);
      expect(result).toEqual({ workspaceId: "body-ws", userId: "testuser" });
    });

    it("should ignore invalid JSON body", async () => {
      const c = createMockContext({ method: "POST", body: "error" });
      const result = await getWorkspaceContext(c, db, user);
      expect(result).toEqual({ workspaceId: "ws-testuser", userId: "testuser" });
    });

    it("should prioritize c.env > header > query > body", async () => {
      let c = createMockContext({ envWs: "env", header: "header", query: "query", body: { workspace_id: "body" }, method: "POST" });
      let result = await getWorkspaceContext(c, db, user);
      expect(result?.workspaceId).toBe("env");

      // Reset db to avoid cross-workspace access error
      db = createDb(":memory:");
      c = createMockContext({ header: "header", query: "query", body: { workspace_id: "body" }, method: "POST" });
      result = await getWorkspaceContext(c, db, user);
      expect(result?.workspaceId).toBe("header");

      // Reset db again
      db = createDb(":memory:");
      c = createMockContext({ query: "query", body: { workspace_id: "body" }, method: "POST" });
      result = await getWorkspaceContext(c, db, user);
      expect(result?.workspaceId).toBe("query");
    });

    it("should auto-assign and create default workspace if none provided", async () => {
      const c = createMockContext({});
      const result = await getWorkspaceContext(c, db, user);

      expect(result).toEqual({ workspaceId: "ws-testuser", userId: "testuser" });
      expect(db.settings.get("user_workspace:testuser")).toBe("ws-testuser");

      const ws = db.workspaces.get("ws-testuser");
      expect(ws).toBeDefined();
      expect(ws?.slug).toBe("testuser");
      expect(ws?.name).toBe("Test User");
    });

    it("should use existing auto-assigned workspace if none provided", async () => {
      db.settings.set("user_workspace:testuser", "existing-ws");
      const c = createMockContext({});
      const result = await getWorkspaceContext(c, db, user);

      expect(result).toEqual({ workspaceId: "existing-ws", userId: "testuser" });
    });

    it("should return null for cross-workspace access attempt", async () => {
      db.settings.set("user_workspace:testuser", "my-ws");
      const c = createMockContext({ header: "other-ws" });
      const result = await getWorkspaceContext(c, db, user);

      expect(result).toBeNull();
    });

    it("should call ensureWorkspaceExists and create base slug if available", async () => {
      const c = createMockContext({ header: "my-custom-ws" });
      await getWorkspaceContext(c, db, user);

      const ws = db.workspaces.get("my-custom-ws");
      expect(ws).toBeDefined();
      expect(ws?.slug).toBe("testuser");
    });

    it("should call ensureWorkspaceExists and create suffixed slug if base slug is taken", async () => {
      // pre-create workspace to take up base slug 'testuser'
      db.workspaces.create({
        id: "taken-ws",
        name: "Taken",
        slug: "testuser",
        description: "Taken",
      });

      const c = createMockContext({ header: "my-custom-ws" });
      await getWorkspaceContext(c, db, user);

      const ws = db.workspaces.get("my-custom-ws");
      expect(ws).toBeDefined();
      expect(ws?.slug).toBe("testuser-my-custom-ws");
    });

    it("should do nothing in ensureWorkspaceExists if workspace already exists", async () => {
      db.workspaces.create({
        id: "existing-ws",
        name: "Existing",
        slug: "existing-slug",
        description: "Existing",
      });
      const c = createMockContext({ header: "existing-ws" });
      await getWorkspaceContext(c, db, user);

      const ws = db.workspaces.get("existing-ws");
      expect(ws?.slug).toBe("existing-slug"); // unchanged
    });

    it("should fallback to 'personal' if slugify results in empty string", async () => {
      const userWithoutAlphanumeric: AuthUser = {
        githubId: "123",
        username: "---",
      };
      const c = createMockContext({ header: "my-ws" });
      await getWorkspaceContext(c, db, userWithoutAlphanumeric);

      const ws = db.workspaces.get("my-ws");
      expect(ws?.slug).toBe("personal");
    });

    it("should fallback to 'personal' with suffix if slugify results in empty string and personal is taken", async () => {
      const userWithoutAlphanumeric: AuthUser = {
        githubId: "123",
        username: "---",
      };

      db.workspaces.create({
        id: "taken",
        name: "Taken",
        slug: "personal",
        description: "Taken"
      });

      const c = createMockContext({ header: "my-ws" });
      await getWorkspaceContext(c, db, userWithoutAlphanumeric);

      const ws = db.workspaces.get("my-ws");
      expect(ws?.slug).toBe("personal-my-ws");
    });
  });

  describe("requireWorkspaceContext", () => {
    it("should return workspaceId on success", async () => {
      const c = createMockContext({ header: "ws-1" });
      const result = await requireWorkspaceContext(c, db, user);
      expect(result).toBe("ws-1");
    });

    it("should return null on failure (e.g., cross-workspace)", async () => {
      db.settings.set("user_workspace:testuser", "my-ws");
      const c = createMockContext({ header: "other-ws" });
      const result = await requireWorkspaceContext(c, db, user);
      expect(result).toBeNull();
    });
  });
});