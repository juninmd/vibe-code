import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitService } from "./git-service";

// ─── Pure utility tests (no filesystem) ──────────────────────────────────────

describe("GitService.getRepoOwnerAndName", () => {
  const git = new GitService();

  it("parses HTTPS GitHub URL", () => {
    expect(git.getRepoOwnerAndName("https://github.com/owner/repo")).toBe("owner/repo");
  });

  it("parses HTTPS URL with .git suffix", () => {
    expect(git.getRepoOwnerAndName("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  it("parses SSH URL", () => {
    expect(git.getRepoOwnerAndName("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  it("parses URL with nested org name", () => {
    expect(git.getRepoOwnerAndName("https://github.com/my-org/my-project.git")).toBe(
      "my-org/my-project"
    );
  });
});

// ─── hasCommitsAhead — integration tests with real git repo ──────────────────

async function initRepo(dir: string) {
  const g = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" }).exited;

  await g(["init", "--initial-branch=main"]);
  await g(["config", "user.email", "test@test.com"]);
  await g(["config", "user.name", "Test"]);
}

async function addCommit(dir: string, message = "commit") {
  const g = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" }).exited;
  // Create a file to ensure there's something to commit
  await writeFile(join(dir, `${Date.now()}.txt`), message);
  await g(["add", "-A"]);
  await g(["commit", "-m", message]);
}

async function getCurrentBranch(dir: string): Promise<string> {
  const proc = Bun.spawn(["git", "branch", "--show-current"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  return text.trim() || "main";
}

describe("GitService.hasCommitsAhead", () => {
  let tmpDir: string;
  let originDir: string;
  let workDir: string;
  let baseBranch: string;
  let git: GitService;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vibe-git-test-"));
    originDir = join(tmpDir, "origin.git"); // bare repo as origin
    workDir = join(tmpDir, "work");
    const seedDir = join(tmpDir, "seed");

    // 1. Seed repo: create initial commit
    await Bun.spawn(["git", "init", seedDir], { stdout: "pipe", stderr: "pipe" }).exited;
    await Bun.spawn(["git", "-C", seedDir, "config", "user.email", "t@t.com"]).exited;
    await Bun.spawn(["git", "-C", seedDir, "config", "user.name", "T"]).exited;
    await writeFile(join(seedDir, "readme.txt"), "initial");
    await Bun.spawn(["git", "-C", seedDir, "add", "-A"]).exited;
    await Bun.spawn(["git", "-C", seedDir, "commit", "-m", "initial"]).exited;

    baseBranch = await getCurrentBranch(seedDir);

    // 2. Clone seed to a bare repo (our "origin")
    await Bun.spawn(["git", "clone", "--bare", seedDir, originDir], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    // 3. Clone bare origin to workDir
    await Bun.spawn(["git", "clone", originDir, workDir], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    await Bun.spawn(["git", "-C", workDir, "config", "user.email", "t@t.com"]).exited;
    await Bun.spawn(["git", "-C", workDir, "config", "user.name", "T"]).exited;

    git = new GitService(tmpDir);
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns false when no new commits since base", async () => {
    const result = await git.hasCommitsAhead(workDir, baseBranch);
    expect(result).toBe(false);
  });

  it("returns true after adding a new local commit (not pushed)", async () => {
    await addCommit(workDir, "new feature");
    const result = await git.hasCommitsAhead(workDir, baseBranch);
    expect(result).toBe(true);
  });

  it("returns false after pushing the commit", async () => {
    await Bun.spawn(["git", "push"], {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    const result = await git.hasCommitsAhead(workDir, baseBranch);
    expect(result).toBe(false);
  });
});

// ─── hasChanges ──────────────────────────────────────────────────────────────

describe("GitService.hasChanges", () => {
  let tmpDir: string;
  let git: GitService;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vibe-changes-test-"));
    await initRepo(tmpDir);
    await addCommit(tmpDir, "initial");
    git = new GitService();
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns false on clean working tree", async () => {
    const result = await git.hasChanges(tmpDir);
    expect(result).toBe(false);
  });

  it("returns true after creating a new file", async () => {
    await writeFile(join(tmpDir, "new-file.txt"), "hello");
    const result = await git.hasChanges(tmpDir);
    expect(result).toBe(true);
  });
});
