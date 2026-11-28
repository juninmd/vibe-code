/**
 * Credential encryption for per-account secrets (issue #262).
 *
 * AES-256-GCM with a unique nonce per write, a key version, an authentication
 * tag, and the account + credential kind as authenticated data. Keys come from
 * deploy secrets:
 *
 * - `VIBE_CODE_CREDENTIAL_KEY`: current key, base64 (32 bytes).
 * - `VIBE_CODE_CREDENTIAL_KEY_VERSION`: its version, `v1` by default.
 * - `VIBE_CODE_CREDENTIAL_KEYS`: optional JSON `{"v1":"<base64>","v2":"<base64>"}`
 *   with previous keys so rotation can read old rows.
 *
 * Errors never include the secret or the key: callers surface a redacted
 * message and the credential stays unusable instead of leaking.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CREDENTIAL_KINDS = ["opencode_go"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export class CredentialConfigError extends Error {
  constructor(message = "Credential encryption is not configured on the server") {
    super(message);
    this.name = "CredentialConfigError";
  }
}

export class CredentialDecryptError extends Error {
  constructor(message = "Stored credential could not be decrypted") {
    super(message);
    this.name = "CredentialDecryptError";
  }
}

export interface KeyRing {
  currentVersion: string;
  keys: Map<string, Buffer>;
}

export interface EncryptedCredential {
  version: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

type Env = Record<string, string | undefined>;

function decodeKey(value: string, version: string): Buffer {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) {
    throw new CredentialConfigError(`Credential key ${version} must be 32 bytes encoded in base64`);
  }
  return key;
}

/** Parse the deploy key ring; throws a redacted config error when unusable. */
export function readKeyRing(env: Env = process.env): KeyRing {
  const keys = new Map<string, Buffer>();
  if (env.VIBE_CODE_CREDENTIAL_KEYS) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.VIBE_CODE_CREDENTIAL_KEYS);
    } catch {
      throw new CredentialConfigError("VIBE_CODE_CREDENTIAL_KEYS is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
      throw new CredentialConfigError("VIBE_CODE_CREDENTIAL_KEYS must be an object");
    }
    for (const [version, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new CredentialConfigError(`Credential key ${version} must be a string`);
      }
      keys.set(version, decodeKey(value, version));
    }
  }
  const currentVersion = env.VIBE_CODE_CREDENTIAL_KEY_VERSION?.trim() || "v1";
  const current = env.VIBE_CODE_CREDENTIAL_KEY?.trim();
  if (current) keys.set(currentVersion, decodeKey(current, currentVersion));
  if (!keys.has(currentVersion)) {
    throw new CredentialConfigError(
      `Credential key ${currentVersion} is missing from VIBE_CODE_CREDENTIAL_KEY`
    );
  }
  return { currentVersion, keys };
}

/** Account + kind + key version are authenticated, so a row cannot be replayed. */
export function credentialAad(accountId: string, kind: CredentialKind, version: string): Buffer {
  return Buffer.from(`account:${accountId}:kind:${kind}:${version}`, "utf8");
}

export function encryptCredential(
  plaintext: string,
  accountId: string,
  kind: CredentialKind,
  ring: KeyRing
): EncryptedCredential {
  if (!plaintext) throw new CredentialConfigError("Empty credential cannot be encrypted");
  const version = ring.currentVersion;
  const key = ring.keys.get(version);
  if (!key) throw new CredentialConfigError(`Credential key ${version} is missing`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(credentialAad(accountId, kind, version));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { version, iv, tag: cipher.getAuthTag(), ciphertext };
}

export function decryptCredential(
  encrypted: EncryptedCredential,
  accountId: string,
  kind: CredentialKind,
  ring: KeyRing
): string {
  const key = ring.keys.get(encrypted.version);
  if (!key) {
    throw new CredentialConfigError(`Credential key ${encrypted.version} is no longer available`);
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv);
    decipher.setAAD(credentialAad(accountId, kind, encrypted.version));
    decipher.setAuthTag(encrypted.tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ]).toString("utf8");
    if (!plaintext) throw new CredentialDecryptError();
    return plaintext;
  } catch (err) {
    if (err instanceof CredentialConfigError) throw err;
    throw new CredentialDecryptError();
  }
}
