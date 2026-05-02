import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import type {
  HygieneReport,
  InstallRegistryAssetRequest,
  RegistryAssetRecord,
  SkillCategory,
} from "@vibe-code/shared";
import type { Db } from "../db";

export interface RemoteSkillSource {
  name: string;
  url: string;
  type: "github" | "git" | "url";
}

const CATEGORY_DIRS: Record<SkillCategory, string> = {
  skill: "skills",
  rule: "rules",
  agent: "agents",
  workflow: "workflows",
};

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("---", 3);
  if (end === -1) return {};
  return Object.fromEntries(
    content
      .slice(3, end)
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator === -1) return ["", ""];
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        ];
      })
      .filter(([key]) => key)
  );
}

export class SkillRegistryService {
  private activeDir: string;
  private pendingDir: string;
  private manifestPath: string;

  constructor(basePath = "~/.agents") {
    const resolvedBase = basePath.startsWith("~/") ? join(homedir(), basePath.slice(2)) : basePath;
    this.activeDir = join(resolvedBase, "registry");
    this.pendingDir = join(resolvedBase, "registry-pending");
    this.manifestPath = join(resolvedBase, "registry-manifest.json");
  }

  async init(): Promise<void> {
    await Promise.all([
      ...Object.values(CATEGORY_DIRS).map((dir) =>
        mkdir(join(this.activeDir, dir), { recursive: true })
      ),
      ...Object.values(CATEGORY_DIRS).map((dir) =>
        mkdir(join(this.pendingDir, dir), { recursive: true })
      ),
    ]);
  }

  private async readManifest(): Promise<RegistryAssetRecord[]> {
    try {
      const raw = await readFile(this.manifestPath, "utf8");
      return JSON.parse(raw) as RegistryAssetRecord[];
    } catch {
      return [];
    }
  }

  private async writeManifest(entries: RegistryAssetRecord[]): Promise<void> {
    await writeFile(this.manifestPath, JSON.stringify(entries, null, 2), "utf8");
  }

  private inferTarget(repoPath: string, ref: string, assetPath?: string, content?: string) {
    const [owner, repo, ...rest] = repoPath.split("/");
    const providedPath = assetPath ?? rest.join("/");
    let category: SkillCategory = "skill";
    let remotePath = providedPath || "SKILL.md";

    if (remotePath.endsWith(".instructions.md")) category = "rule";
    else if (remotePath.endsWith(".agent.md")) category = "agent";
    else if (remotePath.endsWith(".prompt.md")) category = "workflow";
    else if (!remotePath.endsWith("SKILL.md"))
      remotePath = remotePath ? `${remotePath}/SKILL.md` : "SKILL.md";

    const meta = content ? parseFrontmatter(content) : {};
    const fallbackName =
      basename(remotePath).replace(/\.(instructions|agent|prompt)?\.md$/i, "") || repo;
    const name = meta.name || fallbackName.replace(/SKILL$/i, repo);
    const categoryDir = CATEGORY_DIRS[category];
    const localFilePath =
      category === "skill"
        ? join(categoryDir, name, "SKILL.md")
        : join(categoryDir, basename(remotePath));

    return {
      owner,
      repo,
      ref,
      category,
      name,
      remotePath,
      localFilePath,
      sourceUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${remotePath}`,
      meta,
    };
  }

  private resolveStoragePath(
    reviewStatus: RegistryAssetRecord["reviewStatus"],
    relativePath: string
  ): string {
    return join(reviewStatus === "active" ? this.activeDir : this.pendingDir, relativePath);
  }

  /**
   * Install a skill from a GitHub repository.
   * Format: username/repo/path/to/skill
   */
  async installFromGitHub(
    request: string | InstallRegistryAssetRequest
  ): Promise<RegistryAssetRecord> {
    const normalizedRequest =
      typeof request === "string"
        ? ({ repoPath: request, ref: "main" } satisfies InstallRegistryAssetRequest)
        : { ...request, ref: request.ref ?? "main" };

    const initialTarget = this.inferTarget(
      normalizedRequest.repoPath,
      normalizedRequest.ref ?? "main",
      normalizedRequest.assetPath
    );
    const response = await fetch(initialTarget.sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch asset from GitHub: ${response.statusText}`);
    }

    const content = await response.text();
    const target = this.inferTarget(
      normalizedRequest.repoPath,
      normalizedRequest.ref ?? "main",
      normalizedRequest.assetPath,
      content
    );
    const filePath = this.resolveStoragePath("pending_review", target.localFilePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");

    const checksum = createHash("sha256").update(content).digest("hex");
    const record: RegistryAssetRecord = {
      id: `${target.category}:${target.name}`,
      name: target.name,
      category: target.category,
      filePath,
      sourceRepo: normalizedRequest.repoPath,
      sourceRef: normalizedRequest.ref ?? "main",
      sourceUrl: target.sourceUrl,
      reviewStatus: "pending_review",
      installedAt: new Date().toISOString(),
      reviewedAt: null,
      version: target.meta.version,
      compatibility: target.meta.compatibility ?? null,
      checksum,
    };

    const manifest = await this.readManifest();
    await this.writeManifest([...manifest.filter((entry) => entry.id !== record.id), record]);
    return record;
  }

  async listInstalled(): Promise<RegistryAssetRecord[]> {
    return this.readManifest();
  }

  async approve(id: string): Promise<RegistryAssetRecord> {
    const manifest = await this.readManifest();
    const record = manifest.find((entry) => entry.id === id);
    if (!record) throw new Error("Registry asset not found");
    if (record.reviewStatus === "active") return record;

    const relativePath = record.filePath.replace(`${this.pendingDir}${sep}`, "");
    const activePath = this.resolveStoragePath("active", relativePath);
    await mkdir(dirname(activePath), { recursive: true });
    await rename(record.filePath, activePath);

    const updated: RegistryAssetRecord = {
      ...record,
      filePath: activePath,
      reviewStatus: "active",
      reviewedAt: new Date().toISOString(),
    };

    await this.writeManifest(manifest.map((entry) => (entry.id === id ? updated : entry)));
    return updated;
  }

  async reject(id: string): Promise<RegistryAssetRecord> {
    const manifest = await this.readManifest();
    const record = manifest.find((entry) => entry.id === id);
    if (!record) throw new Error("Registry asset not found");
    await rm(record.filePath, { force: true, recursive: true });
    const updated: RegistryAssetRecord = {
      ...record,
      reviewStatus: "rejected",
      reviewedAt: new Date().toISOString(),
    };
    await this.writeManifest(manifest.map((entry) => (entry.id === id ? updated : entry)));
    return updated;
  }

  async uninstall(name: string): Promise<void> {
    const manifest = await this.readManifest();
    const record = manifest.find((entry) => entry.id === name || entry.name === name);
    if (!record) return;
    await rm(record.filePath, { recursive: true, force: true });
    await this.writeManifest(manifest.filter((entry) => entry.id !== record.id));
  }

  async generateHygieneReport(db: Db): Promise<HygieneReport> {
    const registryEntries = await this.readManifest();
    const pending = registryEntries.filter((entry) => entry.reviewStatus === "pending_review");
    const stalePendingReviews = pending.filter((entry) => {
      return Date.now() - new Date(entry.installedAt).getTime() > 3 * 24 * 60 * 60 * 1000;
    }).length;
    const tasks = db.tasks.list();
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const blockedByFailedDependencies = tasks.filter((task) =>
      task.dependsOn.some((dependencyId) => tasksById.get(dependencyId)?.status === "failed")
    ).length;
    const memoriesNeedingCompaction = db.memories.listNeedingCompaction().length;
    const notes: string[] = [];
    if (pending.length > 0) notes.push(`${pending.length} registry asset(s) still need review.`);
    if (memoriesNeedingCompaction > 0)
      notes.push(`${memoriesNeedingCompaction} workflow memory record(s) should be compacted.`);
    if (blockedByFailedDependencies > 0)
      notes.push(`${blockedByFailedDependencies} task(s) are blocked by failed dependencies.`);

    return {
      generatedAt: new Date().toISOString(),
      pendingRegistryReviews: pending.length,
      stalePendingReviews,
      memoriesNeedingCompaction,
      blockedByFailedDependencies,
      notes,
    };
  }
}
