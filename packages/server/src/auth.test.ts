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

    const result = await middleware(c, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalled();
    expect((result as Response).status).toBe(401);
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
