import type { RemoteRepo, RepositoryIssue } from "@vibe-code/shared";
import type {
  CreatePRParams,
  CreateRepoParams,
  GitProviderAdapter,
  LabelSpec,
  ListIssuesOptions,
} from "./types";

const DEFAULT_BASE_URL = "https://gitlab.com";

function headers(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "Content-Type": "application/json",
    "User-Agent": "vibe-code",
  };
}

/**
 * Project path ("group/sub/project") of a clone URL: https, http or scp-style ssh.
 * A GitLab served under a sub-path ("https://host/gitlab") has that prefix removed.
 */
export function getProjectPath(url: string, baseUrl = DEFAULT_BASE_URL): string {
  const ssh = url.match(/^[\w.-]+@[^:/]+:(.+?)(?:\.git)?\/*$/);
  if (ssh) return ssh[1];

  try {
    let path = new URL(url).pathname.replace(/\/+$/, "").replace(/\.git$/, "");
    const prefix = new URL(baseUrl).pathname.replace(/\/+$/, "");
    if (prefix && path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
    path = path.replace(/^\/+/, "");
    if (path) return path;
  } catch {
    // Not a URL: fall through.
  }
  return url;
}

export class GitLabProvider implements GitProviderAdapter {
  readonly name = "gitlab" as const;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private api(path: string): string {
    return `${this.baseUrl}/api/v4${path}`;
  }

  async getUser(token: string): Promise<{ username: string; displayName?: string }> {
    const res = await fetch(this.api("/user"), { headers: headers(token) });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { username: string; name?: string };
    return { username: data.username, displayName: data.name ?? undefined };
  }

  async listRepos(token: string, limit = 20): Promise<RemoteRepo[]> {
    const repos: RemoteRepo[] = [];
    let page = 1;
    const perPage = Math.min(limit, 100);

    while (repos.length < limit) {
      const res = await fetch(
        this.api(
          `/projects?membership=true&per_page=${perPage}&page=${page}&order_by=updated_at&sort=desc`
        ),
        { headers: headers(token) }
      );
      if (!res.ok) throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as {
        path_with_namespace: string;
        web_url: string;
        description: string | null;
        visibility: string;
      }[];
      if (data.length === 0) break;
      for (const r of data) {
        repos.push({
          name: r.path_with_namespace,
          url: r.web_url,
          description: r.description ?? "",
          isPrivate: r.visibility === "private",
          provider: "gitlab",
        });
      }
      if (data.length < perPage) break;
      page++;
    }
    return repos.slice(0, limit);
  }

  async searchRepos(token: string, query: string, limit = 20): Promise<RemoteRepo[]> {
    const perPage = Math.min(limit, 100);
    const q = encodeURIComponent(query);
    const res = await fetch(
      this.api(
        `/projects?search=${q}&membership=true&per_page=${perPage}&order_by=similarity&sort=desc`
      ),
      { headers: headers(token) }
    );
    if (!res.ok) throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as {
      path_with_namespace: string;
      web_url: string;
      description: string | null;
      visibility: string;
    }[];
    return data.map((r) => ({
      name: r.path_with_namespace,
      url: r.web_url,
      description: r.description ?? "",
      isPrivate: r.visibility === "private",
      provider: "gitlab",
    }));
  }

  async createRepo(token: string, params: CreateRepoParams): Promise<RemoteRepo> {
    const res = await fetch(this.api("/projects"), {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        name: params.name,
        description: params.description,
        visibility: params.isPrivate ? "private" : "public",
        initialize_with_readme: true,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitLab create project failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as {
      path_with_namespace: string;
      web_url: string;
      http_url_to_repo: string;
      description: string | null;
      visibility: string;
    };
    return {
      name: data.path_with_namespace,
      url: data.web_url,
      description: data.description ?? "",
      isPrivate: data.visibility === "private",
      provider: "gitlab",
    };
  }

  async createPR(token: string, params: CreatePRParams): Promise<string> {
    const projectPath = getProjectPath(params.repoUrl, this.baseUrl);
    const encodedPath = encodeURIComponent(projectPath);

    const res = await fetch(this.api(`/projects/${encodedPath}/merge_requests`), {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        source_branch: params.head,
        target_branch: params.base,
        title: params.title,
        description: params.body,
      }),
    });
    if (!res.ok) {
      if (res.status === 409 || res.status === 422) {
        // An open MR for this source branch may already exist — return it instead of failing
        const existing = await this.findOpenMR(token, encodedPath, params.head);
        if (existing) return existing;
      }
      const err = await res.text();
      throw new Error(`GitLab create MR failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { web_url: string };
    return data.web_url;
  }

  private async findOpenMR(
    token: string,
    encodedProjectPath: string,
    sourceBranch: string
  ): Promise<string | null> {
    const url = this.api(
      `/projects/${encodedProjectPath}/merge_requests?state=opened&source_branch=${encodeURIComponent(sourceBranch)}&per_page=1`
    );
    const res = await fetch(url, { headers: headers(token) });
    if (!res.ok) return null;
    const data = (await res.json()) as { web_url: string }[];
    return data[0]?.web_url ?? null;
  }

  async isPrMerged(token: string, prUrl: string): Promise<boolean> {
    // Parse MR URL: https://gitlab.com/owner/repo/-/merge_requests/123
    const match = prUrl.match(/([^/]+(?:\/[^/]+)+)\/-\/merge_requests\/(\d+)/);
    if (!match) return false;
    const [, projectPath, mrIid] = match;
    const encodedPath = encodeURIComponent(projectPath);

    const res = await fetch(this.api(`/projects/${encodedPath}/merge_requests/${mrIid}`), {
      headers: headers(token),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { state: string };
    return data.state === "merged";
  }

  async listIssues(
    token: string,
    repoUrl: string,
    options?: ListIssuesOptions
  ): Promise<RepositoryIssue[]> {
    const projectPath = getProjectPath(repoUrl, this.baseUrl);
    const encodedPath = encodeURIComponent(projectPath);
    const params = new URLSearchParams();
    params.set("per_page", String(Math.min(options?.limit ?? 50, 100)));
    if (options?.recentlyUpdated) {
      params.set("order_by", "updated_at");
      params.set("sort", "desc");
    }
    // GitLab calls open issues "opened", both in queries and in responses.
    if (options?.state && options.state !== "all") {
      params.set("state", options.state === "open" ? "opened" : options.state);
    }
    if (options?.labels && options.labels.length > 0) {
      params.set("labels", options.labels.join(","));
    }

    const res = await fetch(`${this.api(`/projects/${encodedPath}/issues`)}?${params}`, {
      headers: headers(token),
    });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as {
      iid: number;
      title: string;
      description: string | null;
      state: string;
      labels: string[];
      assignee: { username: string } | null;
      assignees: { username: string }[];
      created_at: string;
      updated_at: string;
      web_url: string;
    }[];

    return data.map((issue) => ({
      id: String(issue.iid),
      number: issue.iid,
      title: issue.title,
      body: issue.description,
      state: issue.state === "closed" ? "closed" : "open",
      labels: issue.labels,
      assignee: issue.assignee?.username ?? null,
      assignees: issue.assignees.map((a) => a.username),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      url: issue.web_url,
    }));
  }

  async updateIssueLabels(
    token: string,
    repoUrl: string,
    issueNumber: number,
    change: { add: string[]; remove: string[] }
  ): Promise<void> {
    if (change.add.length === 0 && change.remove.length === 0) return;
    const encodedPath = encodeURIComponent(getProjectPath(repoUrl, this.baseUrl));
    const res = await fetch(this.api(`/projects/${encodedPath}/issues/${issueNumber}`), {
      method: "PUT",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        add_labels: change.add.join(","),
        remove_labels: change.remove.join(","),
      }),
    });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
  }

  async ensureLabels(token: string, repoUrl: string, labels: LabelSpec[]): Promise<void> {
    const encodedPath = encodeURIComponent(getProjectPath(repoUrl, this.baseUrl));
    for (const label of labels) {
      const res = await fetch(this.api(`/projects/${encodedPath}/labels`), {
        method: "POST",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: label.name,
          color: `#${label.color}`,
          description: label.description,
        }),
      });
      // 409: it exists already.
      if (!res.ok && res.status !== 409) {
        throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
      }
    }
  }

  async listBranches(token: string, repoUrl: string): Promise<string[]> {
    const projectPath = getProjectPath(repoUrl, this.baseUrl);
    const encodedPath = encodeURIComponent(projectPath);
    const branches: string[] = [];
    let page = 1;
    const perPage = 100;

    while (branches.length < 500) {
      const res = await fetch(
        this.api(`/projects/${encodedPath}/repository/branches?per_page=${perPage}&page=${page}`),
        { headers: headers(token) }
      );
      if (!res.ok) throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as { name: string }[];
      if (data.length === 0) break;
      for (const b of data) {
        branches.push(b.name);
      }
      if (data.length < perPage) break;
      page++;
    }
    return branches;
  }
}
