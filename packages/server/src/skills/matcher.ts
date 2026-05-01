import { readdir } from "node:fs/promises";
import type {
  AgentEntry,
  RuleEntry,
  SkillEntry,
  SkillsIndex,
  WorkflowEntry,
} from "@vibe-code/shared";

export interface MatchedSkills {
  rules: RuleEntry[];
  skills: SkillEntry[];
  workflow: WorkflowEntry | null;
  agents: AgentEntry[];
}

const MAX_INJECTION_CHARS = 8000;

/**
 * Match rules by checking if any of the workdir file extensions match
 * the rule's `applyTo` glob pattern.
 */
function matchRules(rules: RuleEntry[], fileExtensions: Set<string>): RuleEntry[] {
  if (fileExtensions.size === 0) return rules.slice(0, 5); // fallback: return up to 5

  return rules.filter((rule) => {
    if (!rule.applyTo) return true; // no pattern = always applies
    // Extract extensions from glob-like pattern: **/*.{ts,tsx,js}
    const extMatch = rule.applyTo.match(/\.\{([^}]+)\}/);
    if (extMatch) {
      const exts = extMatch[1].split(",").map((e) => e.trim());
      return exts.some((ext) => fileExtensions.has(ext));
    }
    // Simple extension match: **/*.ts
    const simpleMatch = rule.applyTo.match(/\*\.(\w+)$/);
    if (simpleMatch) {
      return fileExtensions.has(simpleMatch[1]);
    }
    return true; // can't parse pattern — include by default
  });
}

/**
 * Match skills by keyword overlap between skill description and task text.
 */
function matchSkills(skills: SkillEntry[], taskText: string): SkillEntry[] {
  const lowerText = taskText.toLowerCase();
  const scored = skills
    .map((skill) => {
      const words = skill.description.toLowerCase().split(/\s+/);
      const hits = words.filter((w) => w.length > 3 && lowerText.includes(w)).length;
      return { skill, score: hits };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 5).map((s) => s.skill);
}

/**
 * Match workflow by name reference in task text.
 */
function matchWorkflow(workflows: WorkflowEntry[], taskText: string): WorkflowEntry | null {
  const lowerText = taskText.toLowerCase();
  return workflows.find((w) => lowerText.includes(w.name.toLowerCase())) ?? null;
}

/**
 * Match agents by keyword overlap (same approach as skills).
 */
function matchAgents(agents: AgentEntry[], taskText: string): AgentEntry[] {
  const lowerText = taskText.toLowerCase();
  const scored = agents
    .map((agent) => {
      const words = agent.description.toLowerCase().split(/\s+/);
      const hits = words.filter((w) => w.length > 3 && lowerText.includes(w)).length;
      return { agent, score: hits };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map((s) => s.agent);
}

/**
 * Detect file extensions in the workdir (top-level only for speed).
 */
async function detectExtensions(workdir: string): Promise<Set<string>> {
  const exts = new Set<string>();
  try {
    const entries = await readdir(workdir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf(".");
        if (dotIdx > 0) exts.add(entry.name.slice(dotIdx + 1));
      }
    }
    // Also check common subdirs
    for (const subdir of ["src", "lib", "app"]) {
      try {
        const subEntries = await readdir(`${workdir}/${subdir}`, { withFileTypes: true });
        for (const entry of subEntries) {
          if (entry.isFile()) {
            const dotIdx = entry.name.lastIndexOf(".");
            if (dotIdx > 0) exts.add(entry.name.slice(dotIdx + 1));
          }
        }
      } catch {
        // subdir doesn't exist
      }
    }
  } catch {
    // workdir not readable
  }
  return exts;
}

/**
 * Recursively resolve dependencies for a set of entries.
 */
function resolveDependencies<T extends { name: string; dependencies?: string[] }>(
  allEntries: T[],
  initialSelection: T[]
): T[] {
  const result = new Map<string, T>();
  const queue = [...initialSelection];

  while (queue.length > 0) {
    const entry = queue.shift()!;
    if (result.has(entry.name)) continue;
    result.set(entry.name, entry);

    if (entry.dependencies) {
      for (const depName of entry.dependencies) {
        const dep = allEntries.find((e) => e.name === depName);
        if (dep && !result.has(dep.name)) {
          queue.push(dep);
        }
      }
    }
  }

  return Array.from(result.values());
}
export async function matchSkillsForTask(
  index: SkillsIndex,
  taskTitle: string,
  taskDescription: string,
  workdir: string
): Promise<MatchedSkills> {
  const taskText = `${taskTitle} ${taskDescription}`;
  const fileExts = await detectExtensions(workdir);

  const initialRules = matchRules(index.rules, fileExts);
  const initialSkills = matchSkills(index.skills, taskText);
  const workflow = matchWorkflow(index.workflows, taskText);
  const initialAgents = matchAgents(index.agents, taskText);

  // Resolve skills from agents
  const agentSkills: SkillEntry[] = [];
  for (const agent of initialAgents) {
    if (agent.skills) {
      for (const skillName of agent.skills) {
        const skill = index.skills.find((s) => s.name === skillName);
        if (skill) agentSkills.push(skill);
      }
    }
  }

  // Resolve dependencies
  const rules = resolveDependencies(index.rules, initialRules);
  const skills = resolveDependencies(index.skills, [...initialSkills, ...agentSkills]);
  const agents = initialAgents;

  // Trim to budget
  let totalChars = 0;
  const trimmedRules: RuleEntry[] = [];
  for (const rule of rules) {
    const size = rule.name.length + rule.description.length + 50;
    if (totalChars + size > MAX_INJECTION_CHARS) break;
    totalChars += size;
    trimmedRules.push(rule);
  }

  const trimmedSkills: SkillEntry[] = [];
  for (const skill of skills) {
    const size = skill.name.length + skill.description.length + 50;
    if (totalChars + size > MAX_INJECTION_CHARS) break;
    totalChars += size;
    trimmedSkills.push(skill);
  }

  return { rules: trimmedRules, skills: trimmedSkills, workflow, agents };
}
