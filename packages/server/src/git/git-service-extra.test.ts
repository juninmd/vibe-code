import { describe, expect, it, mock, spyOn } from "bun:test";
import { GitService } from "./git-service";
import { ProviderRegistry } from "./providers/registry";

describe("GitService extra coverage", () => {
  it("provider operations", async () => {
    const git = new GitService();

    expect(git.providerRegistry).toBeNull();
    await expect(git.createPR("wt", "url", "branch", "title", "body")).rejects.toThrow(
      "Provider registry not configured"
    );
    await expect(git.listRemoteRepos("github")).rejects.toThrow("Provider registry not configured");
    await expect(git.searchRemoteRepos("github", "q")).rejects.toThrow(
      "Provider registry not configured"
    );
    await expect(git.createRemoteRepo("github", "name", "desc", false)).rejects.toThrow(
      "Provider registry not configured"
    );
    await expect(git.listIssues("url")).rejects.toThrow("Provider registry not configured");

    // Test registry setup
    const dbMock = { settings: { get: () => "token" } } as any;
    const registry = new ProviderRegistry(dbMock);

    // Mock the adapter
    const mockAdapter = {
      createPR: mock(async () => "pr_url"),
      listRepos: mock(async () => [{ name: "repo1" }]),
      searchRepos: mock(async () => [{ name: "repo2" }]),
      createRepo: mock(async () => ({
        name: "repo",
        url: "url",
        description: "desc",
        isPrivate: false,
      })),
      listIssues: mock(async () => [{ id: 1 }]),
      listBranches: mock(async () => ["branch1"]),
    };
    registry.get = mock(() => mockAdapter as any);
    registry.getToken = mock(() => "token");
    registry.resolve = mock(
      () => ({ adapter: mockAdapter, token: "token", provider: "github" }) as any
    );

    git.providers = registry;
    expect(git.providerRegistry).toBe(registry);

    await expect(git.createPR("wt", "github.com/a/b", "branch", "title", "body")).resolves.toBe(
      "pr_url"
    );
    await expect(git.listRemoteRepos("github")).resolves.toEqual([{ name: "repo1" }] as any);
    await expect(git.searchRemoteRepos("github", "q")).resolves.toEqual([{ name: "repo2" }] as any);
    await expect(git.createRemoteRepo("github", "name", "desc", false)).resolves.toEqual({
      name: "repo",
      url: "url",
      description: "desc",
      isPrivate: false,
    } as any);
    await expect(git.listIssues("github.com/a/b")).resolves.toEqual([{ id: 1 }] as any);

    // Legacy methods
    await expect(git.listGitHubRepos()).resolves.toEqual([{ name: "repo1" }] as any);
    await expect(git.createGitHubRepo("name", "desc", false)).resolves.toEqual({
      name: "repo",
      url: "url",
      description: "desc",
      isPrivate: false,
    } as any);

    expect(git.isProviderConfigured("github")).toBe(true);

    // Missing providers
    registry.resolve = mock(() => null);
    await expect(git.createPR("wt", "url", "branch", "title", "body")).rejects.toThrow(
      "No git provider configured for url"
    );
    await expect(git.listIssues("url")).rejects.toThrow("No git provider configured for url");

    registry.get = mock(() => undefined);
    await expect(git.listRemoteRepos("github")).resolves.toEqual([]);
    await expect(git.searchRemoteRepos("github", "q")).rejects.toThrow(
      "No github token configured"
    );
    await expect(git.createRemoteRepo("github", "name", "desc", false)).rejects.toThrow(
      "Provider github not configured or missing token"
    );
  });

  it("diff handling when git fails", async () => {
    const git = new GitService();
    const execMock = spyOn(git as any, "exec").mockImplementation(() =>
      Promise.reject(new Error("fail"))
    );

    const summary = await git.diffSummary("main", "branch", { cwd: "dir" });
    expect(summary).toEqual([]);

    execMock.mockRestore();
  });

  it("listRemoteBranches handles git provider errors", async () => {
    const git = new GitService();
    const dbMock = { settings: { get: () => "token" } } as any;
    const registry = new ProviderRegistry(dbMock);

    const mockAdapter = {
      listBranches: mock(async () => Promise.reject(new Error("fail"))),
    };
    registry.get = mock(() => mockAdapter as any);
    registry.getToken = mock(() => "token");
    registry.resolve = mock(
      () => ({ adapter: mockAdapter, token: "token", provider: "github" }) as any
    );

    git.providers = registry;

    // When exception thrown, should return ["main"] or repo name if it's the URL
    await expect(
      git.listRemoteBranches({ url: "github.com/a/b", provider: "github" })
    ).resolves.toEqual(["b"]);
  });
});
