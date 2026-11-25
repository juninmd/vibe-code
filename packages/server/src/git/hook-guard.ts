/**
 * Points git's hooks at `scripts/git-hooks`, whose pre-push blocks secrets
 * (gitleaks) and failing tests before anything leaves the session, then runs
 * the repository's own hooks. Uses GIT_CONFIG_PARAMETERS (the `git -c` channel),
 * which outranks the repo's core.hooksPath and leaves GIT_CONFIG_COUNT entries
 * (GitHub auth) alone. `VIBE_GIT_HOOK_GUARD=off` is the rollback switch.
 */
import { resolve } from "node:path";

export const HOOK_GUARD_DIR = resolve(import.meta.dir, "../../scripts/git-hooks");

type Env = Record<string, string | undefined>;

export function hookGuardEnv(base: Env = process.env): Record<string, string> {
  if (base.VIBE_GIT_HOOK_GUARD === "off") return {};
  const entry = `'core.hooksPath=${HOOK_GUARD_DIR.replaceAll("'", "'\\''")}'`;
  const existing = base.GIT_CONFIG_PARAMETERS?.trim();
  if (existing?.includes(entry)) return { GIT_CONFIG_PARAMETERS: existing };
  return { GIT_CONFIG_PARAMETERS: existing ? `${existing} ${entry}` : entry };
}
