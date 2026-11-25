import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NPX_NEUTRAL } from "./default-servers";

const GITHUB_PROXY = resolve(import.meta.dir, "../../scripts/github-mcp-proxy.mjs");

// A worktree whose package.json overrides make real npx fail with EOVERRIDE,
// and a fake npx that reports where it was started.
function setup() {
  const worktree = mkdtempSync(join(tmpdir(), "mcp-worktree-"));
  writeFileSync(join(worktree, "package.json"), '{"overrides":{"nanoid":"^3"}}');
  const bin = mkdtempSync(join(tmpdir(), "fake-npx-"));
  const npx = join(bin, "npx");
  writeFileSync(npx, '#!/bin/sh\necho "cwd=$(pwd) args=$*"\n');
  chmodSync(npx, 0o755);
  return { worktree, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

async function run(script: string, args: string[]) {
  const { worktree, env } = setup();
  const proc = Bun.spawn(["node", script, ...args], { cwd: worktree, env, stdin: "pipe" });
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return { out: out.trim(), worktree };
}

describe("MCP launchers", () => {
  it("start npx outside the agent's worktree, whose overrides would abort it", async () => {
    for (const [script, args] of [
      [NPX_NEUTRAL, ["@scope/pkg@1.0.0"]],
      [GITHUB_PROXY, []],
    ] as const) {
      const { out, worktree } = await run(script, [...args]);
      expect(out).toStartWith(`cwd=${realpathSync(tmpdir())}`);
      expect(out).not.toContain(worktree);
      expect(out).toContain("-y");
    }
  });
});
