import { describe, expect, it } from "bun:test";
import type { SkillEntry } from "@vibe-code/shared";
import { ALWAYS_ON_SKILLS, isSkillMode, manualPicks, planSkills, rankSkills } from "../skill-plan";

describe("skill-plan", () => {
  const skills: SkillEntry[] = [
    {
      name: "vibe-code-orchestrator",
      description: "built in orchestrator",
      tags: ["orchestrator"],
      category: "skill",
      filePath: "test",
    },
    {
      name: "frontend-react",
      description: "useful for react apps and web development",
      tags: ["react", "frontend"],
      category: "skill",
      filePath: "test",
    },
    {
      name: "backend-node",
      description: "nodejs backend development",
      tags: ["backend", "node"],
      category: "skill",
      filePath: "test",
    },
    {
      name: "database-sql",
      description: "sql database migrations and queries",
      tags: ["db", "sql"],
      dependencies: ["backend-node"],
      category: "skill",
      filePath: "test",
    },
  ];

  describe("rankSkills", () => {
    it("should return empty array if no keywords matched", () => {
      const ranked = rankSkills(skills, "doing some random stuff");
      expect(ranked).toEqual([]);
    });

    it("should rank skills based on task text matching names and tags", () => {
      const ranked = rankSkills(skills, "fix the react frontend application");
      expect(ranked.length).toBe(1);
      expect(ranked[0].skill.name).toBe("frontend-react");
      expect(ranked[0].score).toBeGreaterThan(0);
      expect(ranked[0].matched).toContain("react");
    });

    it("should handle description matches with lower weight", () => {
      const ranked = rankSkills(skills, "help with web apps");
      expect(ranked.length).toBe(0);
      // "web" matches description (score 1)
      // "apps" matches description (score 1)
      // total score 2 is less than MIN_AUTO_SCORE (4)
    });

    it("should rank description matches if score is high enough", () => {
      const ranked = rankSkills(skills, "useful react web development");
      // react is a tag (3), useful is description (1) -> score 4 -> included
      expect(ranked.length).toBe(1);
      expect(ranked[0].skill.name).toBe("frontend-react");
    });
  });

  describe("planSkills", () => {
    it("should always include ALWAYS_ON_SKILLS if installed", () => {
      const plan = planSkills({
        skills,
        title: "some random task",
      });

      expect(plan.applied.some((s) => s.name === "vibe-code-orchestrator")).toBe(true);
      expect(plan.mode).toBe("auto");
    });

    it("should auto-apply skills based on title and description", () => {
      const plan = planSkills({
        skills,
        title: "add a new table",
        description: "run sql database queries",
      });

      expect(plan.mode).toBe("auto");
      expect(plan.applied.some((s) => s.name === "database-sql")).toBe(true);
      // It should also include dependencies
      expect(plan.applied.some((s) => s.name === "backend-node")).toBe(true);
    });

    it("should respect manual picks and not auto-apply", () => {
      const plan = planSkills({
        skills,
        title: "fix the react frontend", // should auto-match frontend-react
        manual: ["backend-node"], // but manual overrides
      });

      expect(plan.mode).toBe("manual");
      expect(plan.applied.some((s) => s.name === "backend-node")).toBe(true);
      expect(plan.applied.some((s) => s.name === "frontend-react")).toBe(false);
      expect(plan.applied.some((s) => s.name === "vibe-code-orchestrator")).toBe(true); // always on is still there
    });
  });

  describe("manualPicks", () => {
    it("should filter out always-on skills", () => {
      const picks = manualPicks([
        { name: "vibe-code-orchestrator", source: "always", reasons: [] },
        { name: "frontend-react", source: "auto", reasons: [] },
      ]);
      expect(picks).toEqual(["frontend-react"]);
    });
  });

  describe("isSkillMode", () => {
    it("should return true for valid modes", () => {
      expect(isSkillMode("auto")).toBe(true);
      expect(isSkillMode("manual")).toBe(true);
    });

    it("should return false for invalid modes", () => {
      expect(isSkillMode("other")).toBe(false);
      expect(isSkillMode(null)).toBe(false);
    });
  });
});
