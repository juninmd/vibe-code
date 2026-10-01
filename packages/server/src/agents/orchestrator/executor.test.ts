import { describe, expect, it, mock, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import {
  autoInstallDependencies,
  buildAssetBlobUrl,
  buildDocsAutofixPrompt,
  buildReviewAutofixPrompt,
  buildValidationRepairPrompt,
  docsRelativePath,
  escalateModel,
  executeAgent,
  extractDocsAssetPath,
  extractPersona,
  normalizeAsciiText,
  normalizeRepoWebUrl,
  rewriteDocsAssetLinks,
  runWorkspaceScripts,
  taskSlug,
} from "./executor";
import * as EvaluatorMod from "./evaluator";
import * as ReviewMod from "./review";
import * as VerifyMod from "./verify";

mock.module("playwright", () => ({ chromium: {} }));

describe("executor helper functions", () => {
  describe("taskSlug", () => {
    it("slugifies titles correctly", () => {
      expect(taskSlug({ title: "Fix bug 123", id: "t1" } as any)).toBe("fix-bug-123");
      expect(taskSlug({ title: "  Trim Me  ", id: "t2" } as any)).toBe("trim-me");
    });
  });

  describe("docsRelativePath", () => {
    it("returns correct path", () => {
      expect(docsRelativePath({ title: "My Task", id: "t" } as any)).toBe("docs/tasks/my-task.md");
    });
  });

  describe("normalizeAsciiText", () => {
    it("removes diacritics and special characters", () => {
      expect(normalizeAsciiText("Café au lait")).toBe("Cafe au lait");
      expect(normalizeAsciiText("Hello\n  \tWorld\n")).toBe("Hello\n  \tWorld");
    });
  });

  describe("escalateModel", () => {
    it("escalates correctly", () => {
      expect(escalateModel("gpt-3.5-turbo")).toBe("gpt-4o");
      expect(escalateModel("gpt-4o-mini")).toBe("gpt-4o");
      expect(escalateModel("gpt-4o")).toBe("claude-3-5-sonnet-20241022");
      expect(escalateModel("gemini-1.5-flash")).toBe("gemini-2.5-pro");
      expect(escalateModel("claude-3-haiku")).toBe("claude-3-haiku"); // Not escalated by rules
    });
  });

  describe("autoInstallDependencies", () => {
    it("skips if no package.json", async () => {
      spyOn(fsPromises, "access").mockImplementation(() => Promise.reject(new Error("enoent")));
      let logged = false;
      await autoInstallDependencies("/path/to/wt", () => {
        logged = true;
      });
      expect(logged).toBe(false);
    });
  });

  describe("runWorkspaceScripts", () => {
    it("skips if no config file exists", async () => {
      spyOn(fsPromises, "access").mockImplementation(() => Promise.reject(new Error("enoent")));
      let logged = false;
      await runWorkspaceScripts("setup", "/path/to/wt", "repoName", () => {
        logged = true;
      });
      expect(logged).toBe(false);
    });
  });
});

describe("buildReviewAutofixPrompt", () => {
  it("builds prompt using task info and findings", () => {
    const prompt = buildReviewAutofixPrompt(
      { title: "Fix bug", description: "Bug description" } as any,
      ["Finding 1", "Finding 2"]
    );
    expect(prompt).toContain("Fix bug");
    expect(prompt).toContain("Bug description");
    expect(prompt).toContain("1. Finding 1");
    expect(prompt).toContain("2. Finding 2");
  });
});

describe("buildDocsAutofixPrompt", () => {
  it("builds prompt with task info and docs location", () => {
    const prompt = buildDocsAutofixPrompt({ title: "My Task" } as any, ["Docs issue"]);
    expect(prompt).toContain("docs/tasks/my-task.md");
    expect(prompt).toContain("1. Docs issue");
  });
});

describe("buildValidationRepairPrompt", () => {
  it("builds prompt with failure info", () => {
    const prompt = buildValidationRepairPrompt(
      { title: "My Task" } as any,
      {
        passed: false,
        summary: "It failed",
        commands: ["cmd"],
        results: [
          {
            passed: false,
            command: "cmd",
            stdout: "out",
            stderr: "err",
            exitCode: 1,
            name: "validation",
            source: "detected",
            reason: "Mock failure",
          },
        ],
      } as any,
      "Memory string"
    );
    expect(prompt).toContain("It failed");
    expect(prompt).toContain("Failed command: cmd");
    expect(prompt).toContain("Failure output:");
    expect(prompt).toContain("Memory string");
  });
});

describe("extractPersona", () => {
  it("extracts persona correctly", () => {
    expect(extractPersona("[Frontend Review] Something")).toBe("frontend");
    expect(extractPersona("[Security] Issue")).toBe("security");
    expect(extractPersona("No brackets")).toBe("unknown");
  });
});

describe("normalizeRepoWebUrl", () => {
  it("normalizes ssh and https URLs", () => {
    expect(normalizeRepoWebUrl("git@github.com:user/repo.git")).toBe(
      "https://github.com/user/repo"
    );
    expect(normalizeRepoWebUrl("https://github.com/user/repo.git")).toBe(
      "https://github.com/user/repo"
    );
    expect(normalizeRepoWebUrl("https://gitlab.com/user/repo/")).toBe(
      "https://gitlab.com/user/repo"
    );
  });
});

describe("extractDocsAssetPath", () => {
  it("extracts docs paths correctly", () => {
    expect(extractDocsAssetPath("./docs/assets/img.png")).toBe("docs/assets/img.png");
    expect(extractDocsAssetPath("/some/prefix/docs/assets/img.png")).toBe("docs/assets/img.png");
    expect(extractDocsAssetPath("other/path/img.png")).toBe(null);
  });
});

describe("buildAssetBlobUrl", () => {
  it("builds blob url based on provider", () => {
    expect(buildAssetBlobUrl("https://github.com/user/repo", "main", "docs/assets/img.png")).toBe(
      "https://github.com/user/repo/blob/main/docs/assets/img.png"
    );
    expect(
      buildAssetBlobUrl("https://gitlab.com/user/repo", "feat/branch", "docs/assets/img.png")
    ).toBe("https://gitlab.com/user/repo/-/blob/feat/branch/docs/assets/img.png?ref_type=heads");
  });
});

describe("rewriteDocsAssetLinks", () => {
  it("rewrites local markdown links to absolute blob urls", () => {
    const body = "Here is an image ![alt text](./docs/assets/img.png)";
    const rewritten = rewriteDocsAssetLinks(body, "https://github.com/user/repo", "main");
    expect(rewritten).toBe(
      "Here is an image ![alt text](https://github.com/user/repo/blob/main/docs/assets/img.png)"
    );
  });
});

describe("executeAgent (integration mock)", () => {
  it("throws if max concurrent agents is exceeded", async () => {
    const { Orchestrator } = await import("../orchestrator");
    const orch = new Orchestrator({} as any, {} as any, {} as any, {} as any, 1);
    (orch as any).activeRuns.set("t1", {});
    (orch as any).db = { tasks: { list: () => [] } };

    await expect(orch.launch({ id: "t2", dependsOn: [] } as any)).rejects.toThrow(
      "Max concurrent agents reached (1)."
    );
  });
});
