import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { resolveAccountForIdentity } from "../accounts";
import { createDb } from "../db";
import {
  deleteAccountCredential,
  getAccountCredentialStatus,
  readAccountCredential,
  rotateAccountCredentials,
  setAccountCredential,
} from "./account-credentials";
import {
  CredentialConfigError,
  CredentialDecryptError,
  credentialAad,
  decryptCredential,
  encryptCredential,
  readKeyRing,
} from "./credentials";

const KEY_V1 = randomBytes(32).toString("base64");
const KEY_V2 = randomBytes(32).toString("base64");
const ENV_KEYS = [
  "VIBE_CODE_CREDENTIAL_KEY",
  "VIBE_CODE_CREDENTIAL_KEY_VERSION",
  "VIBE_CODE_CREDENTIAL_KEYS",
];

function configV1() {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.VIBE_CODE_CREDENTIAL_KEY = KEY_V1;
  process.env.VIBE_CODE_CREDENTIAL_KEY_VERSION = "v1";
}

function account(db: ReturnType<typeof createDb>, subject = "1", email = "jr_acn@hotmail.com") {
  return resolveAccountForIdentity(db, {
    provider: "github",
    subject,
    email,
    username: "user",
    displayName: null,
    avatarUrl: null,
    accessToken: "",
  }).account;
}

describe("credential key ring", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("reads the current key from env", () => {
    configV1();
    const ring = readKeyRing();
    expect(ring.currentVersion).toBe("v1");
    expect(ring.keys.get("v1")?.length).toBe(32);
  });

  it("fails closed when the key is missing or malformed", () => {
    expect(() => readKeyRing()).toThrow(CredentialConfigError);
    process.env.VIBE_CODE_CREDENTIAL_KEY = "not-a-32-byte-key";
    expect(() => readKeyRing()).toThrow(CredentialConfigError);
  });

  it("reads previous versions for rotation", () => {
    process.env.VIBE_CODE_CREDENTIAL_KEYS = JSON.stringify({ v1: KEY_V1, v2: KEY_V2 });
    process.env.VIBE_CODE_CREDENTIAL_KEY = KEY_V2;
    process.env.VIBE_CODE_CREDENTIAL_KEY_VERSION = "v2";
    const ring = readKeyRing();
    expect([...ring.keys.keys()].sort()).toEqual(["v1", "v2"]);
  });
});

describe("AES-256-GCM credentials", () => {
  beforeEach(configV1);
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("round-trips a secret with a unique nonce per write", () => {
    const ring = readKeyRing();
    const a = encryptCredential("sk-secret", "acc-1", "opencode_go", ring);
    const b = encryptCredential("sk-secret", "acc-1", "opencode_go", ring);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(decryptCredential(a, "acc-1", "opencode_go", ring)).toBe("sk-secret");
  });

  it("binds the ciphertext to the account and kind", () => {
    const ring = readKeyRing();
    const encrypted = encryptCredential("sk-secret", "acc-1", "opencode_go", ring);
    expect(() => decryptCredential(encrypted, "acc-2", "opencode_go", ring)).toThrow(
      CredentialDecryptError
    );
    expect(credentialAad("acc-1", "opencode_go", "v1").toString()).toBe(
      "account:acc-1:kind:opencode_go:v1"
    );
  });

  it("rejects a ciphertext from an unknown key version", () => {
    const ring = readKeyRing();
    const encrypted = encryptCredential("sk-secret", "acc-1", "opencode_go", ring);
    expect(() =>
      decryptCredential({ ...encrypted, version: "v9" }, "acc-1", "opencode_go", ring)
    ).toThrow(CredentialConfigError);
  });
});

describe("account credential store", () => {
  beforeEach(configV1);
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("stores, reads and deletes without exposing the secret in status", () => {
    const db = createDb(":memory:");
    const { id } = account(db);
    const status = setAccountCredential(db, id, "opencode_go", "  sk-live-123  ");
    expect(status.connected).toBe(true);
    expect(status.version).toBe("v1");
    expect(JSON.stringify(status)).not.toContain("sk-live-123");
    expect(readAccountCredential(db, id, "opencode_go")).toBe("sk-live-123");

    deleteAccountCredential(db, id, "opencode_go");
    expect(readAccountCredential(db, id, "opencode_go")).toBeNull();
    expect(getAccountCredentialStatus(db, id, "opencode_go").connected).toBe(false);
    db.close();
  });

  it("keeps accounts isolated", () => {
    const db = createDb(":memory:");
    const alice = account(db, "1", "jr_acn@hotmail.com");
    const bob = account(db, "2", "juninho140695@gmail.com");
    setAccountCredential(db, alice.id, "opencode_go", "alice-key");
    setAccountCredential(db, bob.id, "opencode_go", "bob-key");
    expect(readAccountCredential(db, alice.id, "opencode_go")).toBe("alice-key");
    expect(readAccountCredential(db, bob.id, "opencode_go")).toBe("bob-key");
    db.close();
  });

  it("rotates rows to the current key and keeps reading them", () => {
    const db = createDb(":memory:");
    const { id } = account(db);
    setAccountCredential(db, id, "opencode_go", "old-key", readKeyRing());

    process.env.VIBE_CODE_CREDENTIAL_KEYS = JSON.stringify({ v1: KEY_V1, v2: KEY_V2 });
    process.env.VIBE_CODE_CREDENTIAL_KEY = KEY_V2;
    process.env.VIBE_CODE_CREDENTIAL_KEY_VERSION = "v2";
    const ringV2 = readKeyRing();

    expect(rotateAccountCredentials(db, ringV2)).toBe(1);
    expect(getAccountCredentialStatus(db, id, "opencode_go", ringV2).version).toBe("v2");
    expect(readAccountCredential(db, id, "opencode_go", ringV2)).toBe("old-key");
    db.close();
  });

  it("reports an unusable row as disconnected with a redacted error", () => {
    const db = createDb(":memory:");
    const { id } = account(db);
    setAccountCredential(db, id, "opencode_go", "sk-secret", readKeyRing());

    // Different key -> GCM tag fails; status must not leak the ciphertext.
    process.env.VIBE_CODE_CREDENTIAL_KEY = KEY_V2;
    const status = getAccountCredentialStatus(db, id, "opencode_go");
    expect(status.connected).toBe(false);
    expect(status.error).toBeTruthy();
    expect(JSON.stringify(status)).not.toContain("sk-secret");
    expect(() => readAccountCredential(db, id, "opencode_go")).toThrow(CredentialDecryptError);
    db.close();
  });
});
