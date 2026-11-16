import { afterEach, describe, expect, it } from "bun:test";
import {
  blockUnauthenticatedRemote,
  isLoopbackAddress,
  rejectUnauthenticatedSocket,
} from "../security/network-guard";
import { agentProcessEnv, isServerOnlyEnv } from "./agent-env";
import { REDACTED, redactSecrets, registerSecretSource, resetSecretCache } from "./secret-redactor";

describe("agentProcessEnv", () => {
  it("drops server-only credentials but keeps what the agent needs", () => {
    const env = agentProcessEnv({
      PATH: "/bin",
      HOME: "/home/x",
      VIBE_CODE_API_KEY: "server-api-key",
      GITHUB_OAUTH_CLIENT_SECRET: "oauth",
      LITELLM_MASTER_KEY: "master",
      DATABASE_URL: "postgres://u:p@h/db",
      MY_SERVICE_PASSWORD: "pw",
      SOME_CLIENT_SECRET: "s",
      CUSTOM_DENIED: "x",
      VIBE_CODE_AGENT_ENV_DENY: "CUSTOM_DENIED",
      ANTHROPIC_API_KEY: "sk-ant",
      OPENCODE_API_KEY: "go",
      GITHUB_TOKEN: "ghp",
    });
    expect(Object.keys(env).sort()).toEqual(
      [
        "ANTHROPIC_API_KEY",
        "GITHUB_TOKEN",
        "HOME",
        "OPENCODE_API_KEY",
        "PATH",
        "VIBE_CODE_AGENT_ENV_DENY",
      ].sort()
    );
    expect(isServerOnlyEnv("LITELLM_MASTER_KEY", {})).toBe(true);
    expect(isServerOnlyEnv("OPENAI_API_KEY", {})).toBe(false);
  });
});

describe("redactSecrets", () => {
  afterEach(() => resetSecretCache());

  it("removes saved credentials and well-known token shapes", () => {
    registerSecretSource(() => ["my-litellm-static-key-123", null, "short"]);
    resetSecretCache();
    const text = [
      "key=my-litellm-static-key-123",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
      "OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz",
      "short stays",
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toContain("my-litellm-static-key-123");
    expect(out).not.toContain("ghp_abc");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(out).not.toContain("sk-proj-");
    expect(out).toContain("Bearer [REDACTED]");
    expect(out).toContain("short stays");
    expect(out.split(REDACTED).length - 1).toBe(4);
  });

  it("redacts secret-like env values", () => {
    const before = process.env.VIBE_TEST_SERVICE_TOKEN;
    process.env.VIBE_TEST_SERVICE_TOKEN = "env-token-value-xyz";
    resetSecretCache();
    try {
      expect(redactSecrets("got env-token-value-xyz")).toBe(`got ${REDACTED}`);
    } finally {
      if (before === undefined) delete process.env.VIBE_TEST_SERVICE_TOKEN;
      else process.env.VIBE_TEST_SERVICE_TOKEN = before;
    }
  });
});

describe("network guard", () => {
  it("only lets loopback clients in when auth is off", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("192.168.0.10")).toBe(false);
    expect(blockUnauthenticatedRemote("127.0.0.1", false, {})).toBeNull();
    expect(blockUnauthenticatedRemote("192.168.0.10", true, {})).toBeNull();
    expect(blockUnauthenticatedRemote("192.168.0.10", false, {})?.status).toBe(403);
    expect(
      blockUnauthenticatedRemote("192.168.0.10", false, {
        VIBE_CODE_ALLOW_UNAUTHENTICATED_REMOTE: "true",
      })
    ).toBeNull();
  });
});

describe("live socket", () => {
  it("refuses the upgrade instead of opening an unauthenticated socket", async () => {
    // Task updates and agent transcripts are broadcast over /ws: a client that
    // failed authentication must never get a socket to subscribe with.
    const refused = rejectUnauthenticatedSocket(false);
    expect(refused?.status).toBe(401);
    expect(await refused?.json()).toEqual({
      error: "unauthorized",
      message: "Authentication required",
    });
    expect(rejectUnauthenticatedSocket(true)).toBeNull();
  });
});

describe("blocked page", () => {
  it("serves a readable page to browsers and JSON to the API", async () => {
    const page = blockUnauthenticatedRemote("192.168.0.9", false, {}, "/");
    expect(page?.headers.get("content-type")).toContain("text/html");
    expect(await page?.text()).toContain("VIBE_CODE_API_KEY");
    const api = blockUnauthenticatedRemote("192.168.0.9", false, {}, "/api/tasks");
    expect(await api?.json()).toMatchObject({ error: "auth_required" });
  });
});
