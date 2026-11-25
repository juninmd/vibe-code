/**
 * "Sign in with Google" (OpenID Connect, authorization code + PKCE).
 *
 * Any Google account can finish the flow, and a session here can run shells on
 * the server, so the login stays off until an allowlist exists:
 * GOOGLE_ALLOWED_EMAILS and/or GOOGLE_ALLOWED_DOMAINS.
 */
import type { Context } from "hono";
import { csvSet, publicBaseUrl } from "./common";
import { GOOGLE_ID_PREFIX, type LoginIdentity } from "./sessions";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

type Env = Record<string, string | undefined>;

export function hasGoogleClient(env: Env = process.env): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function allowlist(env: Env) {
  return { emails: csvSet(env.GOOGLE_ALLOWED_EMAILS), domains: csvSet(env.GOOGLE_ALLOWED_DOMAINS) };
}

/** Client configured AND an allowlist set: only then is the button offered. */
export function isGoogleOAuthConfigured(env: Env = process.env): boolean {
  const { emails, domains } = allowlist(env);
  return hasGoogleClient(env) && (emails.size > 0 || domains.size > 0);
}

export function isGoogleUserAllowed(user: GoogleUserInfo, env: Env = process.env): boolean {
  const email = user.email?.trim().toLowerCase();
  if (!email || user.email_verified !== true) return false;
  const { emails, domains } = allowlist(env);
  if (emails.has(email)) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return domains.has(domain);
}

export function googleRedirectUri(c: Context): string {
  return `${publicBaseUrl(c)}/api/auth/google/callback`;
}

export function googleLoginUrl(c: Context, state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", googleRedirectUri(c));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  const domains = [...allowlist(process.env).domains];
  // A single allowed Workspace domain: let Google pre-filter the account picker.
  if (domains.length === 1 && allowlist(process.env).emails.size === 0) {
    url.searchParams.set("hd", domains[0]);
  }
  return url.toString();
}

export async function exchangeGoogleCode(
  c: Context,
  code: string,
  verifier: string
): Promise<GoogleUserInfo> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(c),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error || `Google token exchange failed: ${res.status}`);
  }
  const info = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${json.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!info.ok) throw new Error(`Google userinfo failed: ${info.status}`);
  return (await info.json()) as GoogleUserInfo;
}

/** The Google token is not kept: the session only needs the identity. */
export function googleIdentity(user: GoogleUserInfo): LoginIdentity {
  return {
    id: `${GOOGLE_ID_PREFIX}${user.sub}`,
    username: (user.email ?? user.sub).toLowerCase(),
    displayName: user.name ?? null,
    avatarUrl: user.picture ?? null,
    accessToken: "",
  };
}
