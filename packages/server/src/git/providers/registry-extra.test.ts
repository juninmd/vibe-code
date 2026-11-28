import { describe, expect, it } from "bun:test";
import { ProviderRegistry } from "./registry";

describe("ProviderRegistry extra coverage", () => {
  it("detects provider correctly", () => {
    const dbMock = {
      settings: {
        get: (key: string) => (key === "gitlab_base_url" ? "custom-gitlab.com" : undefined),
      },
    } as any;
    const registry = new ProviderRegistry(dbMock);

    expect(registry.detectProvider("https://github.com/a/b")).toBe("github");
    expect(registry.detectProvider("https://custom-gitlab.com/a/b")).toBe("gitlab");
    expect(registry.detectProvider("https://gitlab.com/a/b")).toBe("gitlab");
    expect(registry.detectProvider("https://unknown.com/a/b")).toBe("manual");
  });

  it("getToken retrieves token", () => {
    const dbMock = {
      settings: {
        get: (key: string) => {
          if (key === "github_token") return "gh_token";
          if (key === "gitlab_token") return "gl_token";
          return undefined;
        },
      },
    } as any;
    const registry = new ProviderRegistry(dbMock);

    expect(registry.getToken("github")).toBe("gh_token");
    expect(registry.getToken("gitlab")).toBe("gl_token");
    expect(registry.getToken("manual" as any)).toBeUndefined();
  });

  it("getToken falls back to env", () => {
    const dbMock = { settings: { get: () => undefined } } as any;
    const registry = new ProviderRegistry(dbMock);

    const oldGh = process.env.GITHUB_TOKEN;
    const oldGl = process.env.GITLAB_TOKEN;
    process.env.GITHUB_TOKEN = "env_gh";
    process.env.GITLAB_TOKEN = "env_gl";

    expect(registry.getToken("github")).toBe("env_gh");
    expect(registry.getToken("gitlab")).toBe("env_gl");

    if (oldGh !== undefined) process.env.GITHUB_TOKEN = oldGh;
    else delete process.env.GITHUB_TOKEN;

    if (oldGl !== undefined) process.env.GITLAB_TOKEN = oldGl;
    else delete process.env.GITLAB_TOKEN;
  });

  it("resolve retrieves adapter and token", () => {
    const dbMock = {
      settings: {
        get: (key: string) => {
          if (key === "github_token") return "gh_token";
          return undefined;
        },
      },
    } as any;
    const registry = new ProviderRegistry(dbMock);

    const resolved = registry.resolve("https://github.com/a/b");
    expect(resolved).not.toBeNull();
    expect(resolved?.provider).toBe("github");
    expect(resolved?.token).toBe("gh_token");

    // No token for gitlab
    expect(registry.resolve("https://gitlab.com/a/b")).toBeNull();

    // Manual
    expect(registry.resolve("https://unknown.com/a/b")).toBeNull();
  });
});
