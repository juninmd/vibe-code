import { describe, expect, it } from "bun:test";
import { agentGitHubEnv, gitHubGitConfigEnv, resolveGitHubToken } from "./github-credentials";

const db = (token: string | null) => ({ settings: { get: () => token } });

describe("resolveGitHubToken", () => {
  it("prefers the OAuth token saved on login over GITHUB_TOKEN", () => {
    expect(resolveGitHubToken(db("oauth"), { GITHUB_TOKEN: "env" })).toBe("oauth");
  });

  it("falls back to GITHUB_TOKEN, then undefined", () => {
    expect(resolveGitHubToken(db(""), { GITHUB_TOKEN: "env" })).toBe("env");
    expect(resolveGitHubToken(db(null), {})).toBeUndefined();
  });
});

describe("gitHubGitConfigEnv", () => {
  it("authenticates github.com without putting the token in a URL", () => {
    const env = gitHubGitConfigEnv("tok", {});
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    const basic = env.GIT_CONFIG_VALUE_0.replace("AUTHORIZATION: basic ", "");
    expect(Buffer.from(basic, "base64").toString()).toBe("x-access-token:tok");
  });

  it("chains after existing GIT_CONFIG entries instead of overwriting them", () => {
    const env = gitHubGitConfigEnv("tok", { GIT_CONFIG_COUNT: "2" });
    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_KEY_2).toContain("extraheader");
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
  });

  it("ignores a garbage GIT_CONFIG_COUNT", () => {
    expect(gitHubGitConfigEnv("tok", { GIT_CONFIG_COUNT: "x" }).GIT_CONFIG_COUNT).toBe("1");
  });

  it("adds nothing without a token", () => {
    expect(gitHubGitConfigEnv(undefined, {})).toEqual({});
  });
});

describe("agentGitHubEnv", () => {
  it("gives gh and git the user's token so the agent can push and open PRs", () => {
    const env = agentGitHubEnv("tok", {});
    expect(env.GH_TOKEN).toBe("tok");
    expect(env.GITHUB_TOKEN).toBe("tok");
    expect(env.GIT_CONFIG_KEY_0).toContain("extraheader");
  });

  it("is empty when nobody is signed in", () => {
    expect(agentGitHubEnv(undefined, {})).toEqual({});
  });
});
