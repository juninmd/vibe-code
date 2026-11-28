import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Context } from "hono";
import {
  accountStillAllowed,
  allowedLoginEmails,
  IdentityOwnedByAnotherAccountError,
  isEmailAllowed,
  linkIdentityToAccount,
  pruneDisallowedSessions,
  resolveAccountForIdentity,
} from "./accounts";
import { createDb } from "./db";
import { hashToken } from "./oauth/common";
import { getWorkspaceContext } from "./utils/workspace-context";

const ENV_KEYS = ["VIBE_CODE_ALLOWED_EMAILS"];
const OWNER = "jr_acn@hotmail.com";

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function identity(overrides: Partial<Parameters<typeof resolveAccountForIdentity>[1]> = {}) {
  return {
    provider: "github" as const,
    subject: "1",
    email: OWNER,
    username: "juninmd",
    displayName: "Junin",
    avatarUrl: null,
    accessToken: "token",
    ...overrides,
  };
}

function fakeContext(workspaceId?: string): Context {
  return {
    env: {},
    req: {
      method: "GET",
      header: () => undefined,
      query: (name: string) => (name === "workspace_id" ? workspaceId : undefined),
      json: async () => ({}),
    },
  } as unknown as Context;
}

function addSession(db: ReturnType<typeof createDb>, accountId: string | null): string {
  const token = `token-${Math.random()}`;
  db.raw
    .prepare(
      `INSERT INTO auth_sessions (id, github_id, username, access_token, expires_at, account_id)
       VALUES (?, '1', 'user', '', ?, ?)`
    )
    .run(hashToken(token), new Date(Date.now() + 86_400_000).toISOString(), accountId);
  return token;
}

describe("login allowlist", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("normalizes trim and case", () => {
    process.env.VIBE_CODE_ALLOWED_EMAILS = "  JR_ACN@Hotmail.com , juninho140695@gmail.com ";
    expect([...allowedLoginEmails()]).toEqual(["jr_acn@hotmail.com", "juninho140695@gmail.com"]);
    expect(isEmailAllowed(" JR_ACN@hotmail.COM ")).toBe(true);
  });

  it("an empty list blocks every e-mail", () => {
    process.env.VIBE_CODE_ALLOWED_EMAILS = "";
    expect(isEmailAllowed(OWNER)).toBe(false);
    delete process.env.VIBE_CODE_ALLOWED_EMAILS;
    expect(isEmailAllowed(OWNER)).toBe(false);
  });

  it("does not match substrings or domains", () => {
    process.env.VIBE_CODE_ALLOWED_EMAILS = "jr_acn@hotmail.com";
    expect(isEmailAllowed("jr_acn@hotmail.com.evil.com")).toBe(false);
    expect(isEmailAllowed("someone@hotmail.com")).toBe(false);
  });
});

describe("accounts", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("creates one account per provider subject and reuses it", () => {
    process.env.VIBE_CODE_ALLOWED_EMAILS = OWNER;
    const db = createDb(":memory:");
    const first = resolveAccountForIdentity(db, identity());
    expect(first.created).toBe(true);
    expect(first.account.email).toBe(OWNER);

    const second = resolveAccountForIdentity(db, identity({ username: "renamed" }));
    expect(second.created).toBe(false);
    expect(second.account.id).toBe(first.account.id);
    expect(db.raw.query("SELECT * FROM accounts").all()).toHaveLength(1);
    db.close();
  });

  it("keeps GitHub and Google as separate accounts until an explicit link", () => {
    process.env.VIBE_CODE_ALLOWED_EMAILS = OWNER;
    const db = createDb(":memory:");
    const github = resolveAccountForIdentity(db, identity());
    const google = resolveAccountForIdentity(
      db,
      identity({ provider: "google", subject: "google-sub", accessToken: "" })
    );
    expect(google.account.id).not.toBe(github.account.id);

    linkIdentityToAccount(db, github.account.id, {
      provider: "google",
      subject: "google-new",
      email: OWNER,
      username: OWNER,
      displayName: null,
      avatarUrl: null,
      accessToken: "",
    });
    expect(
      db.raw
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM account_identities WHERE account_id = ?"
        )
        .get(github.account.id)?.n
    ).toBe(2);
    db.close();
  });

  it("refuses to link an identity owned by another account", () => {
    process.env.VIBE_CODE_ALLOWED_EMAILS = OWNER;
    const db = createDb(":memory:");
    const mine = resolveAccountForIdentity(db, identity());
    // A second account created from a different Google subject.
    const other = resolveAccountForIdentity(
      db,
      identity({ provider: "google", subject: "someone-else", email: "other@x.com" })
    );
    expect(() => linkIdentityToAccount(db, other.account.id, identity({ subject: "1" }))).toThrow(
      IdentityOwnedByAnotherAccountError
    );
    expect(
      db.raw
        .query<{ account_id: string }, []>(
          "SELECT account_id FROM account_identities WHERE provider = 'github' AND subject = '1'"
        )
        .get()?.account_id
    ).toBe(mine.account.id);
    db.close();
  });

  it("prunes sessions when the allowlist no longer covers the account", () => {
    process.env.VIBE_CODE_ALLOWED_EMAILS = OWNER;
    const db = createDb(":memory:");
    const { account } = resolveAccountForIdentity(db, identity());
    addSession(db, account.id);
    addSession(db, null); // legacy session without an account
    expect(accountStillAllowed(db, account.id)).toBe(true);

    process.env.VIBE_CODE_ALLOWED_EMAILS = "juninho140695@gmail.com";
    expect(accountStillAllowed(db, account.id)).toBe(false);
    expect(pruneDisallowedSessions(db)).toBe(2);
    expect(db.raw.query("SELECT * FROM auth_sessions").all()).toHaveLength(0);
    db.close();
  });
});

describe("workspace ownership", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("gives each account its own default workspace and denies cross access", async () => {
    process.env.VIBE_CODE_ALLOWED_EMAILS = `${OWNER},juninho140695@gmail.com`;
    const db = createDb(":memory:");
    const a = resolveAccountForIdentity(db, identity({ subject: "1", email: OWNER }));
    const b = resolveAccountForIdentity(
      db,
      identity({ provider: "google", subject: "g-2", email: "juninho140695@gmail.com" })
    );

    const ctxA = await getWorkspaceContext(fakeContext(), db, {
      githubId: "1",
      username: "a",
      accountId: a.account.id,
    });
    const ctxB = await getWorkspaceContext(fakeContext(), db, {
      githubId: "2",
      username: "b",
      accountId: b.account.id,
    });
    expect(ctxA?.workspaceId).toBeDefined();
    expect(ctxB?.workspaceId).toBeDefined();
    expect(ctxA?.workspaceId).not.toBe(ctxB?.workspaceId);

    // A cannot select B's workspace.
    const denied = await getWorkspaceContext(fakeContext(ctxB?.workspaceId), db, {
      githubId: "1",
      username: "a",
      accountId: a.account.id,
    });
    expect(denied).toBeNull();

    // A can select its own.
    const allowed = await getWorkspaceContext(fakeContext(ctxA?.workspaceId), db, {
      githubId: "1",
      username: "a",
      accountId: a.account.id,
    });
    expect(allowed?.workspaceId).toBe(ctxA?.workspaceId);
    db.close();
  });
});
