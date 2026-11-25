import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createAuthRouter } from "../auth";
import { createDb } from "../db";
import { GITLAB_MCP_PACKAGE, NPX_NEUTRAL, resolveMcpServers } from "../mcp/default-servers";
import { PendingFlows } from "../oauth/common";
import { type ConnectFlow, createConnectFlows } from "./connect-flows";
import { freshGitLabToken } from "./gitlab-oauth";
import { createIntegrationsRouter } from "./router";

const ENV = [
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
];
beforeEach(() => {
  for (const key of ENV) delete process.env[key];
});
afterEach(() => {
  for (const key of ENV) delete process.env[key];
});

function gitlabFake(calls: string[]) {
  return (async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url} ${init?.body ? String(init.body) : ""}`);
    if (url.endsWith("/oauth/token")) {
      const grant = new URLSearchParams(String(init?.body)).get("grant_type");
      return Response.json({
        access_token: grant === "refresh_token" ? "gl-refreshed" : "gl-access",
        refresh_token: "gl-refresh-2",
        expires_in: 7200,
      });
    }
    if (url.endsWith("/api/v4/user")) {
      const auth = new Headers(init?.headers).get("authorization");
      return auth === "Bearer bad-token"
        ? new Response("no", { status: 401 })
        : Response.json({ username: "ana" });
    }
    return new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("PendingFlows", () => {
  it("hands each state out once and forgets expired ones", () => {
    let now = 0;
    const flows = new PendingFlows<ConnectFlow>(() => now);
    const state = flows.create({ provider: "github" });
    expect(flows.take(state)).toEqual({ provider: "github" });
    expect(flows.take(state)).toBeNull();
    const late = flows.create({ provider: "github" });
    now = 11 * 60 * 1000;
    expect(flows.take(late)).toBeNull();
    expect(flows.take(undefined)).toBeNull();
  });
});

describe("GitLab connection", () => {
  it("saves a personal access token only after the instance accepts it (on-prem URL)", async () => {
    const db = createDb(":memory:");
    const calls: string[] = [];
    const app = createIntegrationsRouter(db, createConnectFlows(), gitlabFake(calls));
    const rejected = await app.request("http://h/gitlab/token", {
      method: "PUT",
      body: JSON.stringify({ token: "bad-token", baseUrl: "https://git.corp.local/" }),
    });
    expect(rejected.status).toBe(400);
    expect(db.settings.get("gitlab_token")).toBeNull();

    const ok = await app.request("http://h/gitlab/token", {
      method: "PUT",
      body: JSON.stringify({ token: "glpat-good-token", baseUrl: "https://git.corp.local/" }),
    });
    expect(ok.status).toBe(200);
    expect(calls.at(-1)).toContain("https://git.corp.local/api/v4/user");
    expect(db.settings.get("gitlab_base_url")).toBe("https://git.corp.local");
    expect(db.settings.get("gitlab_auth_method")).toBe("token");
    const status = (await ok.json()) as { data: { id: string; connected: boolean }[] };
    expect(status.data.find((item) => item.id === "gitlab")?.connected).toBe(true);
  });

  it("refuses an OAuth connect when no GitLab application is configured", async () => {
    const db = createDb(":memory:");
    const res = await createIntegrationsRouter(db, createConnectFlows()).request(
      "http://h/gitlab/connect",
      { method: "POST" }
    );
    expect(res.status).toBe(409);
  });

  it("runs the OAuth2 + PKCE flow against a self-managed instance", async () => {
    const db = createDb(":memory:");
    const flows = createConnectFlows();
    const calls: string[] = [];
    const app = createIntegrationsRouter(db, flows, gitlabFake(calls));
    await app.request("http://h/gitlab/oauth-app", {
      method: "PUT",
      body: JSON.stringify({
        clientId: "app-id",
        clientSecret: "app-secret",
        baseUrl: "https://git.corp.local",
      }),
    });
    const start = await app.request("http://h/gitlab/connect", { method: "POST" });
    const { url } = ((await start.json()) as { data: { url: string } }).data;
    const authorize = new URL(url);
    expect(authorize.origin + authorize.pathname).toBe("https://git.corp.local/oauth/authorize");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");

    const state = authorize.searchParams.get("state") ?? "";
    // The callback is public: a state not minted by /connect must not store anything.
    const auth = createAuthRouter(db, flows);
    const forged = await auth.request("http://h/gitlab/callback?code=x&state=forged");
    expect(forged.headers.get("location")).toBe("/?connect_error=gitlab");

    const { finishGitLabConnect } = await import("./gitlab-oauth");
    const ctx = {
      req: { query: (key: string) => ({ code: "the-code", state })[key] },
      redirect: (to: string) => new Response(null, { status: 302, headers: { location: to } }),
    };
    const done = await finishGitLabConnect(db, ctx as never, flows, gitlabFake(calls));
    expect(done.headers.get("location")).toBe("/?connected=gitlab");
    expect(db.settings.get("gitlab_token")).toBe("gl-access");
    expect(db.settings.get("gitlab_auth_method")).toBe("oauth");
    expect(db.settings.get("gitlab_username")).toBe("ana");
    expect(calls.some((call) => call.includes("code_verifier="))).toBe(true);
  });

  it("refreshes an OAuth token close to expiry and leaves a PAT alone", async () => {
    const db = createDb(":memory:");
    const calls: string[] = [];
    db.settings.set("gitlab_oauth_client_id", "app-id");
    db.settings.set("gitlab_oauth_client_secret", "app-secret");
    db.settings.set("gitlab_base_url", "https://git.corp.local");
    db.settings.set("gitlab_token", "old");
    db.settings.set("gitlab_auth_method", "oauth");
    db.settings.set("gitlab_refresh_token", "r1");
    db.settings.set("gitlab_token_expires_at", new Date(Date.now() + 60_000).toISOString());
    expect(await freshGitLabToken(db.settings, { fetchImpl: gitlabFake(calls) })).toBe(
      "gl-refreshed"
    );
    expect(db.settings.get("gitlab_refresh_token")).toBe("gl-refresh-2");

    db.settings.set("gitlab_auth_method", "token");
    db.settings.set("gitlab_token", "glpat");
    calls.length = 0;
    expect(await freshGitLabToken(db.settings, { fetchImpl: gitlabFake(calls) })).toBe("glpat");
    expect(calls).toHaveLength(0);
  });
});

describe("GitHub connect flow", () => {
  it("stores the token for the agents without creating a login session", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    const db = createDb(":memory:");
    const flows = createConnectFlows();
    const start = await createIntegrationsRouter(db, flows).request("http://h/github/connect", {
      method: "POST",
    });
    const state = new URL(
      ((await start.json()) as { data: { url: string } }).data.url
    ).searchParams.get("state");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string) =>
      String(input).includes("access_token")
        ? Response.json({ access_token: "gho_connect" })
        : Response.json({ id: 1, login: "octo", name: null, avatar_url: null })) as never;
    try {
      const res = await createAuthRouter(db, flows).request(
        `http://h/github/callback?code=c&state=${state}`
      );
      expect(res.headers.get("location")).toBe("/?connected=github");
      expect(res.headers.getSetCookie().some((c) => c.startsWith("vibe_session="))).toBe(false);
      expect(db.settings.get("github_token")).toBe("gho_connect");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("default MCP servers", () => {
  it("adds GitHub and GitLab once authenticated, honoring overrides and toggles", async () => {
    const db = createDb(":memory:");
    expect(await resolveMcpServers(db.settings)).toEqual({});

    db.settings.set("github_token", "gho_x");
    db.settings.set("gitlab_token", "glpat");
    db.settings.set("gitlab_base_url", "git.corp.local");
    const servers = await resolveMcpServers(db.settings);
    expect(Object.keys(servers).sort()).toEqual(["github", "gitlab"]);
    expect(servers.gitlab.command).toEqual(["node", NPX_NEUTRAL, GITLAB_MCP_PACKAGE]);
    expect((servers.gitlab.environment as Record<string, string>).GITLAB_API_URL).toBe(
      "https://git.corp.local/api/v4"
    );
    expect(GITLAB_MCP_PACKAGE).toMatch(/@\d+\.\d+\.\d+$/);

    db.settings.set("mcp_servers", JSON.stringify({ gitlab: { type: "remote", url: "x" } }));
    db.settings.set("mcp_default_github_enabled", "false");
    const custom = await resolveMcpServers(db.settings);
    expect(custom.github).toBeUndefined();
    expect(custom.gitlab).toEqual({ type: "remote", url: "x" });
  });
});
