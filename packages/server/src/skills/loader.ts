import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentEntry,
  RuleEntry,
  SkillEntry,
  SkillsIndex,
  WorkflowEntry,
} from "@vibe-code/shared";

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the key-value pairs and the body after the frontmatter.
 */
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
    // Strip surrounding quotes
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

/** Resolve `~` prefix to the user's home directory. */
function resolvePath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function loadSkills(basePath: string): Promise<SkillEntry[]> {
  const skillsDir = join(basePath, "skills");
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
        scope: "global",
      });
    } catch {
      // Skill dir without SKILL.md — skip
    }
  }

  return entries;
}

async function loadRules(basePath: string): Promise<RuleEntry[]> {
  const rulesDir = join(basePath, "rules");
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
        scope: "global",
      });
    } catch {
      // Unreadable rule file — skip
    }
  }

  return entries;
}

async function loadAgents(basePath: string): Promise<AgentEntry[]> {
  const agentsDir = join(basePath, "agents");
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
        scope: "global",
      });
    } catch {
      // Unreadable agent file — skip
    }
  }

  return entries;
}

async function loadWorkflows(basePath: string): Promise<WorkflowEntry[]> {
  const workflowsDir = join(basePath, "workflows");
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
        scope: "global",
      });
    } catch {
      // Unreadable workflow file — skip
    }
  }

  return entries;
}

export class SkillsLoader {
  private cache: SkillsIndex | null = null;
  private basePath: string;

  constructor(basePath = "~/.agents") {
    this.basePath = resolvePath(basePath);
  }

  updatePath(newPath: string): void {
    this.basePath = resolvePath(newPath);
    this.cache = null;
  }

  async load(): Promise<SkillsIndex> {
    if (this.cache) return this.cache;

    const [skills, rules, agents, workflows] = await Promise.all([
      loadSkills(this.basePath),
      loadRules(this.basePath),
      loadAgents(this.basePath),
      loadWorkflows(this.basePath),
    ]);

    this.cache = { skills, rules, agents, workflows };
    return this.cache;
  }

  async loadManifests(): Promise<Record<string, string>> {
    const root = this.basePath;
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

  invalidate(): void {
    this.cache = null;
  }

  async getFileContent(filePath: string): Promise<string> {
    // Security: only serve files under the configured base path
    const resolved = resolvePath(filePath);
    if (!resolved.startsWith(this.basePath)) {
      throw new Error("Access denied: path outside skills directory");
    }
    return readFile(resolved, "utf8");
  }
}
