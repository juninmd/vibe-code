import * as fs from "node:fs/promises";
import type {
  AgentEntry,
  RuleEntry,
  SkillEffectiveness,
  SkillEntry,
  SkillsIndex,
  WorkflowEntry,
} from "@vibe-code/shared";

export interface MatchedSkills {
  rules: RuleEntry[];
  skills: SkillEntry[];
  workflow: WorkflowEntry | null;
  agents: AgentEntry[];
  metadata: MatchSelectionMetadata;
}

export interface MatchContext {
  recentFindings?: Array<{ persona: string; severity: string; content: string }>;
  skillEffectiveness?: SkillEffectiveness[];
  workflowHint?: string | null;
  taskGoal?: string | null;
  desiredOutcome?: string | null;
}

export interface RankedMatch {
  name: string;
  score: number;
  reasons: string[];
}

export interface MatchSelectionMetadata {
  fileExtensions: string[];
  rankedRules: RankedMatch[];
  rankedSkills: RankedMatch[];
  rankedAgents: RankedMatch[];
  workflow: RankedMatch | null;
}

const MAX_INJECTION_CHARS = 8000;

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_+#.-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2)
    )
  );
}

function keywordOverlap(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  return tokens.filter((token) => lower.includes(token)).length;
}

function metricBonus(
  name: string,
  metrics?: SkillEffectiveness[]
): { score: number; reason?: string } {
  const metric = metrics?.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!metric) return { score: 0 };
  const score = metric.successRate / 20 - metric.avgBlockers * 2 - metric.avgWarnings;
  if (score <= 0) return { score: 0 };
  return { score, reason: `historical-success:${metric.successRate}` };
}

function rankEntries<T extends { name: string; description: string; tags?: string[] }>(
  entries: T[],
  taskTokens: string[],
  findingTokens: string[],
  metrics?: SkillEffectiveness[]
): Array<{ entry: T; score: number; reasons: string[] }> {
  return entries
    .map((entry) => {
      const tagText = entry.tags?.join(" ") ?? "";
      const lexicalScore = keywordOverlap(
        `${entry.name} ${entry.description} ${tagText}`,
        taskTokens
      );
      const findingScore = findingTokens.length
        ? keywordOverlap(`${entry.name} ${entry.description} ${tagText}`, findingTokens)
        : 0;
      const metric = metricBonus(entry.name, metrics);
      const reasons = [
        lexicalScore > 0 ? `task-overlap:${lexicalScore}` : "",
        findingScore > 0 ? `review-signal:${findingScore}` : "",
        metric.reason ?? "",
      ].filter(Boolean);
      return {
        entry,
        score: lexicalScore * 3 + findingScore * 2 + metric.score,
        reasons,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name)
    );
}

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

function rankRules(
  rules: RuleEntry[],
  fileExtensions: Set<string>,
  taskTokens: string[]
): Array<{ entry: RuleEntry; score: number; reasons: string[] }> {
  return rules
    .map((rule) => {
      let score = 0;
      const reasons: string[] = [];
      if (!rule.applyTo) {
        score += 2;
        reasons.push("global-rule");
      }
      if (matchRules([rule], fileExtensions).length > 0) {
        score += 8;
        reasons.push("surface-match");
      }
      const lexical = keywordOverlap(`${rule.name} ${rule.description}`, taskTokens);
      if (lexical > 0) {
        score += lexical * 2;
        reasons.push(`task-overlap:${lexical}`);
      }
      return { entry: rule, score, reasons };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name)
    );
}

/**
 * Match workflow by name reference in task text.
 */
function matchWorkflow(workflows: WorkflowEntry[], taskText: string): WorkflowEntry | null {
  const lowerText = taskText.toLowerCase();
  return workflows.find((w) => lowerText.includes(w.name.toLowerCase())) ?? null;
}

function rankWorkflow(
  workflows: WorkflowEntry[],
  taskTokens: string[],
  workflowHint?: string | null
): { workflow: WorkflowEntry | null; ranked: RankedMatch | null } {
  const ranked = workflows
    .map((workflow) => {
      const overlap = keywordOverlap(`${workflow.name} ${workflow.description}`, taskTokens);
      let score = overlap >= 2 ? overlap * 3 : 0;
      const reasons = score > 0 ? ["task-overlap"] : [];
      if (workflowHint && workflow.name.toLowerCase().includes(workflowHint.toLowerCase())) {
        score += 12;
        reasons.push("explicit-workflow-hint");
      }
      return { workflow, score, reasons };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.workflow.name.localeCompare(right.workflow.name)
    );
  const top = ranked[0] ?? null;
  return {
    workflow: top?.workflow ?? null,
    ranked: top
      ? {
          name: top.workflow.name,
          score: top.score,
          reasons: top.reasons,
        }
      : null,
  };
}

/**
 * Detect file extensions in the workdir (top-level only for speed).
 */
async function detectExtensions(workdir: string): Promise<Set<string>> {
  const exts = new Set<string>();
  try {
    const entries = await fs.readdir(workdir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf(".");
        if (dotIdx > 0) exts.add(entry.name.slice(dotIdx + 1));
      }
    }
    // Also check common subdirs
    for (const subdir of ["src", "lib", "app"]) {
      try {
        const subEntries = await fs.readdir(`${workdir}/${subdir}`, { withFileTypes: true });
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
    const entry = queue.shift();
    if (!entry) continue;
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
  workdir: string,
  context: MatchContext = {}
): Promise<MatchedSkills> {
  const taskText = [taskTitle, taskDescription, context.taskGoal, context.desiredOutcome]
    .filter(Boolean)
    .join(" ");
  const fileExts = await detectExtensions(workdir);
  const taskTokens = tokenize(taskText);
  const findingTokens = tokenize(
    (context.recentFindings ?? []).map((finding) => finding.content).join(" ")
  );

  const rankedRules = rankRules(index.rules, fileExts, taskTokens);
  const initialRules = rankedRules.map((entry) => entry.entry);
  const rankedSkills = rankEntries(
    index.skills,
    taskTokens,
    findingTokens,
    context.skillEffectiveness
  );
  const initialSkills = rankedSkills.map((entry) => entry.entry);
  const workflowResult = rankWorkflow(index.workflows, taskTokens, context.workflowHint);
  const workflow = workflowResult.workflow ?? matchWorkflow(index.workflows, taskText);
  const rankedAgents = rankEntries(index.agents, taskTokens, findingTokens);
  const initialAgents = rankedAgents.map((entry) => entry.entry);

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

  return {
    rules: trimmedRules,
    skills: trimmedSkills,
    workflow,
    agents,
    metadata: {
      fileExtensions: Array.from(fileExts),
      rankedRules: rankedRules.slice(0, 10).map((entry) => ({
        name: entry.entry.name,
        score: entry.score,
        reasons: entry.reasons,
      })),
      rankedSkills: rankedSkills.slice(0, 10).map((entry) => ({
        name: entry.entry.name,
        score: entry.score,
        reasons: entry.reasons,
      })),
      rankedAgents: rankedAgents.slice(0, 10).map((entry) => ({
        name: entry.entry.name,
        score: entry.score,
        reasons: entry.reasons,
      })),
      workflow: workflowResult.ranked,
    },
  };
}
