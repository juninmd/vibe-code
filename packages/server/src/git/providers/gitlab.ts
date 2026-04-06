import type { RemoteRepo } from "@vibe-code/shared";
import type { CreatePRParams, CreateRepoParams, GitProviderAdapter } from "./types";

const DEFAULT_BASE_URL = "https://gitlab.com";

function headers(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "Content-Type": "application/json",
    "User-Agent": "vibe-code",
  };
}

/** Extract GitLab project path from URL, e.g. "owner/repo" */
function getProjectPath(url: string): string {
  const match = url.match(/[:/]([^:/][^/]*(?:\/[^/.]+)+?)(?:\.git)?$/);
  return match ? match[1] : url;
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

  async listRepos(token: string, limit = 200): Promise<RemoteRepo[]> {
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
    const projectPath = getProjectPath(params.repoUrl);
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
      const err = await res.text();
      throw new Error(`GitLab create MR failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { web_url: string };
    return data.web_url;
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
}
