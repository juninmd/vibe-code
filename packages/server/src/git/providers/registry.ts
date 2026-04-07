import type { GitProvider } from "@vibe-code/shared";
import type { Db } from "../../db";
import { GitHubProvider } from "./github";
import { GitLabProvider } from "./gitlab";
import type { GitProviderAdapter } from "./types";

export class ProviderRegistry {
  private providers = new Map<GitProvider, GitProviderAdapter>();

  constructor(private db: Db) {
    this.providers.set("github", new GitHubProvider());
    this.rebuildGitLab();
  }

  /** Rebuild the GitLab provider when base URL changes */
  rebuildGitLab(): void {
    const baseUrl = this.db.settings.get("gitlab_base_url") || undefined;
    this.providers.set("gitlab", new GitLabProvider(baseUrl));
  }

  get(name: GitProvider): GitProviderAdapter | undefined {
    return this.providers.get(name);
  }

  /** Get the token for a given provider from settings/env */
  getToken(provider: GitProvider): string | undefined {
    if (provider === "github") {
      return this.db.settings.get("github_token") || process.env.GITHUB_TOKEN || undefined;
    }
    if (provider === "gitlab") {
      return this.db.settings.get("gitlab_token") || process.env.GITLAB_TOKEN || undefined;
    }
    return undefined;
  }

  /** Detect provider from a repository URL */
  detectProvider(url: string): GitProvider {
    if (url.includes("github.com")) return "github";
    const gitlabBaseUrl = this.db.settings.get("gitlab_base_url") || "gitlab.com";
    // Strip protocol for comparison
    const normalized = gitlabBaseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (url.includes(normalized) || url.includes("gitlab")) return "gitlab";
    return "manual";
  }

  /** Get provider + token for a repo URL. Returns null if no adapter available. */
  resolve(
    repoUrl: string
  ): { adapter: GitProviderAdapter; token: string; provider: GitProvider } | null {
    const provider = this.detectProvider(repoUrl);
    if (provider === "manual") return null;
    const adapter = this.providers.get(provider);
    const token = this.getToken(provider);
    if (!adapter || !token) return null;
    return { adapter, token, provider };
  }
}
