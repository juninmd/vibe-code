import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthStatus, AuthUser } from "@vibe-code/shared";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "./db";

const SESSION_COOKIE = "vibe_session";
const STATE_COOKIE = "vibe_oauth_state";
const SESSION_DAYS = 30;
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface SessionRow {
  id: string;
  github_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  access_token: string;
  expires_at: string;
}

function isAuthEnabled(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

function isSecureCookie(c: Context): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    c.req.header("x-forwarded-proto") === "https" ||
    new URL(c.req.url).protocol === "https:"
  );
}

function publicBaseUrl(c: Context): string {
  const configured = process.env.VIBE_CODE_PUBLIC_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || url.host;
  return `${proto}://${host}`;
}

function redirectUri(c: Context): string {
  return `${publicBaseUrl(c)}/api/auth/github/callback`;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function allowedUsers(): Set<string> {
  return new Set(
    (process.env.GITHUB_ALLOWED_USERS || "")
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean)
  );
}

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

function mapSession(row: SessionRow): AuthUser {
  return {
    githubId: row.github_id,
    username: row.username,
    displayName: row.display_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
  };
}

function getSession(db: Db, token: string | undefined): SessionRow | null {
  if (!token) return null;
  const id = hashToken(token);
  const row = db.raw
    .query<SessionRow, [string, string]>(
      "SELECT * FROM auth_sessions WHERE id = ? AND expires_at > ?"
    )
    .get(id, new Date().toISOString());
  return row ?? null;
}

function deleteSession(db: Db, token: string | undefined): void {
  if (!token) return;
  db.raw.prepare("DELETE FROM auth_sessions WHERE id = ?").run(hashToken(token));
}

async function exchangeCodeForToken(c: Context, code: string): Promise<string> {
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

async function fetchGitHubUser(accessToken: string): Promise<GitHubUserResponse> {
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

function createLoginUrl(c: Context, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", redirectUri(c));
  url.searchParams.set("scope", process.env.GITHUB_OAUTH_SCOPE || "repo read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

export function getCurrentUser(db: Db, c: Context): AuthUser | null {
  if (!isAuthEnabled()) return null;
  const row = getSession(db, getCookie(c, SESSION_COOKIE));
  return row ? mapSession(row) : null;
}

export function authStatus(db: Db, c: Context): AuthStatus {
  const enabled = isAuthEnabled();
  const user = enabled ? getCurrentUser(db, c) : null;
  return {
    enabled,
    authenticated: !enabled || Boolean(user),
    user,
    loginUrl: "/api/auth/github/start",
  };
}

export function authMiddleware(db: Db): MiddlewareHandler {
  return async (c, next) => {
    if (!isAuthEnabled()) return next();

    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/auth/") || path === "/api/health") return next();

    const row = getSession(db, getCookie(c, SESSION_COOKIE));
    if (!row) return c.json({ error: "unauthorized", message: "GitHub login required" }, 401);

    db.settings.set("github_token", row.access_token);
    db.settings.set("github_username", row.username);
    await next();
  };
}

export function createAuthRouter(db: Db) {
  const app = new Hono();

  app.get("/me", (c: Context) => c.json({ data: authStatus(db, c) }));

  app.get("/github/start", (c: Context) => {
    if (!isAuthEnabled()) {
      return c.json(
        {
          error: "auth_not_configured",
          message: "Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET on the server.",
        },
        503
      );
    }
    const state = randomToken();
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: isSecureCookie(c),
      sameSite: "Lax",
      path: "/",
      maxAge: 10 * 60,
    });
    return c.redirect(createLoginUrl(c, state));
  });

  app.get("/github/callback", async (c: Context) => {
    try {
      const code = c.req.query("code");
      const state = c.req.query("state");
      const storedState = getCookie(c, STATE_COOKIE);
      deleteCookie(c, STATE_COOKIE, { path: "/" });

      if (!code || !state || !storedState || !safeEqual(state, storedState)) {
        return c.text("Invalid OAuth state.", 400);
      }

      const accessToken = await exchangeCodeForToken(c, code);
      const ghUser = await fetchGitHubUser(accessToken);
      const allowlist = allowedUsers();
      if (allowlist.size > 0 && !allowlist.has(ghUser.login.toLowerCase())) {
        return c.text("GitHub user is not allowed for this deployment.", 403);
      }

      const sessionToken = randomToken();
      const expiresAt = sessionExpiry();
      db.raw
        .prepare(
          `INSERT OR REPLACE INTO auth_sessions
           (id, github_id, username, display_name, avatar_url, access_token, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          hashToken(sessionToken),
          String(ghUser.id),
          ghUser.login,
          ghUser.name,
          ghUser.avatar_url,
          accessToken,
          expiresAt.toISOString()
        );

      db.settings.set("github_token", accessToken);
      db.settings.set("github_username", ghUser.login);

      setCookie(c, SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        secure: isSecureCookie(c),
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_DAYS * 24 * 60 * 60,
      });

      return c.redirect("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.text(`GitHub login failed: ${message}`, 500);
    }
  });

  app.post("/logout", (c: Context) => {
    deleteSession(db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ data: { ok: true } });
  });

  return app;
}
