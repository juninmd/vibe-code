import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RemoteSkillSource {
  name: string;
  url: string;
  type: "github" | "git" | "url";
}

export class SkillRegistryService {
  private registryDir: string;

  constructor(basePath = "~/.agents") {
    const resolvedBase = basePath.startsWith("~/") ? join(homedir(), basePath.slice(2)) : basePath;
    this.registryDir = join(resolvedBase, "registry");
  }

  async init(): Promise<void> {
    await mkdir(this.registryDir, { recursive: true });
  }

  /**
   * Install a skill from a GitHub repository.
   * Format: username/repo/path/to/skill
   */
  async installFromGitHub(repoPath: string): Promise<{ name: string; path: string }> {
    const [user, repo, ...rest] = repoPath.split("/");
    const skillName = rest[rest.length - 1] || repo;
    const branch = "main"; // Default branch
    const subPath = rest.join("/");

    // Construct Raw GitHub URL
    const baseUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}`;
    const skillUrl = subPath ? `${baseUrl}/${subPath}/SKILL.md` : `${baseUrl}/SKILL.md`;

    const response = await fetch(skillUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch skill from GitHub: ${response.statusText}`);
    }

    const content = await response.text();
    const targetDir = join(this.registryDir, skillName);
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), content);

    return { name: skillName, path: targetDir };
  }

  async listInstalled(): Promise<string[]> {
    try {
      const entries = await readdir(this.registryDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async uninstall(name: string): Promise<void> {
    const targetDir = join(this.registryDir, name);
    await rm(targetDir, { recursive: true, force: true });
  }
}
