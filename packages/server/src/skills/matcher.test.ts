import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { matchSkillsForTask } from "./matcher";
import type { SkillsIndex } from "@vibe-code/shared";
import { readdir } from "node:fs/promises";

mock.module("node:fs/promises", () => {
  return {
    readdir: mock(async (dir: string) => {
      if (dir.endsWith("/workdir")) {
        return [
          { isFile: () => true, name: "index.ts" },
          { isFile: () => true, name: "styles.css" },
          { isFile: () => false, name: "src" },
        ];
      }
      if (dir.endsWith("/workdir/src")) {
        return [
          { isFile: () => true, name: "app.tsx" },
          { isFile: () => true, name: "utils.js" },
        ];
      }
      if (dir.endsWith("/workdir/lib") || dir.endsWith("/workdir/app")) {
        throw new Error("Not found");
      }
      if (dir.endsWith("bad-workdir")) {
        throw new Error("Cannot read dir");
      }
      return [];
    }),
  };
});

const mockSkillsIndex: SkillsIndex = {
  rules: [
    {
      name: "React rules",
      description: "React",
      category: "rule",
      filePath: "/rules/react.md",
      applyTo: "**/*.{tsx,jsx}",
      scope: "workspace",
    },
    {
      name: "TS rules",
      description: "TypeScript",
      category: "rule",
      filePath: "/rules/ts.md",
      applyTo: "*.ts",
      scope: "workspace",
    },
    {
      name: "Python rules",
      description: "Python",
      category: "rule",
      filePath: "/rules/py.md",
      applyTo: "*.py",
      scope: "workspace",
    },
    {
      name: "Global rules",
      description: "Global",
      category: "rule",
      filePath: "/rules/global.md",
      applyTo: "",
      scope: "workspace",
    },
    {
      name: "Broken applyTo",
      description: "Broken",
      category: "rule",
      filePath: "/rules/broken.md",
      applyTo: "broken-pattern-without-dots",
      scope: "workspace",
    },
  ],
  skills: [
    {
      name: "Frontend",
      description: "This skill helps build the frontend with react and typescript",
      category: "skill",
      filePath: "/skills/frontend.md",
      scope: "workspace",
    },
    {
      name: "Backend",
      description: "This skill is about nodejs and databases",
      category: "skill",
      filePath: "/skills/backend.md",
      scope: "workspace",
    },
    {
      name: "Devops",
      description: "Useful for deployment and infrastructure",
      category: "skill",
      filePath: "/skills/devops.md",
      scope: "workspace",
    },
  ],
  workflows: [
    {
      name: "Review Code",
      description: "Reviews the code",
      category: "workflow",
      filePath: "/workflows/review.md",
      scope: "workspace",
    },
  ],
  agents: [
    {
      name: "Frontend Expert",
      description: "I know all about frontend React typescript styles",
      category: "agent",
      filePath: "/agents/frontend.md",
      scope: "workspace",
    },
    {
      name: "DB Expert",
      description: "Database guru",
      category: "agent",
      filePath: "/agents/db.md",
      scope: "workspace",
    },
  ],
};

describe("matcher", () => {
  it("should match skills, rules, agents, and workflows based on task description and workdir", async () => {
    const result = await matchSkillsForTask(
      mockSkillsIndex,
      "Fix frontend bug",
      "Update the react components in typescript",
      "/workdir"
    );

    // Expected rules: React rules (tsx), TS rules (ts), Global rules (empty applyTo), Broken applyTo
    // Python shouldn't match.
    const ruleNames = result.rules.map((r) => r.name);
    expect(ruleNames).toContain("React rules");
    expect(ruleNames).toContain("TS rules");
    expect(ruleNames).toContain("Global rules");
    expect(ruleNames).toContain("Broken applyTo");
    expect(ruleNames).not.toContain("Python rules");

    // Expected skills: Frontend
    const skillNames = result.skills.map((s) => s.name);
    expect(skillNames).toContain("Frontend");
    expect(skillNames).not.toContain("Backend");
    expect(skillNames).not.toContain("Devops");

    // Expected workflows: None, since "Review Code" is not in task description
    expect(result.workflow).toBeNull();

    // Expected agents: Frontend Expert
    const agentNames = result.agents.map((a) => a.name);
    expect(agentNames).toContain("Frontend Expert");
    expect(agentNames).not.toContain("DB Expert");
  });

  it("should match workflow if mentioned in task", async () => {
    const result = await matchSkillsForTask(
      mockSkillsIndex,
      "Review Code workflow",
      "Please run the review code workflow",
      "/workdir"
    );

    expect(result.workflow).not.toBeNull();
    expect(result.workflow?.name).toBe("Review Code");
  });

  it("should return top 5 rules if workdir cannot be read or no extensions", async () => {
    const result = await matchSkillsForTask(
      mockSkillsIndex,
      "Task",
      "Description",
      "/bad-workdir"
    );

    expect(result.rules.length).toBe(5);
  });

  it("should handle large amount of matched skills by trimming character count", async () => {
    const largeIndex: SkillsIndex = {
      rules: Array.from({ length: 50 }).map((_, i) => ({
        name: `Rule ${i}`,
        description: "A".repeat(500), // 500 chars each
        category: "rule",
        filePath: `/rules/rule${i}.md`,
        applyTo: "", // Always matches
        scope: "workspace",
      })),
      skills: [],
      workflows: [],
      agents: [],
    };

    const result = await matchSkillsForTask(largeIndex, "Task", "Description", "/workdir");

    // MAX_INJECTION_CHARS is 8000. Each rule is ~550 chars. 8000 / 550 ≈ 14.
    expect(result.rules.length).toBeLessThan(50);
    expect(result.rules.length).toBeGreaterThan(0);

    const totalChars = result.rules.reduce((sum, r) => sum + r.name.length + r.description.length + 50, 0);
    expect(totalChars).toBeLessThanOrEqual(8000);
  });

  it("should handle large amount of matched skills by trimming character count (skills)", async () => {
    const largeIndex: SkillsIndex = {
      rules: [],
      skills: Array.from({ length: 50 }).map((_, i) => ({
        name: `Skill ${i}`,
        description: "Task Description Match " + "A".repeat(500), // Match + long description
        category: "skill",
        filePath: `/skills/skill${i}.md`,
        scope: "workspace",
      })),
      workflows: [],
      agents: [],
    };

    const result = await matchSkillsForTask(largeIndex, "Task", "Task Description Match", "/workdir");

    expect(result.skills.length).toBeLessThan(50);
    expect(result.skills.length).toBeGreaterThan(0);

    const totalChars = result.skills.reduce((sum, s) => sum + s.name.length + s.description.length + 50, 0);
    expect(totalChars).toBeLessThanOrEqual(8000);
  });
});
