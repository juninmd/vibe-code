/** Browser login sessions (`auth_sessions`), shared by every login provider. */
import type { AuthUser } from "@vibe-code/shared";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import type { Db } from "../db";
import { hashToken, isSecureCookie, randomToken } from "./common";

export const SESSION_COOKIE = "vibe_session";
const SESSION_DAYS = 30;
/** Google identities live in the same table; their id carries this prefix. */
export const GOOGLE_ID_PREFIX = "google:";

export interface SessionRow {
  id: string;
  github_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  /** GitHub token for GitHub logins; empty for Google logins. */
  access_token: string;
  expires_at: string;
}

export interface LoginIdentity {
  /** `123` for GitHub, `google:<sub>` for Google. */
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
}

export function mapSession(row: SessionRow): AuthUser {
  const google = row.github_id.startsWith(GOOGLE_ID_PREFIX);
  return {
    githubId: row.github_id,
    username: row.username,
    displayName: row.display_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    provider: google ? "google" : "github",
  };
}

export function getSession(db: Db, token: string | undefined): SessionRow | null {
  if (!token) return null;
  const row = db.raw
    .query<SessionRow, [string, string]>(
      "SELECT * FROM auth_sessions WHERE id = ? AND expires_at > ?"
    )
    .get(hashToken(token), new Date().toISOString());
  return row ?? null;
}

export function deleteSession(db: Db, token: string | undefined): void {
  if (!token) return;
  db.raw.prepare("DELETE FROM auth_sessions WHERE id = ?").run(hashToken(token));
}

/** Store a new session and hand its cookie to the browser. */
export function startSession(db: Db, c: Context, identity: LoginIdentity): void {
  const sessionToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO auth_sessions
       (id, github_id, username, display_name, avatar_url, access_token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      hashToken(sessionToken),
      identity.id,
      identity.username,
      identity.displayName,
      identity.avatarUrl,
      identity.accessToken,
      expiresAt.toISOString()
    );
  setCookie(c, SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: isSecureCookie(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}
