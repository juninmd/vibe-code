import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { RepoSkillsLoader } from "./repo-loader";

// Simple mock for parsing frontmatter test
mock.module("node:fs/promises", () => {
  return {
    readdir: mock(async (dir: string) => {
      if (dir.endsWith("/.vibe-code/skills")) {
        return ["my-skill"];
      }
      if (dir.endsWith("/.vibe-code/rules")) {
        return ["my-rule.instructions.md", "ignore-me.txt"];
      }
      if (dir.endsWith("/.vibe-code/agents")) {
        return ["my-agent.agent.md"];
      }
      if (dir.endsWith("/.vibe-code/workflows")) {
        return ["my-workflow.prompt.md"];
      }
      return [];
    }),
    readFile: mock(async (filePath: string) => {
      if (filePath.endsWith("my-skill/SKILL.md")) {
        return `---
name: "My Skill"
description: 'A skill'
---
Skill content`;
      }
      if (filePath.endsWith("my-rule.instructions.md")) {
        return `---
name: My Rule
description: A rule
applyTo: "*.ts"
---
Rule content`;
      }
      if (filePath.endsWith("my-agent.agent.md")) {
        return `---
name: My Agent
description: An agent
---
Agent content`;
      }
      if (filePath.endsWith("my-workflow.prompt.md")) {
        return `---
name: My Workflow
description: A workflow
---
Workflow content`;
      }
      if (filePath.endsWith("bad.md")) {
        return `---
broken frontmatter
name: Bad
---
bad`;
      }

      throw new Error("Not found");
    }),
  };
});

describe("RepoSkillsLoader", () => {
  it("should load skills, rules, agents, and workflows from .vibe-code directory", async () => {
    const loader = new RepoSkillsLoader("/workdir");
    const index = await loader.load();

    expect(index.skills.length).toBe(1);
    expect(index.skills[0].name).toBe("My Skill");
    expect(index.skills[0].description).toBe("A skill");
    expect(index.skills[0].category).toBe("skill");
    expect(index.skills[0].scope).toBe("workspace");

    expect(index.rules.length).toBe(1);
    expect(index.rules[0].name).toBe("My Rule");
    expect(index.rules[0].description).toBe("A rule");
    expect(index.rules[0].applyTo).toBe("*.ts");
    expect(index.rules[0].category).toBe("rule");
    expect(index.rules[0].scope).toBe("workspace");

    expect(index.agents.length).toBe(1);
    expect(index.agents[0].name).toBe("My Agent");
    expect(index.agents[0].description).toBe("An agent");
    expect(index.agents[0].category).toBe("agent");
    expect(index.agents[0].scope).toBe("workspace");

    expect(index.workflows.length).toBe(1);
    expect(index.workflows[0].name).toBe("My Workflow");
    expect(index.workflows[0].description).toBe("A workflow");
    expect(index.workflows[0].category).toBe("workflow");
    expect(index.workflows[0].scope).toBe("workspace");
  });

  it("should return cached index on subsequent load calls", async () => {
    const loader = new RepoSkillsLoader("/workdir");
    const index1 = await loader.load();
    const index2 = await loader.load();
    expect(index1).toBe(index2);
  });

  it("should restrict getFileContent to paths within .vibe-code directory", async () => {
    const loader = new RepoSkillsLoader("/workdir");

    // Should pass for internal path
    const result = await loader.getFileContent("/workdir/.vibe-code/skills/my-skill/SKILL.md");
    expect(result).toContain("Skill content");

    // Should throw for external path
    expect(loader.getFileContent("/workdir/src/app.ts")).rejects.toThrow(
      "Access denied: path outside repo skills directory"
    );
    expect(loader.getFileContent("../../../etc/passwd")).rejects.toThrow(
      "Access denied: path outside repo skills directory"
    );
  });
});
