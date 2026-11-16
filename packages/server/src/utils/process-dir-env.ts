/**
 * Env that makes a child process see `dir` as its working directory.
 *
 * Bun.spawn sets the real cwd but inherits the parent's `$PWD`. OpenCode resolves
 * its project (AGENTS.md, opencode.json, .opencode/skills) from `$PWD`, so a stale
 * value points it at the server's own directory.
 */
export function processDirEnv(dir: string): Record<string, string> {
  return Object.fromEntries([["PWD", dir]]);
}
