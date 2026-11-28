/**
 * Per-account encrypted credentials (issue #262).
 *
 * The API only ever returns connection status. Plaintext leaves this module
 * only to build the environment of a run that the account admitted.
 */
import type { Db } from "../db";
import {
  CredentialConfigError,
  CredentialDecryptError,
  type CredentialKind,
  credentialAad,
  decryptCredential,
  encryptCredential,
  type KeyRing,
  readKeyRing,
} from "./credentials";

interface CredentialRow {
  account_id: string;
  kind: string;
  version: string;
  iv: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
  created_at: string;
  updated_at: string;
}

export interface CredentialStatus {
  kind: CredentialKind;
  connected: boolean;
  /** Key version that wrote the row; null when nothing is stored. */
  version: string | null;
  updatedAt: string | null;
  /** Redacted reason when the row cannot be used (missing key, bad tag). */
  error: string | null;
}

function ringOrError(ring?: KeyRing): KeyRing {
  return ring ?? readKeyRing();
}

export function setAccountCredential(
  db: Db,
  accountId: string,
  kind: CredentialKind,
  value: string,
  ring: KeyRing = ringOrError()
): CredentialStatus {
  const trimmed = value.trim();
  if (!trimmed) throw new CredentialConfigError("Credential value is empty");
  const encrypted = encryptCredential(trimmed, accountId, kind, ring);
  db.raw
    .prepare(
      `INSERT INTO account_credentials (account_id, kind, version, iv, tag, ciphertext)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, kind) DO UPDATE SET
         version = excluded.version,
         iv = excluded.iv,
         tag = excluded.tag,
         ciphertext = excluded.ciphertext,
         updated_at = datetime('now')`
    )
    .run(accountId, kind, encrypted.version, encrypted.iv, encrypted.tag, encrypted.ciphertext);
  return getAccountCredentialStatus(db, accountId, kind, ring);
}

export function deleteAccountCredential(db: Db, accountId: string, kind: CredentialKind): void {
  db.raw
    .prepare("DELETE FROM account_credentials WHERE account_id = ? AND kind = ?")
    .run(accountId, kind);
}

function getRow(db: Db, accountId: string, kind: CredentialKind): CredentialRow | null {
  return (
    db.raw
      .query<CredentialRow, [string, string]>(
        "SELECT * FROM account_credentials WHERE account_id = ? AND kind = ?"
      )
      .get(accountId, kind) ?? null
  );
}

/** Reads and decrypts one credential; null when the account never stored one. */
export function readAccountCredential(
  db: Db,
  accountId: string,
  kind: CredentialKind,
  ring?: KeyRing
): string | null {
  const row = getRow(db, accountId, kind);
  if (!row) return null;
  return decryptCredential(
    {
      version: row.version,
      iv: Buffer.from(row.iv),
      tag: Buffer.from(row.tag),
      ciphertext: Buffer.from(row.ciphertext),
    },
    accountId,
    kind,
    ringOrError(ring)
  );
}

export function getAccountCredentialStatus(
  db: Db,
  accountId: string,
  kind: CredentialKind,
  ring?: KeyRing
): CredentialStatus {
  const row = getRow(db, accountId, kind);
  if (!row) {
    return { kind, connected: false, version: null, updatedAt: null, error: null };
  }
  try {
    readAccountCredential(db, accountId, kind, ring);
    return {
      kind,
      connected: true,
      version: row.version,
      updatedAt: row.updated_at,
      error: null,
    };
  } catch (err) {
    const error =
      err instanceof CredentialConfigError || err instanceof CredentialDecryptError
        ? err.message
        : "Stored credential is not readable";
    // Never echo the ciphertext or the key; status stays connected=false.
    return {
      kind,
      connected: false,
      version: row.version,
      updatedAt: row.updated_at,
      error,
    };
  }
}

/**
 * Rotation: re-encrypt every row still on an old key version with the current
 * one, before the old key is removed from the deploy. A row that cannot be
 * decrypted is left untouched so the operator can see it in the status.
 */
export function rotateAccountCredentials(db: Db, ring: KeyRing = ringOrError()): number {
  const rows = db.raw.query<CredentialRow, []>("SELECT * FROM account_credentials").all();
  let rotated = 0;
  for (const row of rows) {
    if (row.version === ring.currentVersion) continue;
    try {
      const plaintext = decryptCredential(
        {
          version: row.version,
          iv: Buffer.from(row.iv),
          tag: Buffer.from(row.tag),
          ciphertext: Buffer.from(row.ciphertext),
        },
        row.account_id,
        row.kind as CredentialKind,
        ring
      );
      const encrypted = encryptCredential(
        plaintext,
        row.account_id,
        row.kind as CredentialKind,
        ring
      );
      db.raw
        .prepare(
          `UPDATE account_credentials
              SET version = ?, iv = ?, tag = ?, ciphertext = ?, updated_at = datetime('now')
            WHERE account_id = ? AND kind = ?`
        )
        .run(
          encrypted.version,
          encrypted.iv,
          encrypted.tag,
          encrypted.ciphertext,
          row.account_id,
          row.kind
        );
      rotated += 1;
    } catch {
      console.warn("[credentials] could not rotate a stored credential", {
        accountId: row.account_id,
        kind: row.kind,
        version: row.version,
      });
    }
  }
  return rotated;
}

/** True when the row can be decrypted; used to block admission without leaking. */
export function hasUsableAccountCredential(
  db: Db,
  accountId: string,
  kind: CredentialKind,
  ring?: KeyRing
): boolean {
  try {
    return Boolean(readAccountCredential(db, accountId, kind, ring));
  } catch {
    return false;
  }
}

/** AAD is exported for tests; production code should go through the helpers. */
export { credentialAad };
