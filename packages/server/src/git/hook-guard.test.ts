import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK_GUARD_DIR, hookGuardEnv } from "./hook-guard";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  const r = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
}

/** A clone with one new commit, a fake gitleaks that fails on "LEAK", and the guard env. */
function setup(files: Record<string, string> = {}, gitleaks = true) {
  const root = mkdtempSync(join(tmpdir(), "hook-guard-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  mkdirSync(bin);
  git(root, ["init", "-q", "--bare", "-b", "main", origin]);
  git(root, ["clone", "-q", origin, repo]);
  git(repo, ["config", "user.email", "t@local"]);
  git(repo, ["config", "user.name", "t"]);
  for (const [name, content] of Object.entries({ "a.txt": "ok\n", ...files }))
    writeFileSync(join(repo, name), content);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "work"]);
  if (gitleaks) {
    const fake = join(bin, "gitleaks");
    writeFileSync(
      fake,
      `#!/bin/sh\nfor a; do :; done\ncd "$a" && git log -p --all | grep -q LEAK && exit 1\nexit 0\n`
    );
    chmodSync(fake, 0o755);
  }
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    ...hookGuardEnv({}),
    VIBE_REQUIRE_GITLEAKS: undefined as string | undefined,
  };
  return { repo, origin, env };
}

const push = (repo: string, env: Record<string, string | undefined>) =>
  git(repo, ["push", "-q", "origin", "HEAD:main"], env);

describe("git hook guard", () => {
  it("routes git hooks through the guard via the `git -c` channel", () => {
    expect(hookGuardEnv({}).GIT_CONFIG_PARAMETERS).toBe(`'core.hooksPath=${HOOK_GUARD_DIR}'`);
    expect(hookGuardEnv({ GIT_CONFIG_PARAMETERS: "'a.b=c'" }).GIT_CONFIG_PARAMETERS).toBe(
      `'a.b=c' 'core.hooksPath=${HOOK_GUARD_DIR}'`
    );
    expect(hookGuardEnv({ VIBE_GIT_HOOK_GUARD: "off" })).toEqual({});
  });

  it("blocks a push whose commits carry a secret", () => {
    const { repo, origin, env } = setup({ "config.env": "TOKEN=LEAK\n" });
    const result = push(repo, env);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("gitleaks found secrets");
    expect(git(origin, ["rev-parse", "--verify", "-q", "main"]).code).not.toBe(0);
  });

  it("blocks a push when the repository's tests fail, and lets it through when they pass", () => {
    const failing = setup({ "package.json": '{"scripts":{"test":"exit 3"}}' });
    const blocked = push(failing.repo, failing.env);
    expect(blocked.code).not.toBe(0);
    expect(blocked.out).toContain("tests failed (npm test)");

    const passing = setup({ "package.json": '{"scripts":{"test":"exit 0"}}' });
    expect(push(passing.repo, passing.env).code).toBe(0);
  });

  it("still runs the repository's own pre-push hook", () => {
    const { repo, env } = setup();
    const hook = join(repo, ".git", "hooks", "pre-push");
    writeFileSync(hook, `#!/bin/sh\ncat > "${repo}/stdin-seen"\nexit 7\n`);
    chmodSync(hook, 0o755);
    expect(push(repo, env).code).not.toBe(0);
    expect(readFileSync(join(repo, "stdin-seen"), "utf8")).toContain("refs/heads/main");
  });

  it("fails closed without gitleaks only where the image requires it", () => {
    const relaxed = setup({}, false);
    expect(push(relaxed.repo, relaxed.env).code).toBe(0);
    const strict = setup({}, false);
    const result = push(strict.repo, { ...strict.env, VIBE_REQUIRE_GITLEAKS: "1" });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("gitleaks is not installed; push blocked");
  });
});
