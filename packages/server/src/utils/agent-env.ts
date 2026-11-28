/**
 * Environment handed to coding agents, their terminals and the commands they run.
 *
 * Agents execute arbitrary code (and whatever a prompt-injected repo asks for),
 * so anything they can read may end up in a transcript, a commit or a request
 * to an outside host. Server-only credentials (the vibe-code API key, OAuth
 * client secret, the LiteLLM master key, database URLs, bot tokens) are never
 * inherited. Provider keys the agent needs to call its model, and GITHUB_TOKEN
 * for opening PRs, are kept.
 */
import { hookGuardEnv } from "../git/hook-guard";

const SERVER_ONLY = new Set([
  "VIBE_CODE_API_KEY",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "LITELLM_MASTER_KEY",
  "DATABASE_URL",
  "POSTGRES_URL",
  "TELEGRAM_BOT_TOKEN",
  "VIBE_CODE_SESSION_SECRET",
  "VIBE_CODE_ENCRYPTION_KEY",
]);

const SECRET_NAME = /(^|_)(SECRET|PASSWORD|PASSWD|MASTER_KEY|PRIVATE_KEY|SESSION_KEY)(_|$)/i;

/** Extra names to strip, comma separated (VIBE_CODE_AGENT_ENV_DENY). */
function extraDenied(env: Record<string, string | undefined>): Set<string> {
  return new Set(
    (env.VIBE_CODE_AGENT_ENV_DENY ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  );
}

export function isServerOnlyEnv(
  name: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  return SERVER_ONLY.has(name) || SECRET_NAME.test(name) || extraDenied(env).has(name);
}

/** process.env minus server-only credentials, with the git hook guard on. */
export function agentProcessEnv(
  base: Record<string, string | undefined> = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || isServerOnlyEnv(name, base)) continue;
    env[name] = value;
  }
  return { ...env, ...hookGuardEnv(base) };
}
