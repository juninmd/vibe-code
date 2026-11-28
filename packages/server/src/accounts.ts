/**
 * Accounts and login identities (issue #262).
 *
 * A person has one internal account. Each provider login (GitHub, Google)
 * stores an identity keyed by provider + stable subject, and every identity
 * points at exactly one account. Accounts only gain a second identity through
 * an explicit link started from a signed-in session - equal e-mails never
 * merge two accounts on their own.
 *
 * `VIBE_CODE_ALLOWED_EMAILS` is the login allowlist: trim + lowercase, and an
 * empty list blocks every OAuth login. API-key access (development/operator)
 * is unaffected.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./db";

export type LoginProvider = "github" | "google";

export interface AccountRow {
  id: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountIdentityRow {
  provider: LoginProvider;
  subject: string;
  account_id: string;
  email: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  access_token: string;
  created_at: string;
  updated_at: string;
}

export interface LoginIdentityInput {
  provider: LoginProvider;
  /** Stable provider subject: GitHub numeric id, Google `sub`. */
  subject: string;
  email: string | null;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
}

/** Another account already owns this provider identity. */
export class IdentityOwnedByAnotherAccountError extends Error {
  constructor() {
    super("Identity is already linked to another account");
    this.name = "IdentityOwnedByAnotherAccountError";
  }
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

/** Comma-separated allowlist, normalized. Empty means "nobody". */
export function allowedLoginEmails(
  env: Record<string, string | undefined> = process.env
): Set<string> {
  const raw = env.VIBE_CODE_ALLOWED_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((item) => normalizeEmail(item))
      .filter((item): item is string => Boolean(item))
  );
}

export function isEmailAllowed(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return allowedLoginEmails(env).has(normalized);
}

export function getAccount(db: Db, accountId: string): AccountRow | null {
  return (
    db.raw.query<AccountRow, [string]>("SELECT * FROM accounts WHERE id = ?").get(accountId) ?? null
  );
}

export function getIdentity(
  db: Db,
  provider: LoginProvider,
  subject: string
): AccountIdentityRow | null {
  return (
    db.raw
      .query<AccountIdentityRow, [string, string]>(
        "SELECT * FROM account_identities WHERE provider = ? AND subject = ?"
      )
      .get(provider, subject) ?? null
  );
}

export function listIdentities(db: Db, accountId: string): AccountIdentityRow[] {
  return db.raw
    .query<AccountIdentityRow, [string]>(
      "SELECT * FROM account_identities WHERE account_id = ? ORDER BY created_at"
    )
    .all(accountId);
}

function insertIdentity(db: Db, accountId: string, identity: LoginIdentityInput): void {
  db.raw
    .prepare(
      `INSERT INTO account_identities
         (provider, subject, account_id, email, username, display_name, avatar_url, access_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      identity.provider,
      identity.subject,
      accountId,
      normalizeEmail(identity.email),
      identity.username,
      identity.displayName,
      identity.avatarUrl,
      identity.accessToken
    );
}

function refreshIdentity(db: Db, identity: LoginIdentityInput): void {
  db.raw
    .prepare(
      `UPDATE account_identities
          SET email = ?, username = ?, display_name = ?, avatar_url = ?, access_token = ?,
              updated_at = datetime('now')
        WHERE provider = ? AND subject = ?`
    )
    .run(
      normalizeEmail(identity.email),
      identity.username,
      identity.displayName,
      identity.avatarUrl,
      identity.accessToken,
      identity.provider,
      identity.subject
    );
}

/**
 * First login for this provider subject creates an account; later logins reuse
 * it and refresh the identity snapshot (username/avatar/token).
 */
export function resolveAccountForIdentity(
  db: Db,
  identity: LoginIdentityInput
): { account: AccountRow; created: boolean } {
  const existing = getIdentity(db, identity.provider, identity.subject);
  if (existing) {
    refreshIdentity(db, identity);
    const account = getAccount(db, existing.account_id);
    if (!account) throw new Error("Identity points at a missing account");
    if (!account.email && identity.email) {
      db.raw
        .prepare("UPDATE accounts SET email = ?, updated_at = datetime('now') WHERE id = ?")
        .run(normalizeEmail(identity.email), account.id);
      return { account: { ...account, email: normalizeEmail(identity.email) }, created: false };
    }
    return { account, created: false };
  }

  const accountId = `acc-${randomUUID()}`;
  const email = normalizeEmail(identity.email);
  db.raw.prepare("INSERT INTO accounts (id, email) VALUES (?, ?)").run(accountId, email);
  insertIdentity(db, accountId, identity);
  const account = getAccount(db, accountId);
  if (!account) throw new Error("Failed to create account");
  return { account, created: true };
}

/**
 * Explicitly attach a provider identity to the signed-in account. Rejects an
 * identity already owned by another account (no silent merge).
 */
export function linkIdentityToAccount(
  db: Db,
  accountId: string,
  identity: LoginIdentityInput
): AccountIdentityRow {
  const existing = getIdentity(db, identity.provider, identity.subject);
  if (existing && existing.account_id !== accountId) {
    throw new IdentityOwnedByAnotherAccountError();
  }
  if (existing) {
    refreshIdentity(db, identity);
  } else {
    insertIdentity(db, accountId, identity);
  }
  const account = getAccount(db, accountId);
  if (account && !account.email && identity.email) {
    db.raw
      .prepare("UPDATE accounts SET email = ?, updated_at = datetime('now') WHERE id = ?")
      .run(normalizeEmail(identity.email), accountId);
  }
  const linked = getIdentity(db, identity.provider, identity.subject);
  if (!linked) throw new Error("Failed to link identity");
  return linked;
}

/** True while at least one identity e-mail is still in the allowlist. */
export function accountStillAllowed(
  db: Db,
  accountId: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  const allowed = allowedLoginEmails(env);
  if (allowed.size === 0) return false;
  const identities = listIdentities(db, accountId);
  return identities.some((identity) => {
    const email = normalizeEmail(identity.email);
    return Boolean(email && allowed.has(email));
  });
}

/**
 * Revocation: delete sessions whose account lost every allowlisted e-mail.
 * Returns how many sessions were removed (used by the auth middleware).
 */
export function pruneDisallowedSessions(
  db: Db,
  env: Record<string, string | undefined> = process.env
): number {
  const allowed = allowedLoginEmails(env);
  const sessions = db.raw
    .query<{ id: string; account_id: string | null }, []>(
      "SELECT id, account_id FROM auth_sessions"
    )
    .all();
  let removed = 0;
  const del = db.raw.prepare("DELETE FROM auth_sessions WHERE id = ?");
  for (const session of sessions) {
    if (!session.account_id) {
      // Sessions created before accounts existed can no longer be trusted.
      del.run(session.id);
      removed += 1;
      continue;
    }
    const identities = listIdentities(db, session.account_id);
    const stillAllowed = identities.some((identity) => {
      const email = normalizeEmail(identity.email);
      return Boolean(email && allowed.has(email));
    });
    if (!stillAllowed) {
      del.run(session.id);
      removed += 1;
    }
  }
  return removed;
}
