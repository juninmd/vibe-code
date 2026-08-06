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

  seedSessionStores(join(root, "sessions"));

  process.env.VIBE_E2E_ROOT = root;
  return root;
}

/**
 * Writes a deterministic session store for each coding CLI so the session
 * board has one card per column without depending on what the machine running
 * the suite happens to have in its home directory.
 */
function seedSessionStores(dir: string): void {
  const now = Date.now();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const write = (file: string, content: string) => {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
  };
  const json = (file: string, value: unknown) => write(file, JSON.stringify(value));
  const jsonl = (file: string, records: unknown[]) =>
    write(file, records.map((r) => JSON.stringify(r)).join("\n"));

  // OpenCode — one recently touched session (active) with two messages.
  const storage = join(dir, "opencode", "storage");
  json(join(storage, "session", "ses_e2e_active.json"), {
    id: "ses_e2e_active",
    title: "E2E opencode active session",
    directory: "/tmp/e2e-projects/storefront",
    time: { created: now - 2 * HOUR, updated: now - MIN },
  });
  json(join(storage, "message", "ses_e2e_active", "msg_1.json"), { id: "msg_1" });
  json(join(storage, "message", "ses_e2e_active", "msg_2.json"), { id: "msg_2" });
  // Sub-agent session — must never surface as a card.
  json(join(storage, "session", "ses_e2e_child.json"), {
    id: "ses_e2e_child",
    parentID: "ses_e2e_active",
    title: "E2E opencode subagent",
    time: { created: now - 2 * HOUR, updated: now - MIN },
  });

  // Claude Code — an idle transcript and one whose last turn is an API error.
  jsonl(join(dir, "claude", "projects", "-tmp-e2e-projects-api", "e2e-idle.jsonl"), [
    { type: "summary", summary: "E2E claude idle session" },
    {
      type: "user",
      sessionId: "e2e-idle",
      cwd: "/tmp/e2e-projects/api",
      gitBranch: "main",
      timestamp: new Date(now - 4 * HOUR).toISOString(),
      message: { role: "user", content: "start" },
    },
  ]);
  jsonl(join(dir, "claude", "projects", "-tmp-e2e-projects-infra", "e2e-failed.jsonl"), [
    {
      type: "user",
      sessionId: "e2e-failed",
      cwd: "/tmp/e2e-projects/infra",
      timestamp: new Date(now - 3 * HOUR).toISOString(),
      message: { role: "user", content: "plan the upgrade" },
    },
    {
      type: "assistant",
      sessionId: "e2e-failed",
      isApiErrorMessage: true,
      timestamp: new Date(now - 3 * HOUR + MIN).toISOString(),
      message: { role: "assistant", content: "API Error: overloaded" },
    },
  ]);

  // Antigravity — a session the CLI itself marked as finished.
  json(join(dir, "antigravity", "sessions", "e2e-done.json"), {
    session_id: "e2e-done",
    name: "E2E antigravity done session",
    workspacePath: "/tmp/e2e-projects/mobile",
    created_at: new Date(now - 6 * HOUR).toISOString(),
    last_active_at: new Date(now - 5 * HOUR).toISOString(),
    state: "completed",
    messageCount: 3,
  });
}

const E2E_ROOT = prepareEnvironment();
const DATA_DIR = join(E2E_ROOT, "data");
const FIXTURE_REPO = join(E2E_ROOT, "fixture-repo");
const SESSIONS_DIR = join(E2E_ROOT, "sessions");

export const E2E = {
  serverUrl: `http://localhost:${SERVER_PORT}`,
  webUrl: `http://localhost:${WEB_PORT}`,
  fixtureRepo: FIXTURE_REPO,
  sessionsDir: SESSIONS_DIR,
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
    // Escape hatch for sandboxed CI images that ship a browser Playwright did
    // not install itself (`playwright install` is unavailable there).
    launchOptions: process.env.VIBE_E2E_CHROMIUM
      ? { executablePath: process.env.VIBE_E2E_CHROMIUM }
      : {},
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
        // Point the session readers at the seeded stores instead of $HOME.
        VIBE_OPENCODE_SESSIONS_DIR: join(SESSIONS_DIR, "opencode"),
        VIBE_CLAUDE_SESSIONS_DIR: join(SESSIONS_DIR, "claude", "projects"),
        VIBE_ANTIGRAVITY_SESSIONS_DIR: join(SESSIONS_DIR, "antigravity", "sessions"),
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
