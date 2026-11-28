/**
 * MCP servers every run gets by default: GitHub (OAuth login or token) and
 * GitLab (personal access token or OAuth2, including self-managed instances)
 * once authenticated, plus Playwright (browser evidence) and Context7 (library
 * docs), which need no sign-in. A server with the same name in the user's
 * `mcp_servers` map wins; `mcp_default_<id>_enabled=false` turns one off.
 */
import { join, resolve } from "node:path";
import type { McpConnection } from "@vibe-code/shared";
import { resolveGitHubToken } from "../git/github-credentials";
import { freshGitLabToken, gitlabBaseUrl, gitlabOAuthClient } from "../integrations/gitlab-oauth";

/** Pinned: `npx -y pkg` without a version would run whatever was published last. */
export const GITLAB_MCP_PACKAGE = "@zereight/mcp-gitlab@2.3.27";
const GITHUB_MCP_PROXY = resolve(import.meta.dir, "../../scripts/github-mcp-proxy.mjs");
export const NPX_NEUTRAL = resolve(import.meta.dir, "../../scripts/npx-neutral.mjs");
export const PLAYWRIGHT_MCP_PACKAGE = "@playwright/mcp@0.0.85";
export const CONTEXT7_MCP_PACKAGE = "@upstash/context7-mcp@4.7.3";
/** Where the Playwright MCP saves screenshots; read back when the PR is opened. */
export const EVIDENCE_DIR = ".vibe-code/evidence";

export type DefaultMcpId = "github" | "gitlab" | "playwright" | "context7";
const AUTHLESS: DefaultMcpId[] = ["playwright", "context7"];
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
    command: ["node", NPX_NEUTRAL, GITLAB_MCP_PACKAGE],
    enabled: true,
    environment: {
      GITLAB_PERSONAL_ACCESS_TOKEN: token,
      GITLAB_API_URL: `${baseUrl}/api/v4`,
    },
  };
}

type Which = (bin: string) => string | null;

/** The image's preinstalled binary when present, else the pinned package via npx. */
function packageCommand(bin: string, pkg: string, which: Which): string[] {
  const installed = which(bin);
  return installed ? [installed] : ["node", NPX_NEUTRAL, pkg];
}

export function playwrightMcpServer(workspace: string | undefined, which: Which): McpServerConfig {
  const args = ["--headless", "--isolated"];
  if (workspace) args.push("--output-dir", join(workspace, EVIDENCE_DIR));
  return {
    type: "local",
    command: [...packageCommand("playwright-mcp", PLAYWRIGHT_MCP_PACKAGE, which), ...args],
    enabled: true,
  };
}

export function context7McpServer(apiKey: string | undefined, which: Which): McpServerConfig {
  return {
    type: "local",
    command: packageCommand("context7-mcp", CONTEXT7_MCP_PACKAGE, which),
    enabled: true,
    ...(apiKey ? { environment: { CONTEXT7_API_KEY: apiKey } } : {}),
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
  options: { env?: Env; fetchImpl?: typeof fetch; workspace?: string; which?: Which } = {}
): Promise<Record<string, McpServerConfig>> {
  const env = options.env ?? process.env;
  const which = options.which ?? ((bin: string) => Bun.which(bin));
  const servers = readUserMcpServers(settings);
  if (!servers.github && isDefaultMcpEnabled(settings, "github")) {
    const token = resolveGitHubToken({ settings }, env);
    if (token) servers.github = githubMcpServer(token);
  }
  if (!servers.gitlab && isDefaultMcpEnabled(settings, "gitlab")) {
    const token = await freshGitLabToken(settings, { env, fetchImpl: options.fetchImpl });
    if (token) servers.gitlab = gitlabMcpServer(token, gitlabBaseUrl(settings));
  }
  if (!servers.playwright && isDefaultMcpEnabled(settings, "playwright"))
    servers.playwright = playwrightMcpServer(options.workspace, which);
  if (!servers.context7 && isDefaultMcpEnabled(settings, "context7"))
    servers.context7 = context7McpServer(
      settings.get("context7_api_key") || env.CONTEXT7_API_KEY,
      which
    );
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
    ...AUTHLESS.map((id) => ({
      id,
      enabled: isDefaultMcpEnabled(settings, id),
      connected: true,
      method: null,
      oauthAvailable: false,
      overridden: Boolean(user[id]),
      authless: true,
    })),
  ];
}
