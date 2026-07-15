import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * E2E harness: boots the real server (isolated temp data dir, auth disabled)
 * plus the Vite dev server, and runs API smoke + browser flows against them.
 *
 * Run: bunx playwright test
 */

const SERVER_PORT = 3123;
const WEB_PORT = 5199;

// This module is evaluated by the runner AND re-imported by worker processes
// and spec files. Only the first evaluation (the runner) prepares the isolated
// environment; workers inherit VIBE_E2E_ROOT via env and skip it.
function prepareEnvironment(): string {
  if (process.env.VIBE_E2E_ROOT) return process.env.VIBE_E2E_ROOT;

  let root = join(tmpdir(), "vibe-code-e2e");
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // A previous run may still hold locks on Windows — fall back to a fresh dir.
    root = join(tmpdir(), `vibe-code-e2e-${Date.now()}`);
  }
  const fixtureRepo = join(root, "fixture-repo");
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(fixtureRepo, { recursive: true });

  const git = (args: string) =>
    execSync(`git ${args}`, { cwd: fixtureRepo, stdio: "pipe", env: process.env });
  git("init --initial-branch=main");
  git('config user.email "e2e@vibe-code.local"');
  git('config user.name "vibe-code e2e"');
  writeFileSync(join(fixtureRepo, "README.md"), "# e2e fixture repo\n");
  git("add -A");
  git('commit -m "chore: seed fixture repo"');

  process.env.VIBE_E2E_ROOT = root;
  return root;
}

const E2E_ROOT = prepareEnvironment();
const DATA_DIR = join(E2E_ROOT, "data");
const FIXTURE_REPO = join(E2E_ROOT, "fixture-repo");

export const E2E = {
  serverUrl: `http://localhost:${SERVER_PORT}`,
  webUrl: `http://localhost:${WEB_PORT}`,
  fixtureRepo: FIXTURE_REPO,
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: E2E.webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "bun run packages/server/src/index.ts",
      url: `${E2E.serverUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        VIBE_CODE_DATA_DIR: DATA_DIR,
        // Empty strings keep dotenv from re-enabling auth from the root .env.
        GITHUB_OAUTH_CLIENT_ID: "",
        GITHUB_OAUTH_CLIENT_SECRET: "",
        VIBE_CODE_API_KEY: "",
        VIBE_CODE_MAX_AGENTS: "2",
      },
    },
    {
      command: `bunx vite --port ${WEB_PORT} --strictPort`,
      cwd: "./packages/web",
      url: E2E.webUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        VITE_SERVER_URL: E2E.serverUrl,
      },
    },
  ],
});
