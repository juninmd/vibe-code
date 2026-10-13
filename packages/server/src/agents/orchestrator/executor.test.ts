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
  extractDocsAssetPath,
  extractPersona,
  normalizeAsciiText,
  normalizeRepoWebUrl,
  rewriteDocsAssetLinks,
  runWorkspaceScripts,
  taskSlug,
} from "./executor";

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

  it("handles timeout correctly", async () => {
    const { executeAgent } = await import("./executor");

    const fakeTask = { id: "t1", title: "test", description: "test" } as any;
    const fakeRun = { id: "r1" } as any;
    const fakeEngine = {
      name: "test-engine",
      execute: async function* () {
        // Block indefinitely to trigger timeout
        await new Promise((resolve) => setTimeout(resolve, 5000));
      },
    } as any;
    const fakeRepo = { name: "repo", url: "url", localPath: "/tmp" } as any;
    const abort = new AbortController();
    const fakeDb = {
      runs: { updateStateSnapshot: mock(), updateStatus: mock(), updateTokenUsage: mock() },
      tasks: { update: mock(), getById: mock() },
      settings: { get: mock().mockReturnValue(undefined) },
      artifacts: { upsert: mock(), listByTask: mock().mockReturnValue([]) },
      memories: {
        getByTaskIdAndScope: mock().mockReturnValue(null),
        append: mock(),
        appendRunSummary: mock(),
      },
      workflow: { getGlobalWorkflow: mock().mockReturnValue(null) },
    } as any;
    const fakeGit = {
      getBarePath: async () => "/tmp",
      createWorktree: async () => "/tmp/wt",
      hasChanges: async () => false,
      hasCommitsAhead: async () => false,
      removeWorktree: async () => {},
      syncWithBase: async () => ({ ok: true }),
      hasMergeConflict: async () => false,
      getCurrentBranch: async () => "main",
    } as any;
    const fakeHub = { broadcastToTask: mock(), flushLogs: mock(), broadcastAll: mock() } as any;
    const sysLog = mock();
    const onFinish = mock();

    // Fast track timeout for testing
    const originalEnv = process.env.VIBE_CODE_AGENT_TIMEOUT_MS;
    process.env.VIBE_CODE_AGENT_TIMEOUT_MS = "10"; // 10 ms

    try {
      await executeAgent(
        fakeTask,
        fakeRun,
        fakeEngine,
        fakeRepo,
        abort,
        fakeDb,
        fakeGit,
        fakeHub,
        sysLog,
        onFinish
      );
    } catch {}

    // Restore env
    process.env.VIBE_CODE_AGENT_TIMEOUT_MS = originalEnv;

    expect(abort.signal.aborted).toBe(true);
    expect(fakeDb.runs.updateStateSnapshot).toHaveBeenCalledWith("r1", "timed_out");
  });

  it("handles inactivity correctly", async () => {
    const { executeAgent } = await import("./executor");

    const fakeTask = { id: "t1", title: "test", description: "test" } as any;
    const fakeRun = { id: "r1" } as any;
    const fakeEngine = {
      name: "test-engine",
      execute: async function* () {
        // Block indefinitely to trigger inactivity monitor
        await new Promise((resolve) => setTimeout(resolve, 5000));
      },
    } as any;
    const fakeRepo = { name: "repo", url: "url", localPath: "/tmp" } as any;
    const abort = new AbortController();
    const fakeDb = {
      runs: { updateStateSnapshot: mock(), updateStatus: mock(), updateTokenUsage: mock() },
      tasks: { update: mock(), getById: mock() },
      settings: { get: mock().mockReturnValue(undefined) },
      artifacts: { upsert: mock(), listByTask: mock().mockReturnValue([]) },
      memories: {
        getByTaskIdAndScope: mock().mockReturnValue(null),
        append: mock(),
        appendRunSummary: mock(),
      },
      workflow: { getGlobalWorkflow: mock().mockReturnValue(null) },
    } as any;
    const fakeGit = {
      getBarePath: async () => "/tmp",
      createWorktree: async () => "/tmp/wt",
      hasChanges: async () => false,
      hasCommitsAhead: async () => false,
      removeWorktree: async () => {},
      syncWithBase: async () => ({ ok: true }),
      hasMergeConflict: async () => false,
      getCurrentBranch: async () => "main",
    } as any;
    const fakeHub = { broadcastToTask: mock(), flushLogs: mock(), broadcastAll: mock() } as any;
    const sysLog = mock();
    const onFinish = mock();

    // Set inactivity quite low
    const originalEnv = process.env.VIBE_CODE_INACTIVITY_MS;
    process.env.VIBE_CODE_INACTIVITY_MS = "10"; // 10 ms

    // Replace setInterval temporarily to run once immediately
    const origSetInterval = global.setInterval;
    let cb: any;

    try {
      (global.setInterval as any) = (fn: any, _ms: number) => {
        cb = fn;
        return 1 as any; // return interval id
      };

      const promise = executeAgent(
        fakeTask,
        fakeRun,
        fakeEngine,
        fakeRepo,
        abort,
        fakeDb,
        fakeGit,
        fakeHub,
        sysLog,
        onFinish
      );

      // artificially wait a bit and call the callback to simulate stalled
      await new Promise((r) => setTimeout(r, 20));
      if (cb) cb();

      try {
        await promise;
      } catch {}

    } finally {
      // Restore
      process.env.VIBE_CODE_INACTIVITY_MS = originalEnv;
      global.setInterval = origSetInterval;
    }

    expect(abort.signal.aborted).toBe(true);
    expect(fakeDb.runs.updateStateSnapshot).toHaveBeenCalledWith("r1", "stalled");
  });
});

describe("executor additional coverage", () => {
  it("escalates correctly when no model given", () => {
    expect(escalateModel(undefined)).toBeUndefined();
  });

  it("handles empty docs asset path", () => {
    expect(extractDocsAssetPath("")).toBe(null);
  });

  it("escalates flash correctly", () => {
    expect(escalateModel("gemini-1.5-flash")).toBe("gemini-2.5-pro");
    expect(escalateModel("claude-3-haiku-flash")).toBe("gpt-4o");
  });

  it("escalates mini correctly", () => {
    expect(escalateModel("gpt-4o-mini")).toBe("gpt-4o");
    expect(escalateModel("gpt-3.5-turbo")).toBe("gpt-4o");
  });

  it("escalates pro/4o correctly", () => {
    expect(escalateModel("gpt-4o")).toBe("claude-3-5-sonnet-20241022");
    expect(escalateModel("pro")).toBe("claude-3-5-sonnet-20241022");
  });

  it("preserves non-matching models", () => {
    expect(escalateModel("something-else")).toBe("something-else");
  });

  it("autoInstallDependencies runs npm install if package.json exists", async () => {
    const accessSpy = spyOn(fsPromises, "access").mockImplementation((path) => {
      if (String(path).endsWith("package.json")) return Promise.resolve();
      if (String(path).endsWith("package-lock.json")) return Promise.resolve();
      return Promise.reject(new Error("enoent"));
    });
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
      () =>
        ({
          exited: Promise.resolve(0),
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
        }) as any
    );

    await autoInstallDependencies("/path/to/wt", () => {});
    expect((spawnSpy as any).mock.calls[0][0]).toEqual(["npm", "install"]);
    accessSpy.mockRestore();
    spawnSpy.mockRestore();
  });

  it("autoInstallDependencies runs bun install if bun.lock exists", async () => {
    const accessSpy = spyOn(fsPromises, "access").mockImplementation((path) => {
      if (String(path).endsWith("package.json")) return Promise.resolve();
      if (String(path).endsWith("bun.lock")) return Promise.resolve();
      return Promise.reject(new Error("enoent"));
    });
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
      () =>
        ({
          exited: Promise.resolve(0),
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
        }) as any
    );

    await autoInstallDependencies("/path/to/wt", () => {});
    expect((spawnSpy as any).mock.calls[0][0]).toEqual(["bun", "install"]);
    accessSpy.mockRestore();
    spawnSpy.mockRestore();
  });

  it("autoInstallDependencies runs pnpm install if pnpm-lock.yaml exists", async () => {
    const accessSpy = spyOn(fsPromises, "access").mockImplementation((path) => {
      if (String(path).endsWith("package.json")) return Promise.resolve();
      if (String(path).endsWith("pnpm-lock.yaml")) return Promise.resolve();
      return Promise.reject(new Error("enoent"));
    });
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
      () =>
        ({
          exited: Promise.resolve(0),
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
        }) as any
    );

    await autoInstallDependencies("/path/to/wt", () => {});
    expect((spawnSpy as any).mock.calls[0][0]).toEqual(["pnpm", "install"]);
    accessSpy.mockRestore();
    spawnSpy.mockRestore();
  });

  it("autoInstallDependencies defaults to bun install", async () => {
    const accessSpy = spyOn(fsPromises, "access").mockImplementation((path) => {
      if (String(path).endsWith("package.json")) return Promise.resolve();
      return Promise.reject(new Error("enoent"));
    });
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
      () =>
        ({
          exited: Promise.resolve(0),
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
        }) as any
    );

    await autoInstallDependencies("/path/to/wt", () => {});
    expect((spawnSpy as any).mock.calls[0][0]).toEqual(["bun", "install"]);
    accessSpy.mockRestore();
    spawnSpy.mockRestore();
  });

  it("autoInstallDependencies handles install failure", async () => {
    spyOn(fsPromises, "access").mockImplementation(() => Promise.resolve());
    spyOn(Bun, "spawn").mockImplementation(
      () =>
        ({
          exited: Promise.resolve(1),
          stdout: new Blob([]).stream(),
          stderr: new Blob(["failed"]).stream(),
        }) as any
    );

    let logged = false;
    await autoInstallDependencies("/path/to/wt", () => {
      logged = true;
    });
    expect(logged).toBe(true);
  });

  it("runWorkspaceScripts reads and executes scripts if config exists", async () => {
    spyOn(fsPromises, "access").mockImplementation((path) => {
      if (String(path).includes(".superset/config.json")) return Promise.resolve();
      return Promise.reject(new Error("enoent"));
    });
    spyOn(fsPromises, "readFile").mockResolvedValue(
      JSON.stringify({
        setup: ["npm run build"],
      })
    );
    spyOn(Bun, "spawn").mockImplementation(
      () =>
        ({
          exited: Promise.resolve(0),
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
        }) as any
    );

    let logged = false;
    await runWorkspaceScripts("setup", "/path/to/wt", "repoName", () => {
      logged = true;
    });
    expect(logged).toBe(true);
  });

  it("runWorkspaceScripts handles missing setup script array gracefully", async () => {
    spyOn(fsPromises, "access").mockImplementation((path) => {
      if (String(path).includes(".superset/config.json")) return Promise.resolve();
      return Promise.reject(new Error("enoent"));
    });
    spyOn(fsPromises, "readFile").mockResolvedValue(JSON.stringify({}));
    let logged = false;
    await runWorkspaceScripts("setup", "/path/to/wt", "repoName", () => {
      logged = true;
    });
    expect(logged).toBe(false);
  });

  it("runWorkspaceScripts handles script execution failure", async () => {
    spyOn(fsPromises, "access").mockImplementation((path) => {
      if (String(path).includes(".superset/config.json")) return Promise.resolve();
      return Promise.reject(new Error("enoent"));
    });
    spyOn(fsPromises, "readFile").mockResolvedValue(
      JSON.stringify({
        setup: ["npm run build"],
      })
    );
    spyOn(Bun, "spawn").mockImplementation(
      () =>
        ({
          exited: Promise.resolve(1),
          stdout: new Blob([]).stream(),
          stderr: new Blob(["error"]).stream(),
        }) as any
    );

    let logged = false;
    await runWorkspaceScripts("setup", "/path/to/wt", "repoName", () => {
      logged = true;
    });
    expect(logged).toBe(true);
  });

  it("runWorkspaceScripts reads and executes scripts if vibe-code config exists", async () => {
    spyOn(fsPromises, "access").mockImplementation((path) => {
      if (String(path).includes(".superset/config.json"))
        return Promise.reject(new Error("enoent"));
      if (String(path).includes(".vibe-code/config.json")) return Promise.resolve();
      return Promise.reject(new Error("enoent"));
    });
    spyOn(fsPromises, "readFile").mockResolvedValue(
      JSON.stringify({
        setup: ["npm run build"],
      })
    );
    spyOn(Bun, "spawn").mockImplementation(
      () =>
        ({
          exited: Promise.resolve(0),
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
        }) as any
    );

    let logged = false;
    await runWorkspaceScripts("setup", "/path/to/wt", "repoName", () => {
      logged = true;
    });
    expect(logged).toBe(true);
  });

  it("buildValidationRepairPrompt builds prompt without memory string if not provided", () => {
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
      } as any
    );
    expect(prompt).toContain("It failed");
    expect(prompt).toContain("Failed command: cmd");
    expect(prompt).toContain("Failure output:");
    expect(prompt).not.toContain("Here are the memories");
  });
});
