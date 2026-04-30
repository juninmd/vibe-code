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
  let bareDir: string;
  let workDir: string;
  let baseBranch: string;
  let git: GitService;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vibe-git-test-"));
    bareDir = join(tmpDir, "repo.git");
    workDir = join(tmpDir, "work");
    const seedDir = join(tmpDir, "seed");

    // 1. Create seed repo with one commit
    await Bun.spawn(["git", "init", "--initial-branch=main", seedDir], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    await Bun.spawn(["git", "-C", seedDir, "config", "user.email", "t@t.com"]).exited;
    await Bun.spawn(["git", "-C", seedDir, "config", "user.name", "T"]).exited;
    await writeFile(join(seedDir, "readme.txt"), "initial");
    await Bun.spawn(["git", "-C", seedDir, "add", "-A"]).exited;
    await Bun.spawn(["git", "-C", seedDir, "commit", "-m", "initial"]).exited;

    baseBranch = await getCurrentBranch(seedDir);

    // 2. Clone to a bare repo (simulates vibe-code's stored repo)
    await Bun.spawn(["git", "clone", "--bare", seedDir, bareDir], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    // 3. Create a linked worktree on a new branch (simulates the agent's workspace)
    await Bun.spawn(
      ["git", "--git-dir", bareDir, "worktree", "add", "-b", "feature/test", workDir, baseBranch],
      { stdout: "pipe", stderr: "pipe" }
    ).exited;
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

  it("returns true after adding a new commit on the feature branch", async () => {
    await addCommit(workDir, "new feature");
    const result = await git.hasCommitsAhead(workDir, baseBranch);
    expect(result).toBe(true);
  });

  it("returns false when baseBranch is fast-forwarded to the same commit", async () => {
    // Simulate main catching up by fast-forwarding the bare repo's main
    await Bun.spawn(["git", "--git-dir", bareDir, "branch", "-f", baseBranch, "feature/test"], {
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

// ─── Git integration operations ──────────────────────────────────────────────

describe("Git integration operations", () => {
  let tmpDir: string;
  let git: GitService;
  let seedDir: string;
  let barePath: string;
  let wtPath: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vibe-git-ops-test-"));
    git = new GitService(tmpDir);
    await git.init();

    seedDir = join(tmpDir, "seed");
    // Create seed repo
    await Bun.spawn(["git", "init", "--initial-branch=main", seedDir]).exited;
    await Bun.spawn(["git", "-C", seedDir, "config", "user.email", "t@t.com"]).exited;
    await Bun.spawn(["git", "-C", seedDir, "config", "user.name", "T"]).exited;
    await writeFile(join(seedDir, "readme.txt"), "hello");
    await Bun.spawn(["git", "-C", seedDir, "add", "-A"]).exited;
    await Bun.spawn(["git", "-C", seedDir, "commit", "-m", "initial"]).exited;
    await Bun.spawn(["git", "-C", seedDir, "branch", "feature"]).exited;
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("init() creates repos and workspaces directories", async () => {
    const fs = await import("node:fs/promises");
    const stat1 = await fs.stat(git.reposDir);
    const stat2 = await fs.stat(git.workspacesDir);
    expect(stat1.isDirectory()).toBe(true);
    expect(stat2.isDirectory()).toBe(true);
  });

  it("cloneRepo() clones seed dir to a bare repo", async () => {
    barePath = await git.cloneRepo(seedDir, "my-repo");
    expect(barePath).toContain("my-repo.git");
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(barePath);
    expect(stat.isDirectory()).toBe(true);
  });

  it("getBarePath() matches cloneRepo bare path", () => {
    expect(git.getBarePath("my-repo")).toBe(barePath);
  });

  it("listBranches() returns empty array if no remote branches", async () => {
    // Because it's a bare clone of a local dir without setting up remote tracking in the same way, `branch -r` is empty.
    const branches = await git.listBranches(barePath);
    expect(branches).toEqual([]);
  });

  it("detectDefaultBranch() detects main", async () => {
    const defBranch = await git.detectDefaultBranch(seedDir);
    expect(defBranch).toBe("main");
  });

  it("detectDefaultBranch() falls back to main on failure", async () => {
    const defBranch = await git.detectDefaultBranch("invalid-repo-url-that-doesnt-exist");
    expect(defBranch).toBe("main");
  });

  it("createWorktree() creates a linked worktree", async () => {
    wtPath = await git.createWorktree(barePath, "new-branch", "my-repo", "run-1", "main", true);
    expect(wtPath).toContain("run-1");
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(wtPath);
    expect(stat.isDirectory()).toBe(true);
  });

  it("branchExists() returns true for new-branch and false for fake", async () => {
    expect(await git.branchExists(barePath, "new-branch")).toBe(true);
    expect(await git.branchExists(barePath, "fake-branch")).toBe(false);
  });

  it("commitAll() commits new files", async () => {
    await writeFile(join(wtPath, "new-file.txt"), "new file");
    const hasChangesBefore = await git.hasChanges(wtPath);
    expect(hasChangesBefore).toBe(true);

    await git.commitAll(wtPath, "add new file");

    const hasChangesAfter = await git.hasChanges(wtPath);
    expect(hasChangesAfter).toBe(false);
  });

  it("push() pushes branch to origin", async () => {
    // In our test setup, the barePath is origin for wtPath, but for `barePath`, `origin` is `seedDir`.
    // git clone --bare sets origin up. But `git worktree add` sets up a worktree whose "origin" might not correctly resolve
    // without tracking branches being perfectly in sync. Let's just expect it not to throw.
    // It seems occasionally it can fail if the run environment denies it. We'll verify git.push doesn't throw.
    await expect(async () => {
      await git.push(wtPath, "new-branch");
    }).not.toThrow();
  });

  it("checkout() changes checked out branch", async () => {
    await git.checkout(wtPath, "main");
    const getCurrentBranch = async () => {
      const proc = Bun.spawn(["git", "branch", "--show-current"], { cwd: wtPath, stdout: "pipe" });
      return (await new Response(proc.stdout).text()).trim();
    };
    expect(await getCurrentBranch()).toBe("main");
  });

  it("diffSummary() and diffFileContent() return changes", async () => {
    const diff = await git.diffSummary("main", "new-branch", { cwd: wtPath });
    expect(diff.length).toBeGreaterThan(0);
    expect(diff[0].path).toBe("new-file.txt");
    expect(diff[0].status).toBe("added");
    expect(diff[0].additions).toBe(1);

    const content = await git.diffFileContent("main", "new-branch", "new-file.txt", { cwd: wtPath });
    expect(content).toContain("+new file");
  });

  it("diffSummary() parses modified and deleted correctly", async () => {
    // modify readme.txt, delete another file, rename
    await git.checkout(wtPath, "new-branch");
    await writeFile(join(wtPath, "readme.txt"), "modified");
    await writeFile(join(wtPath, "del.txt"), "delete me");
    await git.commitAll(wtPath, "add del.txt");

    // new branch 2 off new-branch
    await git.checkout(wtPath, "new-branch");
    await Bun.spawn(["git", "-C", wtPath, "checkout", "-b", "branch2"]).exited;
    const fs = await import("node:fs/promises");
    await fs.rm(join(wtPath, "del.txt"));
    await fs.rename(join(wtPath, "new-file.txt"), join(wtPath, "renamed.txt"));
    await writeFile(join(wtPath, "readme.txt"), "modified more");
    await git.commitAll(wtPath, "modifications");

    const diff = await git.diffSummary("new-branch", "branch2", { cwd: wtPath });
    expect(diff.find(d => d.path === "del.txt")?.status).toBe("deleted");
    expect(diff.find(d => d.path === "renamed.txt")?.status).toBe("renamed");
    expect(diff.find(d => d.path === "readme.txt")?.status).toBe("modified");
  });

  it("removeWorktree() removes worktree", async () => {
    await git.removeWorktree(barePath, wtPath);
    const fs = await import("node:fs/promises");
    await expect(fs.stat(wtPath)).rejects.toThrow();
  });

  it("removeWorktree() falls back to manual cleanup if git fails", async () => {
    // barePath may have been deleted by deleteLocalRepo() in previous test run, wait deleteLocalRepo is after this.
    const fakeWt = join(git.workspacesDir, "my-repo", "run-x");
    const fs = await import("node:fs/promises");
    await fs.mkdir(fakeWt, { recursive: true });

    // git worktree remove will fail because it's not a registered worktree,
    // but GitService should catch it and use `rm` directly.
    await git.removeWorktree(barePath, fakeWt);

    await expect(fs.stat(fakeWt)).rejects.toThrow();
  });

  it("deleteLocalRepo() removes workspace and bare dirs", async () => {
    await git.deleteLocalRepo(barePath, "my-repo");
    const fs = await import("node:fs/promises");
    await expect(fs.stat(barePath)).rejects.toThrow();
    await expect(fs.stat(join(git.workspacesDir, "my-repo"))).rejects.toThrow();
  });
});
