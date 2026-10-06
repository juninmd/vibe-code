import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

/**
 * Board lanes <-> issue labels, end to end: the real server talks to a fake GitLab over HTTP
 * (the provider is the same code path that talks to gitlab.com, only the base URL differs).
 */

const FAKE_PORT = 4519;
// A real local repo whose path contains "gitlab", so the server treats it as a GitLab project
// (an http remote would have to speak the git protocol as well).
const REPO_PATH = join(dirname(E2E.fixtureRepo), "gitlab-team", "app");
const api = (path: string) => `${E2E.serverUrl}${path}`;

interface FakeIssue {
  iid: number;
  title: string;
  description: string;
  state: "opened" | "closed";
  labels: string[];
}

let fake: Server;
const issues = new Map<number, FakeIssue>();
const createdLabels: string[] = [];

function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

const toIssue = (issue: FakeIssue) => ({
  iid: issue.iid,
  title: issue.title,
  description: issue.description,
  state: issue.state,
  labels: issue.labels,
  assignee: null,
  assignees: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  web_url: `http://127.0.0.1:${FAKE_PORT}/team/app/-/issues/${issue.iid}`,
});

test.beforeAll(async ({ request }) => {
  mkdirSync(REPO_PATH, { recursive: true });
  const git = (args: string) => execSync(`git ${args}`, { cwd: REPO_PATH, stdio: "pipe" });
  git("init --initial-branch=main");
  git('config user.email "e2e@vibe-code.local"');
  git('config user.name "vibe-code e2e"');
  writeFileSync(join(REPO_PATH, "README.md"), "# gitlab-shaped fixture\n");
  git("add -A");
  git('commit -m "chore: seed"');

  fake = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${FAKE_PORT}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = url.pathname;
    if (/^\/api\/v4\/projects\/[^/]+\/issues$/.test(path) && req.method === "GET") {
      return send(200, [...issues.values()].map(toIssue));
    }
    const issueMatch = path.match(/^\/api\/v4\/projects\/[^/]+\/issues\/(\d+)$/);
    if (issueMatch && req.method === "PUT") {
      const issue = issues.get(Number(issueMatch[1]));
      if (!issue) return send(404, {});
      const body = await readBody(req);
      const remove = (body.remove_labels ?? "").split(",").filter(Boolean);
      const add = (body.add_labels ?? "").split(",").filter(Boolean);
      issue.labels = [...issue.labels.filter((label) => !remove.includes(label)), ...add];
      return send(200, toIssue(issue));
    }
    if (/^\/api\/v4\/projects\/[^/]+\/labels$/.test(path) && req.method === "POST") {
      const body = await readBody(req);
      createdLabels.push(body.name);
      return send(201, {});
    }
    return send(404, { message: "not found" });
  });
  await new Promise<void>((resolve) => fake.listen(FAKE_PORT, "127.0.0.1", resolve));

  const settings = await request.put(api("/api/settings"), {
    data: { gitlabToken: "glpat-e2e", gitlabBaseUrl: `http://127.0.0.1:${FAKE_PORT}` },
  });
  expect(settings.ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.put(api("/api/lanes"), { data: { enabled: false } });
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

async function tasksByIssue(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get(api("/api/tasks"));
  const tasks = (await res.json()).data as Array<{
    id: string;
    title: string;
    status: string;
    tags: string[];
    issueUrl: string | null;
  }>;
  const map = new Map<number, (typeof tasks)[number]>();
  for (const task of tasks) {
    const match = task.issueUrl?.match(/\/issues\/(\d+)$/);
    if (match) map.set(Number(match[1]), task);
  }
  return map;
}

test("lanes follow issue labels in both directions", async ({ page, request }) => {
  issues.set(1, { iid: 1, title: "Login redirect loops", description: "d1", state: "opened", labels: ["status::review"] });
  issues.set(2, { iid: 2, title: "Add dark mode", description: "d2", state: "opened", labels: [] });
  issues.set(3, { iid: 3, title: "Slow search", description: "d3", state: "opened", labels: ["bug", "status::in-progress"] });

  const created = await request.post(api("/api/repos"), { data: { url: REPO_PATH } });
  expect(created.status()).toBe(201);
  const repo = (await created.json()).data;

  // Link two issues the way the importer does, before the sync is on.
  const imported = await request.post(api("/api/tasks/bulk/from-issues"), {
    data: {
      repoId: repo.id,
      issues: [1, 2].map((n) => ({
        id: String(n),
        number: n,
        title: issues.get(n)?.title,
        body: issues.get(n)?.description,
        labels: issues.get(n)?.labels,
        url: `http://127.0.0.1:${FAKE_PORT}/team/app/-/issues/${n}`,
      })),
    },
  });
  expect(imported.status()).toBe(201);

  // Off by default: nothing was written to the issues.
  const initial = await (await request.get(api("/api/lanes"))).json();
  expect(initial.data.enabled).toBe(false);
  expect(issues.get(2)?.labels).toEqual([]);

  // ── On: the issue is the source of truth ──────────────────────────────────
  const on = await request.put(api("/api/lanes"), { data: { enabled: true } });
  expect(on.ok()).toBe(true);
  const synced = await request.post(api("/api/lanes/sync"));
  expect(synced.ok()).toBe(true);

  await expect
    .poll(async () => (await tasksByIssue(request)).get(1)?.status, { timeout: 15_000 })
    .toBe("review");
  // The unlabelled issue got its card's lane; the lane labels were created with colours.
  expect(issues.get(2)?.labels).toEqual(["status::todo"]);
  expect(createdLabels).toEqual([
    "status::todo",
    "status::in-progress",
    "status::blocked",
    "status::review",
    "status::done",
  ]);
  // The labelled open issue that had no card became one, and it will not auto-run.
  await expect.poll(async () => (await tasksByIssue(request)).get(3)?.status).toBe("in_progress");
  expect((await tasksByIssue(request)).get(3)?.tags).toEqual(["manual", "bug"]);

  // ── Drag a card: its issue is relabelled shortly after ────────────────────
  const dark = (await tasksByIssue(request)).get(2);
  expect(dark).toBeTruthy();
  const moved = await request.patch(api(`/api/tasks/${dark?.id}`), { data: { status: "done" } });
  expect(moved.ok()).toBe(true);
  await expect.poll(() => issues.get(2)?.labels, { timeout: 15_000 }).toEqual(["status::done"]);

  // ── Relabel an issue: its card moves ──────────────────────────────────────
  const issue = issues.get(1);
  if (issue) issue.labels = ["status::blocked"];
  await request.post(api("/api/lanes/sync"));
  await expect.poll(async () => (await tasksByIssue(request)).get(1)?.status).toBe("blocked");

  // ── The board shows it ────────────────────────────────────────────────────
  await page.goto("/");
  await expect(page.getByRole("button", { name: /labels synced/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slow search" })).toBeVisible();
  await expect(page.getByRole("link", { name: "#3" })).toBeVisible();

  // ── Delete a card: it stays gone and its issue leaves the lanes ───────────
  const gone = await request.delete(api(`/api/tasks/${dark?.id}`));
  expect(gone.ok()).toBe(true);
  await expect.poll(() => issues.get(2)?.labels).toEqual([]);
  await request.post(api("/api/lanes/sync"));
  expect((await tasksByIssue(request)).get(2)).toBeUndefined();
});
