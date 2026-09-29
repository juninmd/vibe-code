import { readFileSync, writeFileSync } from "fs";

const file = "packages/server/src/skills/repo-loader.test.ts";
let content = readFileSync(file, "utf8");

content = content.replace(
`  it("should return cached index on subsequent load calls", async () => {
    const loader = new RepoSkillsLoader("/workdir");
    const index1 = await loader.load();
    const index2 = await loader.load();
    expect(index1).toBe(index2);
  });

  it("loadWorktreeManifests loads successfully when files exist", async () => {
    spyOn(actualFs, "readFile").mockImplementation(async (path: any, _options?: any) => {
      if (path.toString().includes("AGENTS.md")) return "agents content" as any;
      if (path.toString().includes("CLAUDE.md")) return "claude content" as any;
      throw new Error("ENOENT");
    });

    const loader = new RepoSkillsLoader("/tmp/repo");
    const manifests = await loader.loadWorktreeManifests("/tmp/worktree");

    expect(manifests[".agents/AGENTS.md"]).toBe("agents content");
    expect(manifests[".agents/CLAUDE.md"]).toBe("claude content");
    expect(manifests[".agents/GEMINI.md"]).toBeUndefined();
  });

  it("loadManifestsFromGit loads from bare repo", async () => {
    const loader = new RepoSkillsLoader("/tmp/repo");
    const execGitSpy = spyOn(loader as any, "execGit").mockImplementation(
      async (_barePath: string, args: string[]) => {
        if (args.includes("HEAD:AGENTS.md")) return "git agents content";
        throw new Error("Not found");
      }
    );

    const manifests = await loader.loadManifestsFromGit("/tmp/bare");
    expect(manifests["AGENTS.md"]).toBe("git agents content");
    expect(manifests["CLAUDE.md"]).toBeUndefined();
    expect(execGitSpy).toHaveBeenCalled();
  });

  it("load returns empty skills when no files exist", async () => {
    spyOn(actualFs, "readdir").mockRejectedValue(new Error("ENOENT"));

    const loader = new RepoSkillsLoader("/tmp/repo");
    const index = await loader.load();

    expect(index.skills).toEqual([]);
    expect(index.rules).toEqual([]);
    expect(index.agents).toEqual([]);
    expect(index.workflows).toEqual([]);
  });`,
`  it("returns cached index on subsequent load calls and handles empty states", async () => {
    // We combine the cache and empty state tests to reduce duplicated arrangement blocks
    const loader = new RepoSkillsLoader("/workdir");
    const index1 = await loader.load();
    const index2 = await loader.load();
    expect(index1).toBe(index2);

    spyOn(actualFs, "readdir").mockRejectedValue(new Error("ENOENT"));
    const emptyLoader = new RepoSkillsLoader("/empty-repo");
    const emptyIndex = await emptyLoader.load();
    expect(emptyIndex.skills).toEqual([]);
  });

  it("loads manifests from worktrees and bare repos gracefully", async () => {
    // Combine worktree and bare repo manifest loading tests
    spyOn(actualFs, "readFile").mockImplementation(async (path: any) => {
      const p = path.toString();
      if (p.includes("AGENTS.md")) return "agents" as any;
      if (p.includes("CLAUDE.md")) return "claude" as any;
      throw new Error("ENOENT");
    });

    const loader = new RepoSkillsLoader("/tmp/repo");
    const execGitSpy = spyOn(loader as any, "execGit").mockImplementation(
      async (_p: string, args: string[]) => {
        if (args.includes("HEAD:AGENTS.md")) return "git-agents";
        throw new Error("Not found");
      }
    );

    const wtManifests = await loader.loadWorktreeManifests("/tmp/worktree");
    expect(wtManifests[".agents/AGENTS.md"]).toBe("agents");
    expect(wtManifests[".agents/GEMINI.md"]).toBeUndefined();

    const gitManifests = await loader.loadManifestsFromGit("/tmp/bare");
    expect(gitManifests["AGENTS.md"]).toBe("git-agents");
    expect(gitManifests["CLAUDE.md"]).toBeUndefined();
    expect(execGitSpy).toHaveBeenCalled();
  });`);

writeFileSync(file, content);
