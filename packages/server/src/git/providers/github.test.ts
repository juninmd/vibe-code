import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { GitHubProvider } from "./github";

describe("GitHubProvider", () => {
  let provider: GitHubProvider;

  beforeEach(() => {
    provider = new GitHubProvider();
  });

  afterEach(() => {
    mock.restore();
  });

  describe("getUser", () => {
    it("returns user on success", async () => {
      const mockResponse = new Response(JSON.stringify({ login: "testuser", name: "Test User" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const user = await provider.getUser("token");
      expect(user).toEqual({ username: "testuser", displayName: "Test User" });
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 401 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.getUser("token")).rejects.toThrow("GitHub API error: 401");
    });
  });

  describe("listRepos", () => {
    it("returns repos", async () => {
      const mockResponse = new Response(
        JSON.stringify([
          {
            full_name: "testuser/repo",
            html_url: "url",
            description: "desc",
            private: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const repos = await provider.listRepos("token", 1);
      expect(repos).toHaveLength(1);
      expect(repos[0]).toEqual({
        name: "testuser/repo",
        url: "url",
        description: "desc",
        isPrivate: true,
        provider: "github",
      });
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.listRepos("token")).rejects.toThrow("GitHub API error: 500");
    });
  });

  describe("searchRepos", () => {
    it("returns search results", async () => {
      const mockResponse = new Response(
        JSON.stringify({
          items: [
            {
              full_name: "testuser/repo",
              html_url: "url",
              description: "desc",
              private: false,
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const repos = await provider.searchRepos("token", "query", 1);
      expect(repos).toHaveLength(1);
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.searchRepos("token", "query")).rejects.toThrow("GitHub API error: 500");
    });
  });

  describe("createRepo", () => {
    it("creates and returns repo", async () => {
      const mockResponse = new Response(
        JSON.stringify({
          full_name: "testuser/new-repo",
          html_url: "url",
          description: "desc",
          private: true,
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      );
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const repo = await provider.createRepo("token", {
        name: "new-repo",
        description: "desc",
        isPrivate: true,
      });
      expect(repo).toEqual({
        name: "testuser/new-repo",
        url: "url",
        description: "desc",
        isPrivate: true,
        provider: "github",
      });
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 400 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(
        provider.createRepo("token", { name: "test", description: "", isPrivate: true })
      ).rejects.toThrow("GitHub create repo failed: 400");
    });
  });

  describe("createPR", () => {
    it("creates PR", async () => {
      const mockResponse = new Response(JSON.stringify({ html_url: "pr_url" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const url = await provider.createPR("token", {
        repoUrl: "test/repo",
        title: "title",
        body: "body",
        head: "head",
        base: "base",
      });
      expect(url).toBe("pr_url");
    });

    it("handles existing PR (422)", async () => {
      const createResponse = new Response("Error", { status: 422 });
      const findResponse = new Response(JSON.stringify([{ html_url: "existing_pr_url" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      spyOn(globalThis, "fetch").mockImplementation(((url: any) => {
        if (url.toString().includes("state=open")) {
          return Promise.resolve(findResponse);
        }
        return Promise.resolve(createResponse);
      }) as any);

      const url = await provider.createPR("token", {
        repoUrl: "test/repo",
        title: "title",
        body: "body",
        head: "head",
        base: "base",
      });
      expect(url).toBe("existing_pr_url");
    });

    it("throws on creation failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(
        provider.createPR("token", {
          repoUrl: "test/repo",
          title: "title",
          body: "body",
          head: "head",
          base: "base",
        })
      ).rejects.toThrow("GitHub create PR failed: 500");
    });
  });

  describe("isPrMerged", () => {
    it("returns true if merged", async () => {
      const mockResponse = new Response(JSON.stringify({ merged: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const merged = await provider.isPrMerged("token", "https://github.com/user/repo/pull/1");
      expect(merged).toBe(true);
    });

    it("returns false if not merged", async () => {
      const mockResponse = new Response(JSON.stringify({ merged: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const merged = await provider.isPrMerged("token", "https://github.com/user/repo/pull/1");
      expect(merged).toBe(false);
    });

    it("returns false if fetch fails", async () => {
      const mockResponse = new Response("Error", { status: 404 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const merged = await provider.isPrMerged("token", "https://github.com/user/repo/pull/1");
      expect(merged).toBe(false);
    });

    it("returns false if URL is invalid", async () => {
      const merged = await provider.isPrMerged("token", "invalid_url");
      expect(merged).toBe(false);
    });
  });

  describe("listIssues", () => {
    it("returns issues", async () => {
      const mockResponse = new Response(
        JSON.stringify([
          {
            number: 1,
            title: "title",
            body: "body",
            state: "open",
            labels: [{ name: "bug" }],
            assignee: { login: "user" },
            assignees: [{ login: "user" }],
            created_at: "date",
            updated_at: "date",
            html_url: "url",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const issues = await provider.listIssues("token", "test/repo", {
        limit: 1,
        recentlyUpdated: true,
        state: "open",
        labels: ["bug"],
      });
      expect(issues).toHaveLength(1);
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.listIssues("token", "test/repo")).rejects.toThrow(
        "GitHub API error: 500"
      );
    });
  });

  describe("listBranches", () => {
    it("returns branches", async () => {
      const mockResponse = new Response(JSON.stringify([{ name: "main" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const branches = await provider.listBranches("token", "test/repo");
      expect(branches).toEqual(["main"]);
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.listBranches("token", "test/repo")).rejects.toThrow(
        "GitHub API error: 500"
      );
    });
  });

  describe("ensureLabels", () => {
    it("creates labels", async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 201 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(
        provider.ensureLabels("token", "test/repo", [
          { name: "bug", color: "red", description: "desc" },
        ])
      ).resolves.toBeUndefined();
    });

    it("handles existing label (422)", async () => {
      const mockResponse = new Response("Error", { status: 422 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(
        provider.ensureLabels("token", "test/repo", [
          { name: "bug", color: "red", description: "desc" },
        ])
      ).resolves.toBeUndefined();
    });

    it("throws on other errors", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(
        provider.ensureLabels("token", "test/repo", [
          { name: "bug", color: "red", description: "desc" },
        ])
      ).rejects.toThrow("GitHub API error: 500");
    });
  });
});
