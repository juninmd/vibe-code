import type { AppliedSkill, SkillEntry, SkillMode, SkillPlan } from "@vibe-code/shared";

/**
 * Decides which skills ride along with a task's agent plugin. Operators should not have
 * to browse a skill catalogue before every task: the plan is derived from the task text
 * and only becomes manual once the operator edits it.
 */

/** Built-in skills applied to every task (when installed). */
export const ALWAYS_ON_SKILLS = ["vibe-code-orchestrator"] as const;

const MAX_AUTO_SKILLS = 4;
/** One name/tag word or four description words. Single description hits are noise. */
const MIN_AUTO_SCORE = 4;
const NAME_WEIGHT = 4;
const TAG_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 1;
const MAX_DESCRIPTION_HITS = 3;
const MAX_REASON_WORDS = 3;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "when",
  "use",
  "using",
  "used",
  "you",
  "your",
  "are",
  "not",
  "can",
  "will",
  "should",
  "must",
  "all",
  "any",
  "add",
  "new",
  "make",
  "fix",
  "get",
  "set",
  "run",
  "task",
  "tasks",
  "code",
  "file",
  "files",
  "need",
  "needs",
  "want",
  "please",
  "issue",
  "issues",
  "original",
]);

function words(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9+#]+/)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    )
  );
}

/** Same word, allowing plurals and verb endings ("tests" ~ "test", "testing" ~ "test"). */
function sameWord(left: string, right: string): boolean {
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 4 && long.startsWith(short);
}

function matching(taskWords: string[], candidates: string[]): string[] {
  return taskWords.filter((task) => candidates.some((candidate) => sameWord(task, candidate)));
}

export interface RankedSkill {
  skill: SkillEntry;
  score: number;
  matched: string[];
}

export function rankSkills(skills: SkillEntry[], taskText: string): RankedSkill[] {
  const taskWords = words(taskText);
  if (taskWords.length === 0) return [];

  return skills
    .map((skill) => {
      const nameHits = matching(taskWords, words(skill.name));
      const tagHits = matching(taskWords, words((skill.tags ?? []).join(" ")));
      const descriptionHits = matching(taskWords, words(skill.description)).filter(
        (word) => !nameHits.includes(word) && !tagHits.includes(word)
      );
      const score =
        nameHits.length * NAME_WEIGHT +
        tagHits.length * TAG_WEIGHT +
        Math.min(descriptionHits.length, MAX_DESCRIPTION_HITS) * DESCRIPTION_WEIGHT;
      return {
        skill,
        score,
        matched: [...new Set([...nameHits, ...tagHits, ...descriptionHits])],
      };
    })
    .filter((entry) => entry.score >= MIN_AUTO_SCORE)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
}

export interface PlanInput {
  /** Every installed skill. */
  skills: SkillEntry[];
  title: string;
  description?: string | null;
  goal?: string | null;
  /** Names the operator picked; a plan is manual exactly when this is set. */
  manual?: string[] | null;
}

function builtIns(skills: SkillEntry[]): AppliedSkill[] {
  const installed = new Set(skills.map((skill) => skill.name));
  return ALWAYS_ON_SKILLS.filter((name) => installed.has(name)).map((name) => ({
    name,
    source: "always" as const,
    reasons: ["built in"],
  }));
}

export function planSkills(input: PlanInput): SkillPlan {
  const applied = builtIns(input.skills);
  const taken = new Set(applied.map((skill) => skill.name));
  const known = new Set(input.skills.map((skill) => skill.name));
  const push = (entry: AppliedSkill) => {
    if (taken.has(entry.name)) return;
    taken.add(entry.name);
    applied.push(entry);
  };

  if (input.manual) {
    for (const name of input.manual) {
      // A pick that is no longer installed stays visible, so the operator can drop it.
      push({
        name,
        source: "manual",
        reasons: [known.has(name) ? "picked by you" : "not installed"],
      });
    }
    return { mode: "manual", applied };
  }

  const text = [input.title, input.description, input.goal].filter(Boolean).join("\n");
  const byName = new Map(input.skills.map((skill) => [skill.name, skill]));
  const ranked = rankSkills(input.skills, text).slice(0, MAX_AUTO_SKILLS);
  for (const entry of ranked) {
    push({
      name: entry.skill.name,
      source: "auto",
      reasons: [`matches: ${entry.matched.slice(0, MAX_REASON_WORDS).join(", ")}`],
    });
  }
  // A skill that builds on another one is useless without it.
  for (const entry of ranked) {
    for (const dependency of entry.skill.dependencies ?? []) {
      if (byName.has(dependency)) {
        push({ name: dependency, source: "auto", reasons: [`needed by ${entry.skill.name}`] });
      }
    }
  }
  return { mode: "auto", applied };
}

export function skillNames(plan: SkillPlan): string[] {
  return plan.applied.map((skill) => skill.name);
}

/** The picks the operator made by hand — what to keep when switching to manual. */
export function manualPicks(applied: AppliedSkill[]): string[] {
  return applied.filter((skill) => skill.source !== "always").map((skill) => skill.name);
}

export function isSkillMode(value: unknown): value is SkillMode {
  return value === "auto" || value === "manual";
}
