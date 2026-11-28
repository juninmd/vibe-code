import { describe, expect, it } from "vitest";
import { EMPTY, toDraft, toInput } from "./customProviderDraft";
import { pendingMcpAuth } from "./McpConnections";

describe("custom provider form", () => {
  it("turns the header form into the API shape without leaking an empty secret", () => {
    const input = toInput({
      ...EMPTY,
      id: "corp",
      name: " Corp ",
      baseUrl: "https://llm.corp/v1 ",
      authType: "header",
      headerName: "x-litellm-api-key",
      headers: "x-tenant: acme\nx-trace: a:b\n\n",
      models: "corp-coder, corp-chat\n",
    });
    expect(input).toEqual({
      name: "Corp",
      baseUrl: "https://llm.corp/v1",
      enabled: true,
      auth: { type: "header", headerName: "x-litellm-api-key", prefix: undefined },
      headers: { "x-tenant": "acme", "x-trace": "a:b" },
      models: ["corp-coder", "corp-chat"],
      secret: undefined,
    });
  });

  it("round-trips an OAuth2 provider for editing", () => {
    const draft = toDraft({
      id: "oidc",
      name: "OIDC",
      baseUrl: "https://gw/v1",
      enabled: false,
      auth: { type: "oauth2", tokenUrl: "https://idp/token", clientId: "vibe", scope: "llm" },
      headers: {},
      models: [],
      secretSet: true,
    });
    expect(draft.secret).toBe("");
    expect(toInput(draft).auth).toEqual({
      type: "oauth2",
      tokenUrl: "https://idp/token",
      clientId: "vibe",
      scope: "llm",
    });
  });
});

describe("MCP sign-in prompt", () => {
  it("asks only for enabled defaults without credentials or user override", () => {
    const base = { method: null, oauthAvailable: false, overridden: false } as const;
    const pending = pendingMcpAuth([
      { ...base, id: "github", enabled: true, connected: true, method: "oauth" },
      { ...base, id: "gitlab", enabled: true, connected: false },
    ]);
    expect(pending.map((item) => item.id)).toEqual(["gitlab"]);
    expect(pendingMcpAuth([{ ...base, id: "gitlab", enabled: false, connected: false }])).toEqual(
      []
    );
    expect(pendingMcpAuth(undefined)).toEqual([]);
  });
});
