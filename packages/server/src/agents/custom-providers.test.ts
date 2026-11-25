import { describe, expect, it } from "bun:test";
import { createCustomProvidersRouter } from "../api/custom-providers";
import { createDb } from "../db";
import {
  type CustomProvider,
  customProviderConfig,
  customProviderSecretEnv,
  resolveCustomProviders,
} from "./custom-providers";
import { buildOpenCodeOverlay, readOpenCodeProviderSettings } from "./opencode-providers";

const corp: CustomProvider = {
  id: "corp-llm",
  name: "Corp LiteLLM",
  baseUrl: "https://llm.corp.local/v1/",
  enabled: true,
  auth: { type: "header", headerName: "x-litellm-api-key" },
  headers: { "x-tenant": "acme" },
  models: ["corp-coder"],
  secret: "sk-123",
};

describe("custom provider config", () => {
  it("references the secret through an env var, never inline", () => {
    const entry = customProviderConfig(corp, corp.models, true);
    const json = JSON.stringify(entry);
    expect(json).not.toContain("sk-123");
    expect(entry.options).toEqual({
      baseURL: "https://llm.corp.local/v1",
      headers: { "x-tenant": "acme", "x-litellm-api-key": "{env:VIBE_PROVIDER_CORP_LLM_SECRET}" },
    });
    expect(customProviderSecretEnv("corp-llm")).toBe("VIBE_PROVIDER_CORP_LLM_SECRET");
  });

  it("uses apiKey for bearer and OAuth2 client-credentials tokens", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${init?.body ?? ""}`);
      return Response.json({ access_token: "cc-token", expires_in: 3600 });
    }) as unknown as typeof fetch;
    const oauth: CustomProvider = {
      ...corp,
      id: "oidc-gw",
      auth: { type: "oauth2", tokenUrl: "https://idp/token", clientId: "vibe", scope: "llm" },
      secret: "client-secret",
    };
    const { config, env } = await resolveCustomProviders([oauth, { ...corp, enabled: false }], {
      fetchImpl: fake,
    });
    expect(Object.keys(config)).toEqual(["oidc-gw"]);
    expect((config["oidc-gw"] as { options: { apiKey: string } }).options.apiKey).toBe(
      "{env:VIBE_PROVIDER_OIDC_GW_SECRET}"
    );
    expect(env.VIBE_PROVIDER_OIDC_GW_SECRET).toBe("cc-token");
    expect(calls[0]).toContain("grant_type=client_credentials");
  });

  it("merges into the OpenCode overlay next to LiteLLM, and the session's model is declared", async () => {
    const { config } = await resolveCustomProviders([corp], { model: "corp-llm/big-model#high" });
    const overlay = buildOpenCodeOverlay({
      litellm: { baseUrl: "http://gw/v1", models: ["gpt"] },
      providers: config,
    });
    const providers = overlay.provider as Record<string, { models: Record<string, unknown> }>;
    expect(Object.keys(providers).sort()).toEqual(["corp-llm", "litellm"]);
    expect(Object.keys(providers["corp-llm"].models)).toEqual(["corp-coder", "big-model"]);
  });
});

describe("/api/providers/custom", () => {
  it("validates, masks the secret and keeps it when the form leaves it blank", async () => {
    const db = createDb(":memory:");
    const app = createCustomProvidersRouter(db);
    const put = (id: string, body: unknown) =>
      app.request(`http://h/${id}`, { method: "PUT", body: JSON.stringify(body) });
    const { id: _id, ...input } = corp;

    expect((await put("litellm", input)).status).toBe(400);
    expect((await put("Bad Id", input)).status).toBe(400);
    expect((await put("corp-llm", { ...input, baseUrl: "file:///etc/passwd" })).status).toBe(400);

    const created = await put("corp-llm", input);
    expect(created.status).toBe(200);
    const view = ((await created.json()) as { data: Record<string, unknown> }).data;
    expect(view.secretSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain("sk-123");

    await put("corp-llm", { ...input, secret: "", models: ["a"] });
    const stored = readOpenCodeProviderSettings(db.settings).custom[0];
    expect(stored.secret).toBe("sk-123");
    expect(stored.models).toEqual(["a"]);

    await put("corp-llm", { ...input, secret: null });
    expect(readOpenCodeProviderSettings(db.settings).custom[0].secret).toBeUndefined();

    expect((await app.request("http://h/corp-llm", { method: "DELETE" })).status).toBe(200);
    expect(readOpenCodeProviderSettings(db.settings).custom).toEqual([]);
  });

  it("tests the connection with the configured auth header", async () => {
    const db = createDb(":memory:");
    const seen: Record<string, string | null> = {};
    const fake = (async (_url: string, init?: RequestInit) => {
      seen.header = new Headers(init?.headers).get("x-litellm-api-key");
      return Response.json({ data: [{ id: "corp-coder" }] });
    }) as unknown as typeof fetch;
    const app = createCustomProvidersRouter(db, fake);
    const { id: _id, ...input } = corp;
    await app.request("http://h/corp-llm", { method: "PUT", body: JSON.stringify(input) });
    const res = await app.request("http://h/corp-llm/test", { method: "POST" });
    expect(((await res.json()) as { data: { models: string[] } }).data.models).toEqual([
      "corp-coder",
    ]);
    expect(seen.header).toBe("sk-123");
  });
});
