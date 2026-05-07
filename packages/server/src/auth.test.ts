import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { authMiddleware, authStatus, createAuthRouter, getCurrentUser } from "./auth";
import { createDb } from "./db";

function makeDb() {
  return createDb(":memory:");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function insertMockSession(
  db: ReturnType<typeof createDb>,
  token: string,
  githubId: string,
  username: string,
  displayName: string | null,
  avatarUrl: string | null,
  accessToken: string,
  expiresAt: string
) {
  db.raw
    .prepare(
      `INSERT INTO auth_sessions (id, github_id, username, display_name, avatar_url, access_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(hashToken(token), githubId, username, displayName, avatarUrl, accessToken, expiresAt);
}

function makeContext(
  _cookies: Record<string, string> = {},
  url: string = "http://localhost/",
  headers: Record<string, string> = {}
): Context {
  return {
    req: {
      url,
      header: (name: string) => headers[name] || headers[name.toLowerCase()],
    },
    json: (body: any, status?: number) => ({ body, status }),
    redirect: (url: string) => ({ redirect: url }),
  } as unknown as Context;
}

// Mock hono/cookie
mock.module("hono/cookie", () => ({
  getCookie: (c: Context, name: string) => {
    // Extract cookies from mock context if we set them, otherwise use a simulated cookie string
    const cookieHeader = c.req.header("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`(^| )${name}=([^;]+)`));
      if (match) return match[2];
    }
    return (c as any).mockCookies?.[name];
  },
  setCookie: (c: Context, name: string, value: string) => {
    if (!(c as any).mockCookies) (c as any).mockCookies = {};
    (c as any).mockCookies[name] = value;
  },
  deleteCookie: (c: Context, name: string) => {
    if ((c as any).mockCookies) delete (c as any).mockCookies[name];
  },
}));

describe("auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getCurrentUser", () => {
    it("returns null if auth is not enabled", () => {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;
      delete process.env.GITHUB_OAUTH_CLIENT_SECRET;

      const db = makeDb();
      const c = makeContext();

      expect(getCurrentUser(db, c)).toBeNull();
    });

    it("returns null if no session cookie", () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const c = makeContext();

      expect(getCurrentUser(db, c)).toBeNull();
    });

    it("returns user if session is valid", () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const token = "test-token";
      const expiresAt = new Date(Date.now() + 1000000).toISOString();

      insertMockSession(db, token, "123", "testuser", "Test User", "http://avatar", "access-token", expiresAt);

      const c = makeContext();
      (c as any).mockCookies = { vibe_session: token };

      const user = getCurrentUser(db, c);
      expect(user).not.toBeNull();
      expect(user?.username).toBe("testuser");
      expect(user?.githubId).toBe("123");
      expect(user?.displayName).toBe("Test User");
      expect(user?.avatarUrl).toBe("http://avatar");
    });

    it("returns null if session is expired", () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const token = "test-token";
      const expiresAt = new Date(Date.now() - 1000000).toISOString(); // expired

      insertMockSession(db, token, "123", "testuser", "Test User", "http://avatar", "access-token", expiresAt);

      const c = makeContext();
      (c as any).mockCookies = { vibe_session: token };

      expect(getCurrentUser(db, c)).toBeNull();
    });
  });

  describe("authStatus", () => {
    it("returns disabled status if not configured", () => {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;
      delete process.env.GITHUB_OAUTH_CLIENT_SECRET;

      const db = makeDb();
      const c = makeContext();

      const status = authStatus(db, c);
      expect(status.enabled).toBeFalse();
      expect(status.authenticated).toBeTrue(); // Always "authenticated" if disabled
      expect(status.user).toBeNull();
    });

    it("returns enabled status but not authenticated if no session", () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const c = makeContext();

      const status = authStatus(db, c);
      expect(status.enabled).toBeTrue();
      expect(status.authenticated).toBeFalse();
      expect(status.user).toBeNull();
    });

    it("returns enabled and authenticated status if valid session", () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const token = "test-token";
      const expiresAt = new Date(Date.now() + 1000000).toISOString();
      insertMockSession(db, token, "123", "testuser", null, null, "access-token", expiresAt);

      const c = makeContext();
      (c as any).mockCookies = { vibe_session: token };

      const status = authStatus(db, c);
      expect(status.enabled).toBeTrue();
      expect(status.authenticated).toBeTrue();
      expect(status.user?.username).toBe("testuser");
    });
  });

  describe("authMiddleware", () => {
    it("calls next() if auth is disabled", async () => {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;
      delete process.env.GITHUB_OAUTH_CLIENT_SECRET;

      const db = makeDb();
      const c = makeContext();
      const middleware = authMiddleware(db);

      let nextCalled = false;
      await middleware(c, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBeTrue();
    });

    it("bypasses auth for /api/auth/ paths", async () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const c = makeContext({}, "http://localhost/api/auth/github/start");
      const middleware = authMiddleware(db);

      let nextCalled = false;
      await middleware(c, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBeTrue();
    });

    it("bypasses auth for /api/health", async () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const c = makeContext({}, "http://localhost/api/health");
      const middleware = authMiddleware(db);

      let nextCalled = false;
      await middleware(c, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBeTrue();
    });

    it("returns 401 if auth required but no session", async () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const c = makeContext({}, "http://localhost/api/tasks");
      const middleware = authMiddleware(db);

      let nextCalled = false;
      const result = await middleware(c, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBeFalse();
      expect((result as any).status).toBe(401);
      expect((result as any).body).toEqual({
        error: "unauthorized",
        message: "GitHub login required",
      });
    });

    it("calls next() and sets settings if valid session", async () => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

      const db = makeDb();
      const token = "test-token";
      const expiresAt = new Date(Date.now() + 1000000).toISOString();
      insertMockSession(db, token, "123", "testuser", null, null, "access-token", expiresAt);

      const c = makeContext({}, "http://localhost/api/tasks");
      (c as any).mockCookies = { vibe_session: token };
      const middleware = authMiddleware(db);

      let nextCalled = false;
      await middleware(c, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBeTrue();
      expect(db.settings.get("github_token")).toBe("access-token");
      expect(db.settings.get("github_username")).toBe("testuser");
    });
  });

  describe("createAuthRouter", () => {
    it("creates router with correct endpoints", () => {
      const db = makeDb();
      const router = createAuthRouter(db);
      expect(router).toBeInstanceOf(Hono);
    });
  });
});
