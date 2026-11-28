import { afterEach, describe, expect, it } from "bun:test";
import { GitHubProvider } from "./github";
import { GitLabProvider, getProjectPath } from "./gitlab";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];

function mockFetch(respond: (call: Call) => { status?: number; json?: unknown }) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status = 200, json = {} } = respond(call);
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("GitHubProvider labels", () => {
  const github = new GitHubProvider();
  const repo = "https://github.com/o/r.git";

  it("adds labels in one call and removes each old one, ignoring labels already gone", async () => {
    mockFetch((call) => ({
      status: call.method === "DELETE" && call.url.includes("gone") ? 404 : 200,
    }));

    await github.updateIssueLabels("tok", repo, 12, {
      add: ["status:review"],
      remove: ["status:todo", "gone one"],
    });

    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "https://api.github.com/repos/o/r/issues/12/labels"],
      ["DELETE", "https://api.github.com/repos/o/r/issues/12/labels/status%3Atodo"],
      ["DELETE", "https://api.github.com/repos/o/r/issues/12/labels/gone%20one"],
    ]);
    expect(calls[0].body).toEqual({ labels: ["status:review"] });
  });

  it("skips the add call when there is nothing to add", async () => {
    mockFetch(() => ({}));
    await github.updateIssueLabels("tok", repo, 1, { add: [], remove: ["a"] });
    expect(calls.map((c) => c.method)).toEqual(["DELETE"]);
  });

  it("fails loudly when the provider refuses", async () => {
    mockFetch(() => ({ status: 403 }));
    await expect(
      github.updateIssueLabels("tok", repo, 1, { add: ["x"], remove: [] })
    ).rejects.toThrow("403");
  });

  it("creates labels with their colour and treats 'already exists' as success", async () => {
    mockFetch((call) => ({ status: (call.body as { name: string }).name === "b" ? 422 : 201 }));
    await github.ensureLabels("tok", repo, [
      { name: "a", color: "3b82f6", description: "d" },
      { name: "b", color: "ef4444" },
    ]);
    expect(calls[0]).toMatchObject({
      url: "https://api.github.com/repos/o/r/labels",
      body: { name: "a", color: "3b82f6", description: "d" },
    });
    expect(calls).toHaveLength(2);
  });

  it("asks for the most recently updated issues and caps the page at 100", async () => {
    mockFetch(() => ({ json: [] }));
    await github.listIssues("tok", repo, { state: "all", limit: 500, recentlyUpdated: true });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(url.searchParams.get("sort")).toBe("updated");
    expect(url.searchParams.get("direction")).toBe("desc");
    expect(url.searchParams.get("state")).toBe("all");
  });
});

describe("GitLabProvider labels", () => {
  const gitlab = new GitLabProvider("https://gitlab.example.com");
  const repo = "https://gitlab.example.com/group/sub/project.git";

  it("relabels with one update, scoped labels included", async () => {
    mockFetch(() => ({}));
    await gitlab.updateIssueLabels("tok", repo, 7, {
      add: ["status::review"],
      remove: ["status::todo"],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe(
      "https://gitlab.example.com/api/v4/projects/group%2Fsub%2Fproject/issues/7"
    );
    expect(calls[0].body).toEqual({ add_labels: "status::review", remove_labels: "status::todo" });
  });

  it("does nothing for an empty change", async () => {
    mockFetch(() => ({}));
    await gitlab.updateIssueLabels("tok", repo, 7, { add: [], remove: [] });
    expect(calls).toHaveLength(0);
  });

  it("creates labels with a # colour and treats a conflict as success", async () => {
    mockFetch((call) => ({ status: (call.body as { name: string }).name === "b" ? 409 : 201 }));
    await gitlab.ensureLabels("tok", repo, [
      { name: "a", color: "3b82f6" },
      { name: "b", color: "ef4444" },
    ]);
    expect(calls[0].body).toMatchObject({ name: "a", color: "#3b82f6" });
    expect(calls).toHaveLength(2);
  });

  it('reports GitLab\'s "opened" issues as open, and asks for them that way', async () => {
    const issue = (iid: number, state: string) => ({
      iid,
      title: `t${iid}`,
      description: null,
      state,
      labels: ["a"],
      assignee: null,
      assignees: [],
      created_at: "",
      updated_at: "",
      web_url: `https://gitlab.example.com/group/sub/project/-/issues/${iid}`,
    });
    mockFetch(() => ({ json: [issue(1, "opened"), issue(2, "closed")] }));

    const found = await gitlab.listIssues("tok", repo, { state: "open" });

    expect(new URL(calls[0].url).searchParams.get("state")).toBe("opened");
    expect(found.map((entry) => [entry.number, entry.state])).toEqual([
      [1, "open"],
      [2, "closed"],
    ]);
  });

  it("orders issues by last update when asked", async () => {
    mockFetch(() => ({ json: [] }));
    await gitlab.listIssues("tok", repo, { state: "all", recentlyUpdated: true });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("order_by")).toBe("updated_at");
    expect(url.searchParams.get("sort")).toBe("desc");
    expect(url.searchParams.has("state")).toBe(false);
  });
});

describe("getProjectPath", () => {
  it("returns the project path of https, http and ssh clone URLs", () => {
    expect(getProjectPath("https://gitlab.com/owner/repo.git")).toBe("owner/repo");
    expect(getProjectPath("https://gitlab.com/owner/repo")).toBe("owner/repo");
    expect(getProjectPath("https://gitlab.com/owner/repo/")).toBe("owner/repo");
    expect(getProjectPath("http://gitlab.local/group/sub/project.git")).toBe("group/sub/project");
    expect(getProjectPath("git@gitlab.com:owner/repo.git")).toBe("owner/repo");
    expect(getProjectPath("git@gitlab.example.com:group/sub/project")).toBe("group/sub/project");
  });

  it("drops the sub-path a self-hosted GitLab is served under", () => {
    expect(getProjectPath("https://host/gitlab/group/project.git", "https://host/gitlab")).toBe(
      "group/project"
    );
  });

  it("hands back what it cannot parse", () => {
    expect(getProjectPath("owner/repo")).toBe("owner/repo");
  });
});
