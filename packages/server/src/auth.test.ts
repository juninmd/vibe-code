import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import * as honoCookie from "hono/cookie";
import { authMiddleware, authStatus, checkApiKey, createAuthRouter, getCurrentUser } from "./auth";
import type { Db } from "./db";
import { createDb } from "./db";

let db: Db;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  db = createDb(":memory:");
  originalEnv = { ...process.env };
  // Clear auth related env vars by default
  delete process.env.VIBE_CODE_API_KEY;
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  delete process.env.GITHUB_ALLOWED_USERS;
  delete process.env.APP_URL;
  delete process.env.VIBE_CODE_PUBLIC_URL;
});

afterEach(() => {
  process.env = { ...originalEnv };
  mock.restore();
});

describe("checkApiKey", () => {
  it("returns false if API key is not configured", () => {
    delete process.env.VIBE_CODE_API_KEY;
    const ctx = {
      req: {
        header: () => "",
        url: "http://localhost/",
      },
    } as unknown as Context;
    expect(checkApiKey(ctx)).toBeFalse();
  });

  it("returns false if key is not provided in request", () => {
    process.env.VIBE_CODE_API_KEY = "supersecret";
    const ctx = {
      req: {
        header: () => "",
        url: "http://localhost/",
      },
    } as unknown as Context;
    expect(checkApiKey(ctx)).toBeFalse();
  });

  it("returns true if valid key is in Bearer header", () => {
    process.env.VIBE_CODE_API_KEY = "supersecret";
    const ctx = {
      req: {
        header: (name: string) => (name === "authorization" ? "Bearer supersecret" : ""),
        url: "http://localhost/",
      },
    } as unknown as Context;
    expect(checkApiKey(ctx)).toBeTrue();
  });

  it("returns true if valid key is in api_key query param", () => {
    process.env.VIBE_CODE_API_KEY = "supersecret";
    const ctx = {
      req: {
        header: () => "",
        url: "http://localhost/?api_key=supersecret",
      },
    } as unknown as Context;
    expect(checkApiKey(ctx)).toBeTrue();
  });

  it("returns false for incorrect key", () => {
    process.env.VIBE_CODE_API_KEY = "supersecret";
    const ctx = {
      req: {
        header: () => "",
        url: "http://localhost/?api_key=wrongsecret",
      },
    } as unknown as Context;
    expect(checkApiKey(ctx)).toBeFalse();
  });
});

describe("getCurrentUser", () => {
  it("returns null if auth is not enabled", () => {
    const ctx = {
      req: { header: () => "", url: "http://localhost/" },
    } as unknown as Context;
    expect(getCurrentUser(db, ctx)).toBeNull();
  });

  it("returns user if session is valid", () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

    const sessionToken = "my-token";
    const idHash = createHash("sha256").update(sessionToken).digest("hex");
    const expires = new Date(Date.now() + 100000).toISOString();

    db.raw
      .prepare(
        `INSERT OR REPLACE INTO auth_sessions
         (id, github_id, username, display_name, avatar_url, access_token, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(idHash, "123", "testuser", "Test User", "url", "token", expires);

    spyOn(honoCookie, "getCookie").mockReturnValue(sessionToken);

    const ctx = {
      req: {
        header: () => "",
        url: "http://localhost/",
      },
    } as unknown as Context;

    const user = getCurrentUser(db, ctx);
    expect(user).toBeDefined();
    expect(user?.username).toBe("testuser");
    expect(user?.displayName).toBe("Test User");
  });
});

describe("authStatus", () => {
  it("returns disabled status when no auth is configured", () => {
    const ctx = {} as unknown as Context;
    const status = authStatus(db, ctx);
    expect(status.enabled).toBeFalse();
    expect(status.authenticated).toBeTrue();
    expect(status.user).toBeNull();
  });

  it("returns api-key status when valid API key is present", () => {
    process.env.VIBE_CODE_API_KEY = "key";
    const ctx = {
      req: {
        header: () => "",
        url: "http://localhost/?api_key=key",
      },
    } as unknown as Context;
    const status = authStatus(db, ctx);
    expect(status.enabled).toBeTrue();
    expect(status.authenticated).toBeTrue();
    expect(status.user?.githubId).toBe("api-key");
  });

  it("returns user status when OAuth session is valid", () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "sec";

    const sessionToken = "valid-token";
    const idHash = createHash("sha256").update(sessionToken).digest("hex");
    const expires = new Date(Date.now() + 100000).toISOString();
    db.raw
      .prepare(
        `INSERT OR REPLACE INTO auth_sessions
         (id, github_id, username, display_name, avatar_url, access_token, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(idHash, "456", "oauthuser", "OAuth User", null, "token", expires);

    spyOn(honoCookie, "getCookie").mockReturnValue(sessionToken);

    const ctx = {
      req: {
        header: () => "",
        url: "http://localhost/",
      },
    } as unknown as Context;

    const status = authStatus(db, ctx);
    expect(status.enabled).toBeTrue();
    expect(status.authenticated).toBeTrue();
    expect(status.user?.username).toBe("oauthuser");
  });
});

describe("authMiddleware", () => {
  it("skips auth check if auth is disabled", async () => {
    const middleware = authMiddleware(db);
    const ctx = {
      req: { url: "http://localhost/protected" },
    } as unknown as Context;
    let called = false;
    await middleware(ctx, async () => {
      called = true;
    });
    expect(called).toBeTrue();
  });

  it("skips auth check for /api/auth/ and /api/health", async () => {
    process.env.VIBE_CODE_API_KEY = "key";
    const middleware = authMiddleware(db);

    let called = false;
    const ctxAuth = {
      req: { url: "http://localhost/api/auth/github/start" },
    } as unknown as Context;
    await middleware(ctxAuth, async () => {
      called = true;
    });
    expect(called).toBeTrue();

    called = false;
    const ctxHealth = { req: { url: "http://localhost/api/health" } } as unknown as Context;
    await middleware(ctxHealth, async () => {
      called = true;
    });
    expect(called).toBeTrue();
  });

  it("authorizes request with valid API key", async () => {
    process.env.VIBE_CODE_API_KEY = "supersecret";
    const middleware = authMiddleware(db);
    const ctx = {
      req: {
        url: "http://localhost/protected",
        header: () => "Bearer supersecret",
      },
    } as unknown as Context;

    let called = false;
    await middleware(ctx, async () => {
      called = true;
    });
    expect(called).toBeTrue();
  });

  it("blocks request if OAuth configured but session missing", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    const middleware = authMiddleware(db);

    let status = 0;
    let body: any = null;
    const ctx = {
      req: {
        url: "http://localhost/protected",
        header: () => "",
        raw: { headers: new Headers() },
      },
      json: (data: any, code: number) => {
        status = code;
        body = data;
        return "response";
      },
    } as unknown as Context;

    spyOn(honoCookie, "getCookie").mockReturnValue(undefined);

    await middleware(ctx, async () => {
      throw new Error("Should not be called");
    });
    expect(status).toBe(401);
    expect(body).toEqual({ error: "unauthorized", message: "GitHub login required" });
  });

  it("authorizes request with valid OAuth session", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

    const sessionToken = "token";
    const idHash = createHash("sha256").update(sessionToken).digest("hex");
    db.raw
      .prepare(
        `INSERT OR REPLACE INTO auth_sessions
         (id, github_id, username, display_name, avatar_url, access_token, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        idHash,
        "123",
        "uname",
        "uname",
        "url",
        "access",
        new Date(Date.now() + 100000).toISOString()
      );

    spyOn(honoCookie, "getCookie").mockReturnValue(sessionToken);

    const middleware = authMiddleware(db);
    const ctx = {
      req: { url: "http://localhost/protected", header: () => "" },
    } as unknown as Context;

    let called = false;
    await middleware(ctx, async () => {
      called = true;
    });
    expect(called).toBeTrue();
    expect(db.settings.get("github_token")).toBe("access");
    expect(db.settings.get("github_username")).toBe("uname");
  });
});

describe("createAuthRouter", () => {
  it("GET /me returns authStatus", async () => {
    const app = new Hono().route("/auth", createAuthRouter(db));
    const res = await app.request("http://localhost/auth/me");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.enabled).toBeFalse();
  });

  it("GET /github/start returns 503 if not configured", async () => {
    const app = new Hono().route("/auth", createAuthRouter(db));
    const res = await app.request("http://localhost/auth/github/start");
    expect(res.status).toBe(503);
  });

  it("GET /github/start redirects and sets state cookie if configured", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    process.env.VIBE_CODE_PUBLIC_URL = "http://my.app";

    const setCookieSpy = spyOn(honoCookie, "setCookie");

    const app = new Hono().route("/auth", createAuthRouter(db));
    const res = await app.request("http://localhost/auth/github/start");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("github.com/login/oauth/authorize");
    expect(setCookieSpy).toHaveBeenCalled();
  });

  it("POST /logout deletes session from db and cookie", async () => {
    const sessionToken = "my-token";
    spyOn(honoCookie, "getCookie").mockReturnValue(sessionToken);
    const deleteCookieSpy = spyOn(honoCookie, "deleteCookie");

    const app = new Hono().route("/auth", createAuthRouter(db));
    const res = await app.request("http://localhost/auth/logout", { method: "POST" });

    expect(res.status).toBe(200);
    expect(deleteCookieSpy).toHaveBeenCalled();
  });
});
