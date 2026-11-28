import { timingSafeEqual } from "node:crypto";
import type { AuthStatus, AuthUser } from "@vibe-code/shared";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { parse as parseCookie } from "hono/utils/cookie";
import {
  accountStillAllowed,
  allowedLoginEmails,
  getAccount,
  IdentityOwnedByAnotherAccountError,
  isEmailAllowed,
  linkIdentityToAccount,
  listIdentities,
  normalizeEmail,
  resolveAccountForIdentity,
} from "./accounts";
import type { Db } from "./db";
import type { ConnectFlows } from "./integrations/connect-flows";
import { finishGitLabConnect } from "./integrations/gitlab-oauth";
import {
  isSecureCookie,
  PendingFlows,
  pkcePair,
  publicBaseUrl,
  randomToken,
  safeEqual,
} from "./oauth/common";
import {
  allowedUsers,
  createLoginUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  fetchVerifiedGitHubEmail,
  isGitHubOAuthConfigured,
} from "./oauth/github";
import {
  exchangeGoogleCode,
  googleIdentity,
  googleLoginUrl,
  isGoogleOAuthConfigured,
  isGoogleUserAllowed,
} from "./oauth/google";
import {
  deleteSession,
  getSession,
  mapSession,
  SESSION_COOKIE,
  startSession,
} from "./oauth/sessions";

export { isSecureCookie, publicBaseUrl };

const STATE_COOKIE = "vibe_oauth_state";
const PKCE_COOKIE = "vibe_oauth_pkce";

function isOAuthLoginConfigured(): boolean {
  return isGitHubOAuthConfigured() || isGoogleOAuthConfigured();
}

export function isAuthEnabled(): boolean {
  return isOAuthLoginConfigured() || Boolean(process.env.VIBE_CODE_API_KEY);
}

/** True when e-mail based OAuth login is configured (the production path). */
export function isEmailLoginEnabled(): boolean {
  return allowedLoginEmails().size > 0;
}

export function checkApiKey(c: Context): boolean {
  const key = process.env.VIBE_CODE_API_KEY;
  if (!key) return false;
  const header = c.req.header("authorization") ?? "";
  const query = new URL(c.req.url).searchParams.get("api_key") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : query;
  if (!provided) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getCurrentUser(db: Db, c: Context): AuthUser | null {
  if (!isAuthEnabled()) return null;
  const row = getSession(db, getCookie(c, SESSION_COOKIE));
  return row ? mapSession(row) : null;
}

/**
 * Auth check for raw requests (WebSocket upgrades bypass the Hono middleware).
 * Mirrors authMiddleware: API key first, then the OAuth session cookie.
 */
export function isRequestAuthenticated(db: Db, req: Request): boolean {
  if (!isAuthEnabled()) return true;

  const key = process.env.VIBE_CODE_API_KEY;
  if (key) {
    const header = req.headers.get("authorization") ?? "";
    const query = new URL(req.url).searchParams.get("api_key") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : query;
    if (provided) {
      const a = Buffer.from(key);
      const b = Buffer.from(provided);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
  }

  const cookies = parseCookie(req.headers.get("cookie") ?? "");
  const row = getSession(db, cookies[SESSION_COOKIE]);
  if (!row?.account_id) return false;
  if (isEmailLoginEnabled() && !accountStillAllowed(db, row.account_id)) {
    deleteSession(db, cookies[SESSION_COOKIE]);
    return false;
  }
  return true;
}

export function authStatus(db: Db, c: Context): AuthStatus {
  const enabled = isAuthEnabled();
  const apiKeyAuth = enabled && checkApiKey(c);
  const user = enabled && !apiKeyAuth ? getCurrentUser(db, c) : null;
  return {
    enabled,
    authenticated: !enabled || apiKeyAuth || Boolean(user),
    user: apiKeyAuth
      ? { githubId: "api-key", username: "api-key", displayName: "API Key", provider: "api-key" }
      : user,
    loginUrl: "/api/auth/github/start",
    methods: {
      github: isGitHubOAuthConfigured(),
      google: isGoogleOAuthConfigured(),
      apiKey: Boolean(process.env.VIBE_CODE_API_KEY),
    },
  };
}

export function authMiddleware(db: Db): MiddlewareHandler {
  return async (c, next) => {
    if (!isAuthEnabled()) return next();

    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/auth/") || path === "/api/health") return next();

    // API key auth (active when VIBE_CODE_API_KEY is set, regardless of OAuth)
    if (process.env.VIBE_CODE_API_KEY) {
      if (checkApiKey(c)) return next();
      // Fall through to session auth if OAuth is also configured
      if (!isOAuthLoginConfigured()) {
        return c.json({ error: "unauthorized", message: "Valid API key required" }, 401);
      }
    }

    const row = getSession(db, getCookie(c, SESSION_COOKIE));
    if (!row) return c.json({ error: "unauthorized", message: "Login required" }, 401);

    // Sessions created before accounts existed, or accounts whose allowlisted
    // e-mail was revoked, must sign in again (issue #262).
    if (!row.account_id) {
      deleteSession(db, getCookie(c, SESSION_COOKIE));
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ error: "unauthorized", message: "Session expired. Sign in again." }, 401);
    }
    if (isEmailLoginEnabled() && !accountStillAllowed(db, row.account_id)) {
      deleteSession(db, getCookie(c, SESSION_COOKIE));
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ error: "not_allowed", message: "This account is no longer allowed" }, 403);
    }

    // A Google session carries no GitHub token: keep the one connected for the agents.
    // Reads are ~150x cheaper than a SQLite write; only write when the active user changed.
    if (row.access_token) {
      if (db.settings.get("github_token") !== row.access_token)
        db.settings.set("github_token", row.access_token);
      if (db.settings.get("github_username") !== row.username)
        db.settings.set("github_username", row.username);
    }
    await next();
  };
}

export type LoginErrorCode =
  | "invalid_state"
  | "not_allowed"
  | "github_failed"
  | "google_failed"
  | "google_not_allowed";

/**
 * A failed OAuth callback goes back to the app's login screen with a short
 * code, instead of leaving the user on a bare text page on the callback URL.
 */
function loginError(c: Context, code: LoginErrorCode) {
  return c.redirect(`/?auth_error=${code}`);
}

function setFlowCookie(c: Context, name: string, value: string): void {
  setCookie(c, name, value, {
    httpOnly: true,
    secure: isSecureCookie(c),
    sameSite: "Lax",
    path: "/",
    maxAge: 10 * 60,
  });
}

/** Read and clear the login `state` cookie; true when it matches the callback. */
function takeLoginState(c: Context): boolean {
  const state = c.req.query("state");
  const storedState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  return Boolean(state && storedState && safeEqual(state, storedState));
}

function notConfigured(c: Context, message: string) {
  return c.json({ error: "auth_not_configured", message }, 503);
}

/**
 * Login policy for GitHub: the e-mail allowlist is authoritative when set
 * (verified e-mail required), and `GITHUB_ALLOWED_USERS` remains an extra
 * legacy gate. With neither configured every OAuth login is denied - an empty
 * allowlist must never mean "anyone" (issue #262).
 */
function isGitHubIdentityAllowed(user: { login: string }, email: string | null): boolean {
  const users = allowedUsers();
  const emailMode = isEmailLoginEnabled();
  if (!emailMode && users.size === 0) return false;
  if (emailMode && !isEmailAllowed(email)) return false;
  if (users.size > 0 && !users.has(user.login.toLowerCase())) return false;
  return true;
}

export function createAuthRouter(db: Db, connectFlows?: ConnectFlows) {
  const app = new Hono();
  // Explicit provider linking: state minted by a signed-in session, consumed
  // once by the public callback. E-mails alone never link two accounts.
  const linkFlows = new PendingFlows<{ accountId: string; provider: "github" | "google" }>();

  app.get("/me", (c: Context) => c.json({ data: authStatus(db, c) }));

  app.get("/link/:provider/start", (c: Context) => {
    const provider = c.req.param("provider");
    if (provider !== "github" && provider !== "google") {
      return c.json({ error: "validation", message: "Unknown provider" }, 400);
    }
    const row = getSession(db, getCookie(c, SESSION_COOKIE));
    if (!row?.account_id) return c.json({ error: "unauthorized" }, 401);
    if (provider === "github" && !isGitHubOAuthConfigured()) {
      return notConfigured(c, "GitHub OAuth is not configured on the server.");
    }
    if (provider === "google" && !isGoogleOAuthConfigured()) {
      return notConfigured(c, "Google OAuth is not configured on the server.");
    }
    const state = linkFlows.create({ accountId: row.account_id, provider });
    if (provider === "github") return c.redirect(createLoginUrl(c, state));
    const pkce = pkcePair();
    setFlowCookie(c, PKCE_COOKIE, pkce.verifier);
    return c.redirect(googleLoginUrl(c, state, pkce.challenge));
  });

  app.get("/github/start", (c: Context) => {
    if (!isGitHubOAuthConfigured()) {
      return notConfigured(
        c,
        "Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET on the server."
      );
    }
    const state = randomToken();
    setFlowCookie(c, STATE_COOKIE, state);
    return c.redirect(createLoginUrl(c, state));
  });

  app.get("/github/callback", async (c: Context) => {
    // A connect flow (Settings → MCP) only stores the token for the agents;
    // it was started by an authenticated call and must not change the session.
    const connect = connectFlows?.take(c.req.query("state"));
    if (connect && connect.provider !== "github") return c.redirect("/?connect_error=github");
    const link = linkFlows.take(c.req.query("state"));
    try {
      const code = c.req.query("code");
      if (!connect && !link && !takeLoginState(c)) return loginError(c, "invalid_state");
      if (!code)
        return connect ? c.redirect("/?connect_error=github") : loginError(c, "invalid_state");

      const accessToken = await exchangeCodeForToken(c, code);
      const ghUser = await fetchGitHubUser(accessToken);
      if (connect) {
        db.settings.set("github_token", accessToken);
        db.settings.set("github_username", ghUser.login);
        return c.redirect("/?connected=github");
      }

      const email = isEmailLoginEnabled() ? await fetchVerifiedGitHubEmail(accessToken) : null;
      if (!isGitHubIdentityAllowed(ghUser, email)) return loginError(c, "not_allowed");
      const identity = {
        provider: "github" as const,
        subject: String(ghUser.id),
        email,
        username: ghUser.login,
        displayName: ghUser.name,
        avatarUrl: ghUser.avatar_url,
        accessToken,
      };

      if (link) {
        if (link.provider !== "github") return c.redirect("/?connect_error=github");
        linkIdentityToAccount(db, link.accountId, identity);
        return c.redirect("/?linked=github");
      }

      const { account } = resolveAccountForIdentity(db, identity);
      startSession(db, c, {
        id: String(ghUser.id),
        username: ghUser.login,
        displayName: ghUser.name,
        avatarUrl: ghUser.avatar_url,
        accessToken,
        provider: "github",
        subject: String(ghUser.id),
        accountId: account.id,
      });
      db.settings.set("github_token", accessToken);
      db.settings.set("github_username", ghUser.login);
      return c.redirect("/");
    } catch (err) {
      if (err instanceof IdentityOwnedByAnotherAccountError) {
        return c.redirect("/?link_error=identity_taken");
      }
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[auth] GitHub login failed: ${message}`);
      return connect ? c.redirect("/?connect_error=github") : loginError(c, "github_failed");
    }
  });

  app.get("/google/start", (c: Context) => {
    if (!isGoogleOAuthConfigured()) {
      return notConfigured(
        c,
        "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_ALLOWED_EMAILS or GOOGLE_ALLOWED_DOMAINS on the server."
      );
    }
    const state = randomToken();
    const pkce = pkcePair();
    setFlowCookie(c, STATE_COOKIE, state);
    setFlowCookie(c, PKCE_COOKIE, pkce.verifier);
    return c.redirect(googleLoginUrl(c, state, pkce.challenge));
  });

  app.get("/google/callback", async (c: Context) => {
    const verifier = getCookie(c, PKCE_COOKIE);
    deleteCookie(c, PKCE_COOKIE, { path: "/" });
    const code = c.req.query("code");
    const link = linkFlows.take(c.req.query("state"));
    if (!code || !verifier || !isGoogleOAuthConfigured()) {
      return loginError(c, "invalid_state");
    }
    if (!link && !takeLoginState(c)) return loginError(c, "invalid_state");
    try {
      const user = await exchangeGoogleCode(c, code, verifier);
      if (!isGoogleUserAllowed(user)) return loginError(c, "google_not_allowed");
      const identity = {
        provider: "google" as const,
        subject: user.sub,
        email: normalizeEmail(user.email),
        username: googleIdentity(user).username,
        displayName: user.name ?? null,
        avatarUrl: user.picture ?? null,
        accessToken: "",
      };
      if (link) {
        if (link.provider !== "google") return c.redirect("/?connect_error=google");
        linkIdentityToAccount(db, link.accountId, identity);
        return c.redirect("/?linked=google");
      }
      const { account } = resolveAccountForIdentity(db, identity);
      startSession(db, c, {
        ...googleIdentity(user),
        provider: "google",
        subject: user.sub,
        accountId: account.id,
      });
      return c.redirect("/");
    } catch (err) {
      if (err instanceof IdentityOwnedByAnotherAccountError) {
        return c.redirect("/?link_error=identity_taken");
      }
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[auth] Google login failed: ${message}`);
      return loginError(c, "google_failed");
    }
  });

  app.get("/gitlab/callback", (c: Context) => finishGitLabConnect(db, c, connectFlows));

  app.get("/identities", (c: Context) => {
    const row = getSession(db, getCookie(c, SESSION_COOKIE));
    if (!row?.account_id) return c.json({ error: "unauthorized" }, 401);
    const account = getAccount(db, row.account_id);
    const identities = listIdentities(db, row.account_id).map((identity) => ({
      provider: identity.provider,
      email: identity.email,
      username: identity.username,
    }));
    const linked = new Set(identities.map((identity) => identity.provider));
    return c.json({
      data: {
        account: { id: row.account_id, email: account?.email ?? null },
        identities,
        linkable: {
          github: isGitHubOAuthConfigured() && !linked.has("github"),
          google: isGoogleOAuthConfigured() && !linked.has("google"),
        },
      },
    });
  });

  app.post("/logout", (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    const row = getSession(db, token);
    // The login copied its GitHub token into the server settings for the agents;
    // do not leave it behind once that user signs out.
    if (row?.access_token && db.settings.get("github_token") === row.access_token) {
      db.settings.set("github_token", "");
      db.settings.set("github_username", "");
    }
    deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ data: { ok: true } });
  });

  return app;
}
