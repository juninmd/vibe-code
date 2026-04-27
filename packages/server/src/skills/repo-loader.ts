import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  AgentEntry,
  RuleEntry,
  SkillEntry,
  SkillsIndex,
  WorkflowEntry,
} from "@vibe-code/shared";

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  if (!content.startsWith("---")) return { meta, body: content };

  const end = content.indexOf("---", 3);
  if (end === -1) return { meta, body: content };

  const fmBlock = content.slice(3, end).trim();
  for (const line of fmBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }

  const body = content.slice(end + 3).trim();
  return { meta, body };
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Loads skills, rules, agents, and workflows from a repository's
 * `.vibe-code/` directory, following the same structure as the global loader.
 */
export class RepoSkillsLoader {
  private basePath: string;
  private cache: SkillsIndex | null = null;

  constructor(workdir: string) {
    this.basePath = join(workdir, ".vibe-code");
  }

  async load(): Promise<SkillsIndex> {
    if (this.cache) return this.cache;

    const [skills, rules, agents, workflows] = await Promise.all([
      this.loadSkills(),
      this.loadRules(),
      this.loadAgents(),
      this.loadWorkflows(),
    ]);

    this.cache = { skills, rules, agents, workflows };
    return this.cache;
  }

  /**
   * Loads "manifest" files that agents natively look for (AGENTS.md, CLAUDE.md, etc.)
   * from the repository root.
   */
  async loadManifests(): Promise<Record<string, string>> {
    const root = resolve(this.basePath, "..");
    const manifests: Record<string, string> = {};
    const files = [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "CONVENTIONS.md",
      ".aider.instructions.md",
      ".claude.instructions.md",
      ".github/copilot-instructions.md",
    ];

    for (const file of files) {
      try {
        const content = await readFile(join(root, file), "utf8");
        manifests[file] = content;
      } catch {
        // File doesn't exist - skip
      }
    }

    return manifests;
  }

  async getFileContent(filePath: string): Promise<string> {
    const resolved = resolve(filePath);
    const base = resolve(this.basePath);
    if (!resolved.startsWith(base)) {
      throw new Error("Access denied: path outside repo skills directory");
    }
    return readFile(resolved, "utf8");
  }

  private async loadSkills(): Promise<SkillEntry[]> {
    const skillsDir = join(this.basePath, "skills");
    const entries: SkillEntry[] = [];
    const dirs = await safeReaddir(skillsDir);

    for (const name of dirs) {
      const skillFile = join(skillsDir, name, "SKILL.md");
      try {
        const raw = await readFile(skillFile, "utf8");
        const { meta } = parseFrontmatter(raw);
        entries.push({
          name: meta.name || name,
          description: meta.description || "",
          category: "skill",
          filePath: skillFile,
          scope: "workspace",
        });
      } catch {
        // Skip unreadable
      }
    }

    return entries;
  }

  private async loadRules(): Promise<RuleEntry[]> {
    const rulesDir = join(this.basePath, "rules");
    const entries: RuleEntry[] = [];
    const files = await safeReaddir(rulesDir);

    for (const file of files) {
      if (!file.endsWith(".instructions.md")) continue;
      const filePath = join(rulesDir, file);
      try {
        const raw = await readFile(filePath, "utf8");
        const { meta } = parseFrontmatter(raw);
        entries.push({
          name: meta.name || file.replace(".instructions.md", ""),
          description: meta.description || "",
          applyTo: meta.applyTo || "",
          category: "rule",
          filePath,
          scope: "workspace",
        });
      } catch {
        // Skip unreadable
      }
    }

    return entries;
  }

  private async loadAgents(): Promise<AgentEntry[]> {
    const agentsDir = join(this.basePath, "agents");
    const entries: AgentEntry[] = [];
    const files = await safeReaddir(agentsDir);

    for (const file of files) {
      if (!file.endsWith(".agent.md")) continue;
      const filePath = join(agentsDir, file);
      try {
        const raw = await readFile(filePath, "utf8");
        const { meta } = parseFrontmatter(raw);
        entries.push({
          name: meta.name || file.replace(".agent.md", ""),
          description: meta.description || "",
          category: "agent",
          filePath,
          scope: "workspace",
        });
      } catch {
        // Skip unreadable
      }
    }

    return entries;
  }

  private async loadWorkflows(): Promise<WorkflowEntry[]> {
    const workflowsDir = join(this.basePath, "workflows");
    const entries: WorkflowEntry[] = [];
    const files = await safeReaddir(workflowsDir);

    for (const file of files) {
      if (!file.endsWith(".prompt.md")) continue;
      const filePath = join(workflowsDir, file);
      try {
        const raw = await readFile(filePath, "utf8");
        const { meta } = parseFrontmatter(raw);
        entries.push({
          name: meta.name || file.replace(".prompt.md", ""),
          description: meta.description || "",
          category: "workflow",
          filePath,
          scope: "workspace",
        });
      } catch {
        // Skip unreadable
      }
    }

    return entries;
  }
}
