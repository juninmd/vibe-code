import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installApiKeyFetch, setApiKey } from "./client";

describe("installApiKeyFetch", () => {
  const original = window.fetch;
  let seen: { input: unknown; headers: Headers }[];

  beforeEach(() => {
    seen = [];
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ input, headers: new Headers(init?.headers) });
      return new Response("[]");
    }) as unknown as typeof fetch;
    installApiKeyFetch();
  });

  afterEach(() => {
    window.fetch = original;
    setApiKey(null);
  });

  it("adds the access key to bare /api requests made outside the client", async () => {
    setApiKey("operator-key");
    await fetch("/api/workspaces");
    expect(seen[0].headers.get("Authorization")).toBe("Bearer operator-key");
  });

  it("keeps explicit credentials and leaves other requests alone", async () => {
    setApiKey("operator-key");
    await fetch("/api/tasks", { headers: { Authorization: "Bearer explicit" } });
    await fetch("/manifest.webmanifest");
    await fetch("https://example.invalid/api/x");
    expect(seen[0].headers.get("Authorization")).toBe("Bearer explicit");
    expect(seen[1].headers.has("Authorization")).toBe(false);
    expect(seen[2].headers.has("Authorization")).toBe(false);
  });

  it("sends nothing when no key is stored", async () => {
    await fetch("/api/workspaces");
    expect(seen[0].headers.has("Authorization")).toBe(false);
  });
});
