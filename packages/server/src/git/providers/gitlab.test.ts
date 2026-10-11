import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { GitLabProvider, getProjectPath } from "./gitlab";

describe("GitLabProvider", () => {
  let provider: GitLabProvider;

  beforeEach(() => {
    provider = new GitLabProvider();
  });

  afterEach(() => {
    mock.restore();
  });

  describe("getUser", () => {
    it("returns user on success", async () => {
      const mockResponse = new Response(
        JSON.stringify({ username: "testuser", name: "Test User" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const user = await provider.getUser("token");
      expect(user).toEqual({ username: "testuser", displayName: "Test User" });
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 401 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.getUser("token")).rejects.toThrow("GitLab API error: 401");
    });
  });

  describe("listRepos", () => {
    it("returns repos", async () => {
      const mockResponse = new Response(
        JSON.stringify([
          {
            path_with_namespace: "testuser/repo",
            web_url: "url",
            description: "desc",
            visibility: "private",
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
        provider: "gitlab",
      });
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.listRepos("token")).rejects.toThrow("GitLab API error: 500");
    });
  });

  describe("searchRepos", () => {
    it("returns search results", async () => {
      const mockResponse = new Response(
        JSON.stringify([
          {
            path_with_namespace: "testuser/repo",
            web_url: "url",
            description: "desc",
            visibility: "public",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const repos = await provider.searchRepos("token", "query", 1);
      expect(repos).toHaveLength(1);
      expect(repos[0].isPrivate).toBe(false);
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.searchRepos("token", "query")).rejects.toThrow("GitLab API error: 500");
    });
  });

  describe("createRepo", () => {
    it("creates and returns repo", async () => {
      const mockResponse = new Response(
        JSON.stringify({
          path_with_namespace: "testuser/new-repo",
          web_url: "url",
          http_url_to_repo: "http_url",
          description: "desc",
          visibility: "private",
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
        provider: "gitlab",
      });
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 400 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(
        provider.createRepo("token", { name: "test", description: "", isPrivate: true })
      ).rejects.toThrow("GitLab create project failed: 400");
    });
  });

  describe("createPR", () => {
    it("creates PR", async () => {
      const mockResponse = new Response(JSON.stringify({ web_url: "mr_url" }), {
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
      expect(url).toBe("mr_url");
    });

    it("handles existing MR (409)", async () => {
      const createResponse = new Response("Error", { status: 409 });
      const findResponse = new Response(JSON.stringify([{ web_url: "existing_mr_url" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      spyOn(globalThis, "fetch").mockImplementation(((url: any) => {
        if (url.toString().includes("state=opened")) {
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
      expect(url).toBe("existing_mr_url");
    });

    it("handles existing MR (422)", async () => {
      const createResponse = new Response("Error", { status: 422 });
      const findResponse = new Response(JSON.stringify([{ web_url: "existing_mr_url" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      spyOn(globalThis, "fetch").mockImplementation(((url: any) => {
        if (url.toString().includes("state=opened")) {
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
      expect(url).toBe("existing_mr_url");
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
      ).rejects.toThrow("GitLab create MR failed: 500");
    });
  });

  describe("isPrMerged", () => {
    it("returns true if merged", async () => {
      const mockResponse = new Response(JSON.stringify({ state: "merged" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const merged = await provider.isPrMerged(
        "token",
        "https://gitlab.com/owner/repo/-/merge_requests/123"
      );
      expect(merged).toBe(true);
    });

    it("returns false if not merged", async () => {
      const mockResponse = new Response(JSON.stringify({ state: "opened" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const merged = await provider.isPrMerged(
        "token",
        "https://gitlab.com/owner/repo/-/merge_requests/123"
      );
      expect(merged).toBe(false);
    });

    it("returns false if fetch fails", async () => {
      const mockResponse = new Response("Error", { status: 404 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const merged = await provider.isPrMerged(
        "token",
        "https://gitlab.com/owner/repo/-/merge_requests/123"
      );
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
            iid: 1,
            title: "title",
            description: "desc",
            state: "opened",
            labels: ["bug"],
            assignee: { username: "user" },
            assignees: [{ username: "user" }],
            created_at: "date",
            updated_at: "date",
            web_url: "url",
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

    it("handles closed issues", async () => {
      const mockResponse = new Response(
        JSON.stringify([
          {
            iid: 1,
            title: "title",
            description: "desc",
            state: "closed",
            labels: ["bug"],
            assignee: null,
            assignees: [],
            created_at: "date",
            updated_at: "date",
            web_url: "url",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const issues = await provider.listIssues("token", "test/repo", { state: "closed" });
      expect(issues[0].state).toBe("closed");
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(provider.listIssues("token", "test/repo")).rejects.toThrow(
        "GitLab API error: 500"
      );
    });
  });

  describe("updateIssueLabels", () => {
    it("updates labels", async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(
        provider.updateIssueLabels("token", "test/repo", 1, {
          add: ["bug"],
          remove: ["enhancement"],
        })
      ).resolves.toBeUndefined();
    });

    it("returns early if no changes", async () => {
      await expect(
        provider.updateIssueLabels("token", "test/repo", 1, { add: [], remove: [] })
      ).resolves.toBeUndefined();
    });

    it("throws on failure", async () => {
      const mockResponse = new Response("Error", { status: 500 });
      spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      await expect(
        provider.updateIssueLabels("token", "test/repo", 1, { add: ["bug"], remove: [] })
      ).rejects.toThrow("GitLab API error: 500");
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
        "GitLab API error: 500"
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

    it("handles existing label (409)", async () => {
      const mockResponse = new Response("Error", { status: 409 });
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
      ).rejects.toThrow("GitLab API error: 500");
    });
  });

  describe("getProjectPath", () => {
    it("handles simple url", () => {
      expect(getProjectPath("https://gitlab.com/user/repo.git", "https://gitlab.com")).toBe(
        "user/repo"
      );
    });

    it("handles invalid url", () => {
      expect(getProjectPath("not-a-url", "https://gitlab.com")).toBe("not-a-url");
    });
  });
});
