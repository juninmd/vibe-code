import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export class GitService {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? join(homedir(), ".vibe-code");
  }

  get reposDir(): string {
    return join(this.basePath, "repos");
  }

  get workspacesDir(): string {
    return join(this.basePath, "workspaces");
  }

  async init(): Promise<void> {
    await mkdir(this.reposDir, { recursive: true });
    await mkdir(this.workspacesDir, { recursive: true });
  }

  async detectDefaultBranch(url: string): Promise<string> {
    try {
      const result = await this.exec(["git", "ls-remote", "--symref", url, "HEAD"]);
      // Output like: ref: refs/heads/main	HEAD
      const match = result.stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
      if (match) return match[1];
    } catch {
      // Fallback
    }
    return "main";
  }

  async cloneRepo(url: string, name: string): Promise<string> {
    const barePath = join(this.reposDir, `${name}.git`);
    await this.exec(["git", "clone", "--bare", url, barePath]);
    return barePath;
  }

  async fetchRepo(barePath: string): Promise<void> {
    await this.exec(["git", "--git-dir", barePath, "fetch", "origin", "--prune"]);
  }

  async createWorktree(
    barePath: string,
    branch: string,
    repoName: string,
    runId: string,
    base: string = "main",
    isNewBranch: boolean = true
  ): Promise<string> {
    const wtPath = join(this.workspacesDir, repoName, runId);
    await mkdir(join(this.workspacesDir, repoName), { recursive: true });

    // Fetch latest
    await this.fetchRepo(barePath);

    // Create worktree
    const args = ["git", "--git-dir", barePath, "worktree", "add"];
    if (isNewBranch) {
      args.push("-b", branch, wtPath, base);
    } else {
      args.push(wtPath, branch);
    }

    await this.exec(args);

    // Ensure git identity is set in the worktree so commits never fail.
    // Only set locally if not already configured globally.
    try {
      await this.exec(["git", "config", "user.email"], { cwd: wtPath });
    } catch {
      await this.exec(["git", "config", "--local", "user.email", "vibe-code@localhost"], { cwd: wtPath });
      await this.exec(["git", "config", "--local", "user.name", "vibe-code"], { cwd: wtPath });
    }

    return wtPath;
  }

  async removeWorktree(barePath: string, wtPath: string): Promise<void> {
    try {
      await this.exec(["git", "--git-dir", barePath, "worktree", "remove", "--force", wtPath]);
    } catch {
      // If worktree remove fails, try manual cleanup
      try {
        const { rm } = await import("node:fs/promises");
        await rm(wtPath, { recursive: true, force: true });
        await this.exec(["git", "--git-dir", barePath, "worktree", "prune"]);
      } catch {
        // Best effort cleanup
      }
    }
  }

  async hasChanges(wtPath: string): Promise<boolean> {
    const result = await this.exec(["git", "status", "--porcelain"], { cwd: wtPath });
    return result.stdout.trim().length > 0;
  }

  async hasCommitsAhead(wtPath: string, baseBranch: string): Promise<boolean> {
    try {
      // Bare-cloned repos don't have origin/<branch> tracking refs, only local branch refs.
      const result = await this.exec(["git", "log", `${baseBranch}..HEAD`, "--oneline"], {
        cwd: wtPath,
      });
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async commitAll(wtPath: string, message: string): Promise<void> {
    await this.exec(["git", "add", "-A"], { cwd: wtPath });
    const hasChanges = await this.hasChanges(wtPath);
    if (hasChanges) {
      // Ensure git identity is set (required in some environments)
      try {
        await this.exec(["git", "config", "user.email"], { cwd: wtPath });
      } catch {
        await this.exec(["git", "config", "user.email", "vibe-code@localhost"], { cwd: wtPath });
        await this.exec(["git", "config", "user.name", "vibe-code"], { cwd: wtPath });
      }
      await this.exec(["git", "commit", "-m", message], { cwd: wtPath });
    }
  }

  async push(wtPath: string, branch: string): Promise<void> {
    await this.exec(["git", "push", "-u", "origin", branch], { cwd: wtPath });
  }

  async checkout(wtPath: string, branch: string): Promise<void> {
    await this.exec(["git", "checkout", branch], { cwd: wtPath });
  }

  async createPR(
    wtPath: string,
    repoUrl: string,
    branch: string,
    title: string,
    body: string
  ): Promise<string> {
    const repoInfo = this.getRepoOwnerAndName(repoUrl);
    const result = await this.exec(
      [
        "gh",
        "pr",
        "create",
        "--repo",
        repoInfo,
        "--title",
        title,
        "--body",
        body,
        "--head",
        branch,
      ],
      { cwd: wtPath }
    );
    return result.stdout.trim();
  }

  getRepoOwnerAndName(url: string): string {
    // Matches https://github.com/owner/repo[.git] or git@github.com:owner/repo[.git]
    const match = url.match(/[:/]([^/:]+\/[^/.]+)(?:\.git)?$/);
    return match ? match[1] : url;
  }

  async listGitHubRepos(
    limit = 200
  ): Promise<{ name: string; url: string; description: string; isPrivate: boolean }[]> {
    try {
      const result = await this.exec([
        "gh",
        "repo",
        "list",
        "--limit",
        String(limit),
        "--json",
        "nameWithOwner,url,description,isPrivate",
      ]);
      const repos = JSON.parse(result.stdout) as {
        nameWithOwner: string;
        url: string;
        description: string | null;
        isPrivate: boolean;
      }[];
      return repos.map((r) => ({
        name: r.nameWithOwner,
        url: r.url,
        description: r.description ?? "",
        isPrivate: r.isPrivate,
      }));
    } catch (err: any) {
      console.error("[git] Failed to list GitHub repos:", err.message);
      return [];
    }
  }

  async diffSummary(
    baseBranch: string,
    headBranch: string,
    opts: { cwd?: string; gitDir?: string }
  ): Promise<
    { path: string; status: string; additions: number; deletions: number; oldPath?: string }[]
  > {
    const args = ["git"];
    if (opts.gitDir) args.push("--git-dir", opts.gitDir);
    args.push("diff", "--numstat", "-M", `${baseBranch}...${headBranch}`);

    const numstat = await this.exec(args, { cwd: opts.cwd }).catch(() => ({
      stdout: "",
      stderr: "",
      exitCode: 1,
    }));

    // Also get name-status for file status (A/M/D/R)
    const statusArgs = ["git"];
    if (opts.gitDir) statusArgs.push("--git-dir", opts.gitDir);
    statusArgs.push("diff", "--name-status", "-M", `${baseBranch}...${headBranch}`);

    const nameStatus = await this.exec(statusArgs, { cwd: opts.cwd }).catch(() => ({
      stdout: "",
      stderr: "",
      exitCode: 1,
    }));

    const statusMap = new Map<string, { status: string; oldPath?: string }>();
    for (const line of nameStatus.stdout.trim().split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      const code = parts[0].charAt(0);
      const status =
        code === "A" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified";
      const filePath = code === "R" ? parts[2] : parts[1];
      const oldPath = code === "R" ? parts[1] : undefined;
      if (filePath) statusMap.set(filePath, { status, oldPath });
    }

    const files: {
      path: string;
      status: string;
      additions: number;
      deletions: number;
      oldPath?: string;
    }[] = [];
    for (const line of numstat.stdout.trim().split("\n")) {
      if (!line) continue;
      const [add, del, ...pathParts] = line.split("\t");
      const filePath = pathParts
        .join("\t")
        .replace(/^.* => /, "")
        .replace(/[{}]/g, "");
      const info = statusMap.get(filePath);
      files.push({
        path: filePath,
        status: info?.status ?? "modified",
        additions: add === "-" ? 0 : parseInt(add, 10) || 0,
        deletions: del === "-" ? 0 : parseInt(del, 10) || 0,
        oldPath: info?.oldPath,
      });
    }

    return files;
  }

  async diffFileContent(
    baseBranch: string,
    headBranch: string,
    filePath: string,
    opts: { cwd?: string; gitDir?: string }
  ): Promise<string> {
    const args = ["git"];
    if (opts.gitDir) args.push("--git-dir", opts.gitDir);
    args.push("diff", "-M", `${baseBranch}...${headBranch}`, "--", filePath);

    const result = await this.exec(args, { cwd: opts.cwd });
    return result.stdout;
  }

  async branchExists(barePath: string, branch: string): Promise<boolean> {
    try {
      await this.exec(["git", "--git-dir", barePath, "rev-parse", "--verify", branch]);
      return true;
    } catch {
      return false;
    }
  }

  getBarePath(repoName: string): string {
    return join(this.reposDir, `${repoName}.git`);
  }

  private async exec(
    cmd: string[],
    options?: { cwd?: string }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(cmd, {
      cwd: options?.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(" ")}\n${stderr}`);
    }

    return { stdout, stderr, exitCode };
  }
}
