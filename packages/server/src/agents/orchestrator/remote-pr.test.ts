import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../../db";
import { GitService } from "../../git/git-service";
import { BroadcastHub } from "../../ws/broadcast";
import { ensureGitignoreEntry } from "./executor";
import { publishRemoteSession, RemotePullRequestError, remoteSessionTitle } from "./remote-pr";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function sh(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vibe-remote-pr-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const workspace = join(root, "workspace");
  sh(root, "init", "-q", "--bare", "-b", "main", origin);
  sh(root, "clone", "-q", origin, workspace);
  sh(workspace, "config", "user.email", "t@local");
  sh(workspace, "config", "user.name", "t");
  await writeFile(join(workspace, "README.md"), "hello\n");
  sh(workspace, "add", "-A");
  sh(workspace, "commit", "-qm", "init");
  sh(workspace, "push", "-q", "origin", "HEAD:main");
  sh(workspace, "checkout", "-q", "-b", "vibe-code/abc/session");

  const db = createDb(":memory:");
  const owner = db.workspaces.create({ name: "Remote", slug: "remote" });
  const repo = db.repos.create({ url: "https://github.com/acme/app.git", workspaceId: owner.id });
  db.repos.updateStatus(repo.id, "ready", origin);
  const task = db.tasks.create({
    title: "host-add-dark-mode",
    description: "Add a dark mode toggle\n\nUse CSS variables.",
    repoId: repo.id,
    engine: "opencode",
    model: "opencode-go/glm-5.3#high",
    baseBranch: "main",
    tags: ["remote-session"],
  });
  db.tasks.updateField(task.id, "branch_name", "vibe-code/abc/session");
  const run = db.runs.create(task.id, "opencode");
  db.runs.updateStatus(run.id, "completed", { worktree_path: workspace });

  const git = new GitService(root);
  const createPR = mock(async () => "https://github.com/acme/app/pull/7");
  const deps = {
    db,
    git: {
      commitAll: git.commitAll.bind(git),
      hasCommitsAhead: git.hasCommitsAhead.bind(git),
      push: git.push.bind(git),
      publishEvidence: git.publishEvidence.bind(git),
      createPR,
    },
    hub: new BroadcastHub(db),
    isRunning: () => false,
  };
  return { db, task, workspace, origin, deps, createPR };
}

describe("remoteSessionTitle", () => {
  it("uses the first meaningful line of the prompt", () => {
    expect(remoteSessionTitle({ title: "x", description: "\n## Fix login\nmore" })).toBe(
      "Fix login"
    );
    expect(remoteSessionTitle({ title: "fallback", description: "" })).toBe("fallback");
    expect(remoteSessionTitle({ title: "x", description: "a".repeat(100) })).toHaveLength(72);
  });
});

describe("publishRemoteSession", () => {
  it("commits the session work, pushes the branch and opens the PR once", async () => {
    const { db, task, workspace, origin, deps, createPR } = await setup();
    await writeFile(join(workspace, "theme.css"), ":root { --bg: #000; }\n");

    const first = await publishRemoteSession(task.id, {}, deps);
    expect(first).toEqual({
      prUrl: "https://github.com/acme/app/pull/7",
      branch: "vibe-code/abc/session",
      created: true,
    });
    expect(sh(origin, "log", "-1", "--format=%s", "vibe-code/abc/session")).toBe(
      "Add a dark mode toggle"
    );
    const [, , branch, title, body, base] = createPR.mock.calls[0] as unknown as string[];
    expect([branch, title, base]).toEqual([
      "vibe-code/abc/session",
      "Add a dark mode toggle",
      "main",
    ]);
    expect(body).toContain("opencode · opencode-go/glm-5.3");
    // Reviewers are told when a session left no proof behind.
    expect(body).toContain("_No evidence captured in this session._");
    expect(db.tasks.getById(task.id)?.prUrl).toBe("https://github.com/acme/app/pull/7");

    // A later turn adds more work: the same PR is updated, not duplicated.
    await writeFile(join(workspace, "toggle.ts"), "export const dark = true;\n");
    const second = await publishRemoteSession(task.id, { title: "Wire the toggle" }, deps);
    expect(second.created).toBe(false);
    expect(createPR).toHaveBeenCalledTimes(1);
    expect(sh(origin, "log", "-1", "--format=%s", "vibe-code/abc/session")).toBe("Wire the toggle");

    // Without an explicit title, the update commit names the latest request.
    const run = db.runs.listByTask(task.id)[0];
    db.logs.create(run.id, "stdin", "Add a keyboard shortcut");
    await writeFile(join(workspace, "shortcut.ts"), "export const key = 'd';\n");
    await publishRemoteSession(task.id, {}, deps);
    expect(sh(origin, "log", "-1", "--format=%s", "vibe-code/abc/session")).toBe(
      "Add a keyboard shortcut"
    );
  });

  it("puts the agent's evidence in the PR body and keeps screenshots out of the diff", async () => {
    const { task, workspace, origin, deps, createPR } = await setup();
    await writeFile(join(workspace, "theme.css"), ":root { --bg: #000; }\n");
    const evidence = join(workspace, ".vibe-code", "evidence");
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "EVIDENCE.md"), "# Evidence\n\n`bun test` → 3 pass, 0 fail\n");
    await writeFile(join(evidence, "home.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await publishRemoteSession(task.id, {}, deps);

    const body = (createPR.mock.calls[0] as unknown as string[])[4];
    const sha = sh(origin, "rev-parse", "refs/vibe-code/evidence/vibe-code/abc/session");
    expect(body).toContain("## Evidence\n\n`bun test` → 3 pass, 0 fail");
    expect(body).toContain(
      `![home.png](https://github.com/acme/app/blob/${sha}/home.png?raw=true)`
    );
    expect(sh(origin, "ls-tree", "--name-only", sha)).toBe("home.png");
    // The PR branch itself never carries the screenshots.
    expect(sh(origin, "ls-tree", "-r", "--name-only", "vibe-code/abc/session")).not.toContain(
      "home.png"
    );
  });

  it("refuses when there is nothing to publish", async () => {
    const { task, deps } = await setup();
    await expect(publishRemoteSession(task.id, {}, deps)).rejects.toMatchObject({
      code: "nothing_to_publish",
    });
  });

  it("refuses while a turn is running", async () => {
    const { task, deps } = await setup();
    const error = await publishRemoteSession(task.id, {}, { ...deps, isRunning: () => true }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(RemotePullRequestError);
    expect(error.code).toBe("invalid_state");
  });
});

describe("ensureGitignoreEntry", () => {
  it("hides session files from status in a linked worktree, where .git is a file", async () => {
    const { workspace } = await setup();
    const root = join(workspace, "..");
    const linked = join(root, "linked");
    sh(workspace, "worktree", "add", "-q", linked);
    await mkdir(join(linked, ".vibe-code", "evidence"), { recursive: true });
    await writeFile(join(linked, ".vibe-code", "evidence", "shot.png"), "x");
    expect(sh(linked, "status", "--porcelain")).toContain(".vibe-code/");
    await ensureGitignoreEntry(linked, ".vibe-code/");
    await ensureGitignoreEntry(linked, ".vibe-code/");
    expect(sh(linked, "status", "--porcelain")).toBe("");
  });
});
