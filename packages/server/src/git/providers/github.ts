import type { RemoteRepo, RepositoryIssue } from "@vibe-code/shared";
import type { CreatePRParams, CreateRepoParams, GitProviderAdapter } from "./types";

const GH_API = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibe-code",
  };
}

function getRepoOwnerAndName(url: string): string {
  const match = url.match(/[:/]([^/:]+\/[^/.]+)(?:\.git)?$/);
  return match ? match[1] : url;
}

export class GitHubProvider implements GitProviderAdapter {
  readonly name = "github" as const;

  async getUser(token: string): Promise<{ username: string; displayName?: string }> {
    const res = await fetch(`${GH_API}/user`, { headers: headers(token) });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { login: string; name?: string };
    return { username: data.login, displayName: data.name ?? undefined };
  }

  async listRepos(token: string, limit = 20): Promise<RemoteRepo[]> {
    const repos: RemoteRepo[] = [];
    let page = 1;
    const perPage = Math.min(limit, 100);

    while (repos.length < limit) {
      const res = await fetch(
        `${GH_API}/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        { headers: headers(token) }
      );
      if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as {
        full_name: string;
        html_url: string;
        description: string | null;
        private: boolean;
      }[];
      if (data.length === 0) break;
      for (const r of data) {
        repos.push({
          name: r.full_name,
          url: r.html_url,
          description: r.description ?? "",
          isPrivate: r.private,
          provider: "github",
        });
      }
      if (data.length < perPage) break;
      page++;
    }
    return repos.slice(0, limit);
  }

  async searchRepos(token: string, query: string, limit = 20): Promise<RemoteRepo[]> {
    const perPage = Math.min(limit, 100);
    const q = encodeURIComponent(`${query} in:name,description`);
    const res = await fetch(
      `${GH_API}/search/repositories?q=${q}&per_page=${perPage}&sort=best-match`,
      { headers: headers(token) }
    );
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      items: {
        full_name: string;
        html_url: string;
        description: string | null;
        private: boolean;
      }[];
    };
    return (json.items ?? []).map((r) => ({
      name: r.full_name,
      url: r.html_url,
      description: r.description ?? "",
      isPrivate: r.private,
      provider: "github",
    }));
  }

  async createRepo(token: string, params: CreateRepoParams): Promise<RemoteRepo> {
    const res = await fetch(`${GH_API}/user/repos`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: params.name,
        description: params.description,
        private: params.isPrivate,
        auto_init: true,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub create repo failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as {
      full_name: string;
      html_url: string;
      description: string | null;
      private: boolean;
    };
    return {
      name: data.full_name,
      url: data.html_url,
      description: data.description ?? "",
      isPrivate: data.private,
      provider: "github",
    };
  }

  async createPR(token: string, params: CreatePRParams): Promise<string> {
    const repoPath = getRepoOwnerAndName(params.repoUrl);
    const res = await fetch(`${GH_API}/repos/${repoPath}/pulls`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
      }),
    });
    if (!res.ok) {
      if (res.status === 422) {
        // A PR for this branch may already exist — return it instead of failing
        const existing = await this.findOpenPR(token, repoPath, params.head, params.base);
        if (existing) return existing;
      }
      const err = await res.text();
      throw new Error(`GitHub create PR failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { html_url: string };
    return data.html_url;
  }

  private async findOpenPR(
    token: string,
    repoPath: string,
    head: string,
    base: string
  ): Promise<string | null> {
    const owner = repoPath.split("/")[0];
    const headQuery = `${owner}:${head}`;
    const url = `${GH_API}/repos/${repoPath}/pulls?state=open&head=${encodeURIComponent(headQuery)}&base=${encodeURIComponent(base)}&per_page=1`;
    const res = await fetch(url, { headers: headers(token) });
    if (!res.ok) return null;
    const data = (await res.json()) as { html_url: string }[];
    return data[0]?.html_url ?? null;
  }

  async isPrMerged(token: string, prUrl: string): Promise<boolean> {
    const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) return false;
    const [, repoPath, prNumber] = match;
    const apiUrl = `${GH_API}/repos/${repoPath}/pulls/${prNumber}`;

    const res = await fetch(apiUrl, { headers: headers(token) });
    if (!res.ok) return false;
    const data = (await res.json()) as { merged: boolean };
    return data.merged === true;
  }

  async listIssues(
    token: string,
    repoUrl: string,
    options?: { state?: "open" | "closed" | "all"; labels?: string[]; limit?: number }
  ): Promise<RepositoryIssue[]> {
    const repoPath = getRepoOwnerAndName(repoUrl);
    const params = new URLSearchParams();
    params.set("per_page", String(options?.limit ?? 50));
    if (options?.state) params.set("state", options.state);
    if (options?.labels && options.labels.length > 0) {
      params.set("labels", options.labels.join(","));
    }

    const res = await fetch(`${GH_API}/repos/${repoPath}/issues?${params}`, {
      headers: headers(token),
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as {
      number: number;
      title: string;
      body: string | null;
      state: string;
      labels: { name: string }[];
      assignee: { login: string } | null;
      assignees: { login: string }[];
      created_at: string;
      updated_at: string;
      html_url: string;
      pull_request?: unknown;
    }[];

    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        id: String(issue.number),
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state as "open" | "closed",
        labels: issue.labels.map((l) => l.name),
        assignee: issue.assignee?.login ?? null,
        assignees: issue.assignees.map((a) => a.login),
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        url: issue.html_url,
      }));
  }

  async listBranches(token: string, repoUrl: string): Promise<string[]> {
    const repoPath = getRepoOwnerAndName(repoUrl);
    const branches: string[] = [];
    let page = 1;
    const perPage = 100;

    while (branches.length < 500) {
      const res = await fetch(
        `${GH_API}/repos/${repoPath}/branches?per_page=${perPage}&page=${page}`,
        { headers: headers(token) }
      );
      if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
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
