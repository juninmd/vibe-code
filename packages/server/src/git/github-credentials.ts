/**
 * GitHub credentials for git and the agents.
 *
 * The token comes from the signed-in user's GitHub OAuth session (stored in
 * settings on login) or, as a fallback, GITHUB_TOKEN. It is handed to git as
 * an `http.<github>.extraheader` through GIT_CONFIG_* env vars, so it never
 * lands in a remote URL, `.git/config` or the process argv.
 */

interface SettingsReader {
  settings: { get(key: string): string | null | undefined };
}

const GITHUB_HTTP_PREFIX = "https://github.com/";

export function resolveGitHubToken(
  db: SettingsReader,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  return db.settings.get("github_token") || env.GITHUB_TOKEN || undefined;
}

/** GIT_CONFIG_* entries that authenticate git over https://github.com, chained after `base`'s. */
export function gitHubGitConfigEnv(
  token: string | undefined,
  base: Record<string, string | undefined> = process.env
): Record<string, string> {
  if (!token) return {};
  const existing = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10);
  const index = Number.isNaN(existing) || existing < 0 ? 0 : existing;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: `http.${GITHUB_HTTP_PREFIX}.extraheader`,
    [`GIT_CONFIG_VALUE_${index}`]: `AUTHORIZATION: basic ${basic}`,
  };
}

/** Env for an agent process: `gh` and `git push` act as the signed-in GitHub user. */
export function agentGitHubEnv(
  token: string | undefined,
  base: Record<string, string | undefined> = process.env
): Record<string, string> {
  if (!token) return {};
  return { GH_TOKEN: token, GITHUB_TOKEN: token, ...gitHubGitConfigEnv(token, base) };
}
