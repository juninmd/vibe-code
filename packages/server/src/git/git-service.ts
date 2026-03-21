import { join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";

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
    defaultBranch: string = "main"
  ): Promise<string> {
    const wtPath = join(this.workspacesDir, repoName, runId);
    await mkdir(join(this.workspacesDir, repoName), { recursive: true });

    // Fetch latest
    await this.fetchRepo(barePath);

    // Create worktree with new branch from default branch
    await this.exec([
      "git", "--git-dir", barePath,
      "worktree", "add", "-b", branch, wtPath, `origin/${defaultBranch}`,
    ]);

    return wtPath;
  }

  async removeWorktree(barePath: string, wtPath: string): Promise<void> {
    try {
      await this.exec(["git", "--git-dir", barePath, "worktree", "remove", "--force", wtPath]);
    } catch {
      // If worktree remove fails, try manual cleanup
      try {
        const { rm } = await import("fs/promises");
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

  async commitAll(wtPath: string, message: string): Promise<void> {
    await this.exec(["git", "add", "-A"], { cwd: wtPath });
    const hasChanges = await this.hasChanges(wtPath);
    if (hasChanges) {
      await this.exec(["git", "commit", "-m", message], { cwd: wtPath });
    }
  }

  async push(wtPath: string, branch: string): Promise<void> {
    await this.exec(["git", "push", "origin", branch], { cwd: wtPath });
  }

  async createPR(wtPath: string, title: string, body: string): Promise<string> {
    const result = await this.exec(
      ["gh", "pr", "create", "--title", title, "--body", body],
      { cwd: wtPath }
    );
    return result.stdout.trim();
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
