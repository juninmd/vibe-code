/** GitHub OAuth app: login, and the "connect GitHub" flow for the agents. */
import type { Context } from "hono";
import { csvSet, publicBaseUrl } from "./common";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

export interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export function isGitHubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

export function redirectUri(c: Context): string {
  return `${publicBaseUrl(c)}/api/auth/github/callback`;
}

export function allowedUsers(): Set<string> {
  return csvSet(process.env.GITHUB_ALLOWED_USERS);
}

export async function exchangeCodeForToken(c: Context, code: string): Promise<string> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri(c),
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `GitHub OAuth failed: ${res.status}`);
  }
  return json.access_token;
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUserResponse> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vibe-code",
    },
  });
  if (!res.ok) throw new Error(`GitHub user lookup failed: ${res.status}`);
  return (await res.json()) as GitHubUserResponse;
}

/**
 * Primary e-mail, only when GitHub reports it as verified. The login allowlist
 * is e-mail based, so an unverified address must never unlock the app
 * (issue #262). Requires the `user:email` scope.
 */
export async function fetchVerifiedGitHubEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(GITHUB_EMAILS_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vibe-code",
    },
  });
  if (!res.ok) throw new Error(`GitHub e-mail lookup failed: ${res.status}`);
  const emails = (await res.json()) as GitHubEmail[];
  const verified = emails.filter((entry) => entry.verified);
  return (
    (verified.find((entry) => entry.primary)?.email ?? verified[0]?.email ?? null)
      ?.trim()
      .toLowerCase() ?? null
  );
}

export function createLoginUrl(c: Context, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", redirectUri(c));
  url.searchParams.set("scope", process.env.GITHUB_OAUTH_SCOPE || "repo read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}
