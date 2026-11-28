/**
 * GitLab connection for the agents and the GitLab MCP: a personal access token
 * (the usual path, also on-prem), or OAuth2 when the instance has an OAuth
 * application configured (GITLAB_OAUTH_CLIENT_ID/SECRET or Settings → MCP).
 * OAuth tokens expire after two hours, so every run asks `freshGitLabToken`.
 */
import type { Context } from "hono";
import type { Db } from "../db";
import { pkcePair, publicBaseUrl } from "../oauth/common";
import type { ConnectFlows } from "./connect-flows";

type Settings = Pick<Db["settings"], "get" | "set">;
type Env = Record<string, string | undefined>;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const SCOPES = "api read_user";

export function gitlabBaseUrl(settings: Pick<Settings, "get">): string {
  const raw = settings.get("gitlab_base_url")?.trim() || "https://gitlab.com";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

export function gitlabOAuthClient(
  settings: Pick<Settings, "get">,
  env: Env = process.env
): { clientId: string; clientSecret: string } | null {
  const clientId = settings.get("gitlab_oauth_client_id")?.trim() || env.GITLAB_OAUTH_CLIENT_ID;
  const clientSecret =
    settings.get("gitlab_oauth_client_secret")?.trim() || env.GITLAB_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function redirectUri(c: Context): string {
  return `${publicBaseUrl(c)}/api/auth/gitlab/callback`;
}

/** Authorize URL for an authenticated user; null when no OAuth app is configured. */
export function startGitLabConnect(db: Db, c: Context, flows: ConnectFlows): string | null {
  const client = gitlabOAuthClient(db.settings);
  if (!client) return null;
  const baseUrl = gitlabBaseUrl(db.settings);
  const pkce = pkcePair();
  const callback = redirectUri(c);
  const state = flows.create({
    provider: "gitlab",
    verifier: pkce.verifier,
    baseUrl,
    redirectUri: callback,
  });
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  baseUrl: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<Required<Pick<TokenResponse, "access_token">> & TokenResponse> {
  const res = await fetchImpl(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `GitLab OAuth failed: ${res.status}`);
  }
  return json as Required<Pick<TokenResponse, "access_token">> & TokenResponse;
}

function storeOAuthToken(settings: Settings, token: TokenResponse, now: number): void {
  settings.set("gitlab_token", token.access_token ?? "");
  settings.set("gitlab_auth_method", "oauth");
  if (token.refresh_token) settings.set("gitlab_refresh_token", token.refresh_token);
  settings.set(
    "gitlab_token_expires_at",
    token.expires_in ? new Date(now + token.expires_in * 1000).toISOString() : ""
  );
}

/** A pasted personal access token replaces any OAuth grant. */
export function storeGitLabPersonalToken(settings: Settings, token: string): void {
  settings.set("gitlab_token", token);
  settings.set("gitlab_auth_method", token ? "token" : "");
  settings.set("gitlab_refresh_token", "");
  settings.set("gitlab_token_expires_at", "");
}

export async function fetchGitLabUsername(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | undefined> {
  const res = await fetchImpl(`${baseUrl}/api/v4/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return undefined;
  return ((await res.json()) as { username?: string }).username;
}

export async function finishGitLabConnect(
  db: Db,
  c: Context,
  flows: ConnectFlows | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const flow = flows?.take(c.req.query("state"));
  const code = c.req.query("code");
  const client = gitlabOAuthClient(db.settings);
  if (flow?.provider !== "gitlab" || !code || !client) {
    return c.redirect("/?connect_error=gitlab");
  }
  try {
    const token = await tokenRequest(
      flow.baseUrl,
      {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        code_verifier: flow.verifier,
        grant_type: "authorization_code",
        redirect_uri: flow.redirectUri,
      },
      fetchImpl
    );
    storeOAuthToken(db.settings, token, Date.now());
    db.settings.set("gitlab_oauth_redirect_uri", flow.redirectUri);
    db.settings.set("gitlab_base_url", flow.baseUrl);
    db.settings.set(
      "gitlab_username",
      (await fetchGitLabUsername(flow.baseUrl, token.access_token, fetchImpl)) ?? ""
    );
    return c.redirect("/?connected=gitlab");
  } catch (err) {
    console.warn(`[gitlab] OAuth connect failed: ${err instanceof Error ? err.message : err}`);
    return c.redirect("/?connect_error=gitlab");
  }
}

/**
 * The GitLab token to hand to a run. OAuth tokens close to expiry are refreshed
 * first; a failed refresh keeps the old token so the error surfaces in the run.
 */
export async function freshGitLabToken(
  settings: Settings,
  options: { env?: Env; now?: number; fetchImpl?: typeof fetch } = {}
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const token = settings.get("gitlab_token") || env.GITLAB_TOKEN || undefined;
  if (settings.get("gitlab_auth_method") !== "oauth") return token;
  const expiresAt = Date.parse(settings.get("gitlab_token_expires_at") || "");
  const refresh = settings.get("gitlab_refresh_token");
  const client = gitlabOAuthClient(settings, env);
  if (!refresh || !client || !(expiresAt - now < REFRESH_MARGIN_MS)) return token;
  try {
    const next = await tokenRequest(
      gitlabBaseUrl(settings),
      {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
        redirect_uri: settings.get("gitlab_oauth_redirect_uri") || "",
      },
      options.fetchImpl ?? fetch
    );
    storeOAuthToken(settings, next, now);
    return next.access_token;
  } catch (err) {
    console.warn(`[gitlab] token refresh failed: ${err instanceof Error ? err.message : err}`);
    return token;
  }
}
