import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as actualFs from "node:fs/promises";
import { RepoSkillsLoader } from "./repo-loader";

const originalReaddir = actualFs.readdir;
const originalReadFile = actualFs.readFile;
const normalizePath = (path: string) => path.replace(/\\/g, "/");

beforeEach(() => {
  spyOn(actualFs, "readdir").mockImplementation((async (path, options) => {
    const dir = path;
    if (typeof dir !== "string") {
      return originalReaddir(path, options as never);
    }

    const normalized = normalizePath(dir);
    if (normalized.endsWith("/.vibe-code/skills")) {
      return ["my-skill"];
    }
    if (normalized.endsWith("/.vibe-code/rules")) {
      return ["my-rule.instructions.md", "ignore-me.txt"];
    }
    if (normalized.endsWith("/.vibe-code/agents")) {
      return ["my-agent.agent.md"];
    }
    if (normalized.endsWith("/.vibe-code/workflows")) {
      return ["my-workflow.prompt.md"];
    }
    return originalReaddir(path, options as never);
  }) as typeof actualFs.readdir);

  spyOn(actualFs, "readFile").mockImplementation((async (path, options) => {
    const filePath = path;
    if (typeof filePath !== "string") {
      return originalReadFile(path, options as never);
    }

    const normalized = normalizePath(filePath);
    if (normalized.endsWith("my-skill/SKILL.md")) {
      return `---
name: "My Skill"
description: 'A skill'
---
Skill content`;
    }
    if (normalized.endsWith("my-rule.instructions.md")) {
      return `---
name: My Rule
description: A rule
applyTo: "*.ts"
---
Rule content`;
    }
    if (normalized.endsWith("my-agent.agent.md")) {
      return `---
name: My Agent
description: An agent
---
Agent content`;
    }
    if (normalized.endsWith("my-workflow.prompt.md")) {
      return `---
name: My Workflow
description: A workflow
---
Workflow content`;
    }
    if (normalized.endsWith("bad.md")) {
      return `---
broken frontmatter
name: Bad
---
bad`;
    }

    return originalReadFile(path, options as never);
  }) as typeof actualFs.readFile);
});

afterEach(() => {
  mock.restore();
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
