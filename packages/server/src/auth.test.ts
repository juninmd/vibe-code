import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as honoCookie from "hono/cookie";
import { authMiddleware, authStatus, checkApiKey, createAuthRouter, getCurrentUser } from "./auth";

function createMockContext(headers: Record<string, string> = {}, url = "http://localhost/api") {
  return {
    req: {
      header: (key: string) => headers[key] ?? null,
      url,
      raw: { headers: new Headers(headers) },
    },
    env: {},
  } as any;
}

describe("auth utilities", () => {
  beforeEach(() => {
    delete process.env.VIBE_CODE_API_KEY;
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  });
  afterEach(() => {
    delete process.env.VIBE_CODE_API_KEY;
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    process.env.VIBE_CODE_API_KEY = "x";
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.NODE_ENV;
    delete process.env.VIBE_CODE_PUBLIC_URL;
    delete process.env.APP_URL;
  });

  it("checkApiKey returns false when NO VIBE_CODE_API_KEY is set", () => {
    expect(checkApiKey(createMockContext({ authorization: "Bearer secret" }))).toBe(false);
  });

  it("checkApiKey correctly validates api key from authorization header", () => {
    process.env.VIBE_CODE_API_KEY = "super-secret";
    expect(checkApiKey(createMockContext({ authorization: "Bearer super-secret" }))).toBe(true);
    expect(checkApiKey(createMockContext({ authorization: "Bearer wrong" }))).toBe(false);
    expect(checkApiKey(createMockContext({}))).toBe(false);
  });

  it("checkApiKey correctly validates api key from query string", () => {
    process.env.VIBE_CODE_API_KEY = "super-secret";
    expect(checkApiKey(createMockContext({}, "http://localhost/api?api_key=super-secret"))).toBe(
      true
    );
    expect(checkApiKey(createMockContext({}, "http://localhost/api?api_key=wrong"))).toBe(false);
  });

  it("authStatus returns false when auth is disabled", () => {
    const db = {} as any;
    const c = createMockContext();
    const status = authStatus(db, c);
    expect(status.enabled).toBe(false);
    expect(status.user).toBeNull();
  });

  it("authStatus returns true when API key is enabled", () => {
    process.env.VIBE_CODE_API_KEY = "secret";
    const db = {} as any;
    const c = createMockContext({ authorization: "Bearer secret" });
    const status = authStatus(db, c);
    expect(status.enabled).toBe(true);
  });

  it("getCurrentUser returns null when no cookie", () => {
    spyOn(honoCookie, "getCookie").mockReturnValueOnce(undefined);
    const db = {} as any;
    const c = createMockContext();
    expect(getCurrentUser(db, c)).toBeNull();
  });

  it("isAuthEnabled returns true when github oauth is configured", () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "client_id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "client_secret";
    const status = authStatus({} as any, createMockContext());
    expect(status.enabled).toBe(true);
  });

  it("authMiddleware calls next when auth disabled", async () => {
    const middleware = authMiddleware({} as any);
    const next = mock();
    await middleware(createMockContext(), next);
    expect(next).toHaveBeenCalled();
  });

  it("authMiddleware calls next if checkApiKey passes", async () => {
    process.env.VIBE_CODE_API_KEY = "super-secret";
    const middleware = authMiddleware({} as any);
    const next = mock();
    await middleware(createMockContext({ authorization: "Bearer super-secret" }), next);
    expect(next).toHaveBeenCalled();
  });

  it("authMiddleware calls next if user exists", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "client_id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "client_secret";
    const db = {
      raw: {
        query: mock().mockReturnValue({ get: mock().mockReturnValue({ id: "1" }) }),
      },
      settings: {
        set: mock(),
      },
    };
    spyOn(honoCookie, "getCookie").mockReturnValueOnce("valid-token");
    const middleware = authMiddleware(db as any);
    const next = mock();

    const c = createMockContext();
    c.set = mock();

    await middleware(c, next);
    expect(next).toHaveBeenCalled();
    expect(db.settings.set).toHaveBeenCalled();
  });

  it("authMiddleware returns 401 on unauthorized access", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "client_id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "client_secret";
    const db = {
      raw: {
        query: mock().mockReturnValue({ get: mock().mockReturnValue(null) }),
      },
    };
    spyOn(honoCookie, "getCookie").mockReturnValueOnce(undefined);
    const middleware = authMiddleware(db as any);
    const next = mock();

    const c = createMockContext();
    c.json = mock().mockReturnValue({ status: 401 });

    const _result = await middleware(c, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalled();
  });

  it("isSecureCookie returns correctly based on environment and protocol", () => {
    const m = require("./auth");
    if (!m.isSecureCookie) return;

    process.env.NODE_ENV = "production";
    expect(m.isSecureCookie(createMockContext())).toBe(true);

    process.env.NODE_ENV = "development";
    expect(m.isSecureCookie(createMockContext({ "x-forwarded-proto": "https" }))).toBe(true);
    expect(m.isSecureCookie(createMockContext({}, "https://localhost/api"))).toBe(true);
    expect(m.isSecureCookie(createMockContext({}, "http://localhost/api"))).toBe(false);
  });

  it("publicBaseUrl returns correctly based on environment and protocol", () => {
    const m = require("./auth");
    if (!m.publicBaseUrl) return;

    process.env.VIBE_CODE_PUBLIC_URL = "https://public.example.com/";
    expect(m.publicBaseUrl(createMockContext())).toBe("https://public.example.com");

    delete process.env.VIBE_CODE_PUBLIC_URL;
    process.env.APP_URL = "https://app.example.com";
    expect(m.publicBaseUrl(createMockContext())).toBe("https://app.example.com");

    delete process.env.APP_URL;
    expect(
      m.publicBaseUrl(
        createMockContext({ "x-forwarded-proto": "https", "x-forwarded-host": "forwarded.com" })
      )
    ).toBe("https://forwarded.com");
    expect(
      m.publicBaseUrl(createMockContext({ host: "local.host" }, "http://local.host/api"))
    ).toBe("http://local.host");
  });
});

describe("createAuthRouter", () => {
  it("GET /me returns auth status", async () => {
    const router = createAuthRouter({} as any);
    const req = new Request("http://localhost/me");
    const res = await router.request(req);
    expect(res.status).toBe(200);
  });
});

describe("createAuthRouter - GitHub Auth", () => {
  it("GET /github/start returns 503 if auth is not configured", async () => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.VIBE_CODE_API_KEY;

    const router = createAuthRouter({} as any);
    const req = new Request("http://localhost/github/start");
    const res = await router.request(req);
    expect(res.status).toBe(503);
  });

  it("GET /github/start redirects and sets state cookie", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "client_id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "client_secret";

    const router = createAuthRouter({} as any);
    const req = new Request("http://localhost/github/start");
    const res = await router.request(req);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("github.com/login/oauth/authorize");
    expect(res.headers.get("set-cookie")).toContain("vibe_oauth_state=");
  });

  it("GET /github/callback returns 400 for invalid state", async () => {
    spyOn(honoCookie, "getCookie").mockReturnValueOnce("different_state");
    const router = createAuthRouter({} as any);
    const req = new Request("http://localhost/github/callback?code=abc&state=mystate");
    const res = await router.request(req);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid OAuth state.");
  });

  it("GET /github/callback handles fetch token failure", async () => {
    spyOn(honoCookie, "getCookie").mockReturnValueOnce("mystate");
    spyOn(honoCookie, "deleteCookie").mockImplementationOnce(() => {});
    const router = createAuthRouter({} as any);
    const req = new Request("http://localhost/github/callback?code=abc&state=mystate");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({ ok: false, status: 401, json: async () => ({ error: "bad token" }) }) as any;

    try {
      const res = await router.request(req);
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("GitHub login failed: bad token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("GET /github/callback handles successful login", async () => {
    spyOn(honoCookie, "getCookie").mockReturnValueOnce("mystate");
    spyOn(honoCookie, "setCookie").mockImplementationOnce(() => {});

    const db = {
      raw: {
        prepare: mock().mockReturnValue({ run: mock() }),
      },
      settings: {
        set: mock(),
      },
    };
    const router = createAuthRouter(db as any);
    const req = new Request("http://localhost/github/callback?code=abc&state=mystate");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: RequestInfo | URL) => {
      if (url.toString().includes("access_token")) {
        return { ok: true, json: async () => ({ access_token: "mock_access_token" }) } as any;
      }
      return {
        ok: true,
        json: async () => ({ id: 123, login: "testuser", name: "Test User", avatar_url: "url" }),
      } as any;
    };

    try {
      const res = await router.request(req);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
      expect(db.settings.set).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("GET /github/callback returns 403 if user not in allowlist", async () => {
    process.env.GITHUB_ALLOWED_USERS = "adminuser";
    spyOn(honoCookie, "getCookie").mockReturnValueOnce("mystate");

    const router = createAuthRouter({} as any);
    const req = new Request("http://localhost/github/callback?code=abc&state=mystate");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: RequestInfo | URL) => {
      if (url.toString().includes("access_token")) {
        return { ok: true, json: async () => ({ access_token: "mock_access_token" }) } as any;
      }
      return {
        ok: true,
        json: async () => ({ id: 123, login: "testuser", name: "Test User", avatar_url: "url" }),
      } as any;
    };

    try {
      const res = await router.request(req);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("GitHub user is not allowed for this deployment.");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.GITHUB_ALLOWED_USERS;
    }
  });

  it("POST /logout deletes session", async () => {
    spyOn(honoCookie, "getCookie").mockReturnValueOnce("token");
    const db = {
      raw: {
        prepare: mock().mockReturnValue({ run: mock() }),
      },
    };
    const router = createAuthRouter(db as any);
    const req = new Request("http://localhost/logout", { method: "POST" });
    const res = await router.request(req);
    expect(res.status).toBe(200);
  });
});
describe("auth utilities internal functions", () => {
  it("mapSession handles missing display_name and avatar_url", () => {
    // We export or access the unexported function via the db interaction
    // or we just trigger the code path that uses it.
    // In auth.ts `authStatus` calls `getCurrentUser` which calls `getSession` and then `mapSession`.
    const db = {
      raw: {
        query: mock().mockReturnValue({
          get: mock().mockReturnValue({
            github_id: "123",
            username: "testuser",
            display_name: null,
            avatar_url: null,
            access_token: "token",
            expires_at: new Date().toISOString(),
          }),
        }),
      },
    };
    spyOn(honoCookie, "getCookie").mockReturnValueOnce("valid-token");
    const status = authStatus(db as any, createMockContext());
    expect(status.user).toEqual({
      githubId: "123",
      username: "testuser",
      displayName: undefined,
      avatarUrl: undefined,
    });
  });
});
describe("authMiddleware specific error cases", () => {
  it("returns 401 Valid API key required if missing oauth client id", async () => {
    process.env.VIBE_CODE_API_KEY = "testkey";
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    spyOn(require("./auth"), "checkApiKey").mockReturnValue(false);

    // Make sure API key check fails
    const db = {
      raw: {
        query: mock().mockReturnValue({ get: mock().mockReturnValue(null) }),
      },
    };
    spyOn(honoCookie, "getCookie").mockReturnValueOnce(undefined);
    const middleware = authMiddleware(db as any);
    const next = mock();

    const c = createMockContext();
    c.json = mock().mockReturnValue({ status: 401 });

    const result = await middleware(c, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalled();
    expect((result as Response).status).toBe(401);
  });
});
