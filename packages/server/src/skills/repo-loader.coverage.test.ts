import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { RepoSkillsLoader } from "./repo-loader";

describe("RepoSkillsLoader", () => {
  afterEach(() => {
    mock.restore();
  });

  test("loadWorktreeManifests loads successfully when files exist", async () => {
    spyOn(fs, "readFile").mockImplementation(async (path: any, _options?: any) => {
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

  test("loadManifestsFromGit loads from bare repo", async () => {
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

  test("load returns empty skills when no files exist", async () => {
    spyOn(fs, "readdir").mockRejectedValue(new Error("ENOENT"));

    const loader = new RepoSkillsLoader("/tmp/repo");
    const index = await loader.load();

    expect(index.skills).toEqual([]);
    expect(index.rules).toEqual([]);
    expect(index.agents).toEqual([]);
    expect(index.workflows).toEqual([]);
  });

  test("getFileContent throws on path traversal", async () => {
    const loader = new RepoSkillsLoader("/tmp/repo");
    expect(loader.getFileContent("../../../etc/passwd")).rejects.toThrow(
      "Access denied: path outside repo skills directory"
    );
  });
});
