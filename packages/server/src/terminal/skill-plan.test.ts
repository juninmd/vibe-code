import { describe, expect, it } from "bun:test";
import type { SkillEntry } from "@vibe-code/shared";
import { manualPicks, planSkills, rankSkills, skillNames } from "./skill-plan";

function skill(name: string, description: string, extra: Partial<SkillEntry> = {}): SkillEntry {
  return { name, description, category: "skill", filePath: `/skills/${name}/SKILL.md`, ...extra };
}

const SKILLS = [
  skill("vibe-code-orchestrator", "Create sub-tasks on the board"),
  skill("tdd", "Write failing tests first, then make them pass", { tags: ["test", "tdd"] }),
  skill("database-migrations", "Safe SQLite schema changes with rollback", { tags: ["sql"] }),
  skill("css-polish", "Tailwind spacing and layout fixes"),
  skill("release-notes", "Summarize merged work for the changelog", {
    dependencies: ["changelog-format"],
  }),
  skill("changelog-format", "Keep a Changelog conventions"),
];

describe("planSkills", () => {
  it("always applies the built-in orchestrator, even when nothing else matches", () => {
    const plan = planSkills({ skills: SKILLS, title: "Hello" });
    expect(plan.mode).toBe("auto");
    expect(plan.applied).toEqual([
      { name: "vibe-code-orchestrator", source: "always", reasons: ["built in"] },
    ]);
  });

  it("omits the built-in skill when it is not installed", () => {
    expect(planSkills({ skills: [SKILLS[1]], title: "Hello" }).applied).toEqual([]);
  });

  it("picks skills whose name or tags match the task and explains the match", () => {
    const plan = planSkills({
      skills: SKILLS,
      title: "Add failing tests for the login redirect",
      description: "The redirect loops forever",
    });
    const tdd = plan.applied.find((entry) => entry.name === "tdd");
    expect(tdd?.source).toBe("auto");
    expect(tdd?.reasons).toEqual(["matches: tests, failing"]);
    expect(plan.applied.map((entry) => entry.name)).not.toContain("css-polish");
  });

  it("matches plurals and verb endings", () => {
    const plan = planSkills({ skills: SKILLS, title: "Create a database migration for users" });
    expect(plan.applied.map((entry) => entry.name)).toContain("database-migrations");
  });

  it("ignores a lone description word, which is mostly noise", () => {
    const plan = planSkills({ skills: SKILLS, title: "Fix the layout on mobile" });
    expect(plan.applied.map((entry) => entry.name)).toEqual(["vibe-code-orchestrator"]);
  });

  it("pulls in the dependencies of a picked skill", () => {
    const plan = planSkills({ skills: SKILLS, title: "Write release notes" });
    expect(plan.applied.map((entry) => [entry.name, entry.source, entry.reasons[0]])).toEqual([
      ["vibe-code-orchestrator", "always", "built in"],
      ["release-notes", "auto", "matches: release, notes"],
      ["changelog-format", "auto", "needed by release-notes"],
    ]);
  });

  it("never applies more than four picks", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      skill(`parser-${index}`, "parser", { tags: ["parser"] })
    );
    const plan = planSkills({ skills: many, title: "Rewrite the parser" });
    expect(plan.applied.filter((entry) => entry.source === "auto")).toHaveLength(4);
  });

  it("uses the operator's list as is once it is manual", () => {
    const plan = planSkills({
      skills: SKILLS,
      title: "Add failing tests",
      manual: ["css-polish", "ghost"],
    });
    expect(plan.mode).toBe("manual");
    expect(plan.applied.map((entry) => [entry.name, entry.source, entry.reasons[0]])).toEqual([
      ["vibe-code-orchestrator", "always", "built in"],
      ["css-polish", "manual", "picked by you"],
      ["ghost", "manual", "not installed"],
    ]);
  });

  it("does not duplicate a skill that is both built in and picked", () => {
    const plan = planSkills({
      skills: SKILLS,
      title: "x",
      manual: ["vibe-code-orchestrator", "tdd"],
    });
    expect(skillNames(plan)).toEqual(["vibe-code-orchestrator", "tdd"]);
  });
});

describe("manualPicks", () => {
  it("returns only what the operator chose, never the built-ins", () => {
    const plan = planSkills({ skills: SKILLS, title: "x", manual: ["tdd"] });
    expect(manualPicks(plan.applied)).toEqual(["tdd"]);
  });
});

describe("rankSkills", () => {
  it("returns nothing for a task made only of filler words", () => {
    expect(rankSkills(SKILLS, "Please fix the issue and add this")).toEqual([]);
  });
});
