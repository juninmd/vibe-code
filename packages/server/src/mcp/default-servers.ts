/**
 * MCP servers every run gets by default, once their provider is authenticated:
 * GitHub (OAuth login or token) and GitLab (personal access token or OAuth2,
 * including self-managed instances). A server with the same name in the
 * user's `mcp_servers` map wins; `mcp_default_<id>_enabled=false` turns one off.
 */
import { resolve } from "node:path";
import type { McpConnection } from "@vibe-code/shared";
import { resolveGitHubToken } from "../git/github-credentials";
import { freshGitLabToken, gitlabBaseUrl, gitlabOAuthClient } from "../integrations/gitlab-oauth";

/** Pinned: `npx -y pkg` without a version would run whatever was published last. */
export const GITLAB_MCP_PACKAGE = "@zereight/mcp-gitlab@2.3.27";
const GITHUB_MCP_PROXY = resolve(import.meta.dir, "../../scripts/github-mcp-proxy.mjs");

export type DefaultMcpId = "github" | "gitlab";
export type McpServerConfig = Record<string, unknown>;
type Settings = { get(key: string): string | null; set(key: string, v: string): void };
type Env = Record<string, string | undefined>;

export function isDefaultMcpEnabled(settings: Pick<Settings, "get">, id: DefaultMcpId): boolean {
  return settings.get(`mcp_default_${id}_enabled`) !== "false";
}

export function githubMcpServer(token: string): McpServerConfig {
  return {
    type: "local",
    // The proxy coerces boolean fields that weaker models send as strings.
    command: ["node", GITHUB_MCP_PROXY],
    enabled: true,
    environment: { GITHUB_PERSONAL_ACCESS_TOKEN: token },
  };
}

export function gitlabMcpServer(token: string, baseUrl: string): McpServerConfig {
  return {
    type: "local",
    command: ["npx", "-y", GITLAB_MCP_PACKAGE],
    enabled: true,
    environment: {
      GITLAB_PERSONAL_ACCESS_TOKEN: token,
      GITLAB_API_URL: `${baseUrl}/api/v4`,
    },
  };
}

export function readUserMcpServers(
  settings: Pick<Settings, "get">
): Record<string, McpServerConfig> {
  try {
    const parsed = JSON.parse(settings.get("mcp_servers") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** User-configured servers plus the authenticated defaults. */
export async function resolveMcpServers(
  settings: Settings,
  options: { env?: Env; fetchImpl?: typeof fetch } = {}
): Promise<Record<string, McpServerConfig>> {
  const env = options.env ?? process.env;
  const servers = readUserMcpServers(settings);
  if (!servers.github && isDefaultMcpEnabled(settings, "github")) {
    const token = resolveGitHubToken({ settings }, env);
    if (token) servers.github = githubMcpServer(token);
  }
  if (!servers.gitlab && isDefaultMcpEnabled(settings, "gitlab")) {
    const token = await freshGitLabToken(settings, { env, fetchImpl: options.fetchImpl });
    if (token) servers.gitlab = gitlabMcpServer(token, gitlabBaseUrl(settings));
  }
  return servers;
}

export type McpConnectionStatus = McpConnection;

export function mcpConnectionStatus(
  settings: Pick<Settings, "get">,
  env: Env = process.env
): McpConnectionStatus[] {
  const user = readUserMcpServers(settings);
  const githubToken = resolveGitHubToken({ settings }, env);
  const gitlabToken = settings.get("gitlab_token") || env.GITLAB_TOKEN;
  const githubOAuth = Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET);
  return [
    {
      id: "github",
      enabled: isDefaultMcpEnabled(settings, "github"),
      connected: Boolean(githubToken),
      method: githubToken ? (githubToken.startsWith("gho_") ? "oauth" : "token") : null,
      account: settings.get("github_username") || undefined,
      oauthAvailable: githubOAuth,
      overridden: Boolean(user.github),
    },
    {
      id: "gitlab",
      enabled: isDefaultMcpEnabled(settings, "gitlab"),
      connected: Boolean(gitlabToken),
      method: gitlabToken
        ? settings.get("gitlab_auth_method") === "oauth"
          ? "oauth"
          : "token"
        : null,
      account: settings.get("gitlab_username") || undefined,
      baseUrl: gitlabBaseUrl(settings),
      oauthAvailable: Boolean(gitlabOAuthClient(settings, env)),
      overridden: Boolean(user.gitlab),
    },
  ];
}
