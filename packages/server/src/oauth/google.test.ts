import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { authMiddleware, authStatus, createAuthRouter } from "../auth";
import { createDb } from "../db";
import { isGoogleOAuthConfigured, isGoogleUserAllowed } from "./google";

const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_ALLOWED_EMAILS",
  "GOOGLE_ALLOWED_DOMAINS",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "VIBE_CODE_API_KEY",
];

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function configureGoogle(allow: { emails?: string; domains?: string } = { emails: "ana@x.com" }) {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "gid";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "gsecret";
  if (allow.emails) process.env.GOOGLE_ALLOWED_EMAILS = allow.emails;
  if (allow.domains) process.env.GOOGLE_ALLOWED_DOMAINS = allow.domains;
}

function cookiesOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [name, ...value] = pair.split("=");
    out[name] = value.join("=");
  }
  return out;
}

describe("Google login policy", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("stays off without an allowlist: any Google account could otherwise run shells here", () => {
    configureGoogle({});
    expect(isGoogleOAuthConfigured()).toBe(false);
    configureGoogle({ domains: "acme.com" });
    expect(isGoogleOAuthConfigured()).toBe(true);
  });

  it("only admits verified emails on the allowlist or allowed domains", () => {
    configureGoogle({ emails: "Ana@X.com", domains: "acme.com" });
    expect(isGoogleUserAllowed({ sub: "1", email: "ana@x.com", email_verified: true })).toBe(true);
    expect(isGoogleUserAllowed({ sub: "2", email: "bob@acme.com", email_verified: true })).toBe(
      true
    );
    expect(isGoogleUserAllowed({ sub: "3", email: "bob@acme.com", email_verified: false })).toBe(
      false
    );
    expect(
      isGoogleUserAllowed({ sub: "4", email: "eve@acme.com.evil.io", email_verified: true })
    ).toBe(false);
    expect(isGoogleUserAllowed({ sub: "5", email_verified: true })).toBe(false);
  });
});

describe("Google OAuth routes", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("start answers 503 until the server is configured", async () => {
    const res = await createAuthRouter(createDb(":memory:")).request("http://h/google/start");
    expect(res.status).toBe(503);
  });

  it("start redirects to Google with state and PKCE", async () => {
    configureGoogle();
    const res = await createAuthRouter(createDb(":memory:")).request("http://h/google/start");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.host).toBe("accounts.google.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe("http://h/api/auth/google/callback");
    const cookies = cookiesOf(res);
    expect(cookies.vibe_oauth_state).toBe(location.searchParams.get("state") ?? "");
    expect(cookies.vibe_oauth_pkce).toBeTruthy();
  });

  it("callback with a forged state never creates a session", async () => {
    configureGoogle();
    const res = await createAuthRouter(createDb(":memory:")).request(
      "http://h/google/callback?code=c&state=forged",
      { headers: { cookie: "vibe_oauth_state=real; vibe_oauth_pkce=v" } }
    );
    expect(res.headers.get("location")).toBe("/?auth_error=invalid_state");
    expect(cookiesOf(res).vibe_session).toBeFalsy();
  });

  async function callback(email: string) {
    const db = createDb(":memory:");
    db.settings.set("github_token", "gho_connected");
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: string) =>
      String(input).includes("oauth2.googleapis.com")
        ? Response.json({ access_token: "ya29" })
        : Response.json({ sub: "42", email, email_verified: true, name: "Ana" })) as never);
    try {
      const res = await createAuthRouter(db).request("http://h/google/callback?code=c&state=s1", {
        headers: { cookie: "vibe_oauth_state=s1; vibe_oauth_pkce=verifier" },
      });
      return { db, res };
    } finally {
      fetchSpy.mockRestore();
    }
  }

  it("callback logs an allowed user in without touching the GitHub token", async () => {
    configureGoogle();
    const { db, res } = await callback("ana@x.com");
    expect(res.headers.get("location")).toBe("/");
    const session = cookiesOf(res).vibe_session;
    expect(session).toBeTruthy();

    const status = authStatus(db, {
      req: {
        header: (name: string) => (name === "cookie" ? `vibe_session=${session}` : undefined),
        url: "http://h/api",
        raw: new Request("http://h/api", { headers: { cookie: `vibe_session=${session}` } }),
      },
    } as never);
    expect(status.user?.provider).toBe("google");
    expect(status.user?.username).toBe("ana@x.com");

    // The middleware must not overwrite the GitHub token the agents use.
    const mw = authMiddleware(db);
    let passed = false;
    const ctx = {
      req: {
        url: "http://h/api/tasks",
        header: (name: string) => (name === "cookie" ? `vibe_session=${session}` : undefined),
        raw: new Request("http://h/api/tasks", { headers: { cookie: `vibe_session=${session}` } }),
      },
      json: () => new Response(null, { status: 401 }),
    };
    await mw(ctx as never, async () => {
      passed = true;
    });
    expect(passed).toBe(true);
    expect(db.settings.get("github_token")).toBe("gho_connected");
  });

  it("callback refuses an email outside the allowlist", async () => {
    configureGoogle();
    const { res } = await callback("eve@else.com");
    expect(res.headers.get("location")).toBe("/?auth_error=google_not_allowed");
    expect(cookiesOf(res).vibe_session).toBeFalsy();
  });

  it("advertises the Google method on /me", async () => {
    configureGoogle();
    const res = await createAuthRouter(createDb(":memory:")).request("http://h/me");
    const body = (await res.json()) as { data: { methods: { google: boolean } } };
    expect(body.data.methods.google).toBe(true);
  });
});
