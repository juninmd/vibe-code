#!/usr/bin/env node
/**
 * Runs `npx -y <package> [args]` from the OS temp dir.
 *
 * MCP servers start with the agent's worktree as cwd; npx would read that
 * repo's package.json, and conflicting `overrides` there (EOVERRIDE) make it
 * exit before the server starts.
 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const child = spawn("npx", ["-y", ...process.argv.slice(2)], {
  cwd: tmpdir(),
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
