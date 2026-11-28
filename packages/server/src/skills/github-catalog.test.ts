import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAgentPlugin } from "../terminal/harness";
import { GitHubPluginCatalog, githubRepo, safeAssetPath } from "./github-catalog";
import { SkillsLoader } from "./loader";
import { SkillRegistryService } from "./registry";

const commit = "a".repeat(40);
const cleanups: (() => Promise<unknown> | undefined)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(options: { truncated?: boolean; large?: boolean; failure?: boolean } = {}) {
  const fetchSpy = spyOn(global, "fetch").mockImplementation((async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input);
    expect(url.startsWith("https://api.github.com/repos/team/catalog")).toBe(true);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-only-token");
    if (url.endsWith("/team/catalog")) return Response.json({ default_branch: "master" });
    if (url.includes("/commits/")) return Response.json({ sha: commit });
    if (url.includes("/git/trees/"))
      return Response.json({
        truncated: options.truncated,
        tree: [
          { path: ".agents/skills/ui/SKILL.md", type: "blob", mode: "100644", size: 60 },
          {
            path: ".agents/skills/ui/references/layout.md",
            type: "blob",
            mode: "100644",
            size: options.large ? 2 * 1024 * 1024 : 20,
          },
          { path: ".agents/skills/ui/unsafe-link", type: "blob", mode: "120000", size: 8 },
        ],
      });
    expect(url).toContain(`ref=${commit}`);
    if (options.failure) return new Response("denied", { status: 403 });
    return new Response(
      url.includes("SKILL.md")
        ? "---\nname: ui\ndescription: Layout guidance\n---\nRead references/layout.md"
        : "Verified layout reference."
    );
  }) as typeof fetch);
  cleanups.push(() => {
    fetchSpy.mockRestore();
    return undefined;
  });
  return new GitHubPluginCatalog("test-only-token");
}

describe("GitHub plugin bundles", () => {
  test("reuses pinned tree metadata during a batch but refreshes branch discovery", async () => {
    const catalog = fixture();
    const source = await catalog.discover("team/catalog");
    const spy = global.fetch as unknown as { mock: { calls: [string][] } };
    const count = () =>
      spy.mock.calls.filter(([url]) => String(url).includes("/git/trees/")).length;
    expect(count()).toBe(1);
    await catalog.bundle(source.repo, source.commit, source.assets[0].path);
    expect(count()).toBe(1);
    await catalog.discover("team/catalog");
    expect(count()).toBe(2);
  });
  test("preserves concurrent imports and rejects duplicate activation paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibe-registry-concurrent-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const registry = new SkillRegistryService(root);
    const bundle = (name: string) => ({
      repo: "team/catalog",
      commit,
      path: `skills/${name}/SKILL.md`,
      files: [
        {
          path: "SKILL.md",
          content: new TextEncoder().encode(`---\nname: ${name}\n---\nInstructions`),
        },
      ],
    });
    await Promise.all([registry.stageBundle(bundle("one")), registry.stageBundle(bundle("two"))]);
    expect((await registry.listInstalled()).map((item) => item.name).sort()).toEqual([
      "one",
      "two",
    ]);
    await expect(registry.stageBundle(bundle("ONE"))).rejects.toThrow("já foi importado");
    await expect(registry.stageBundle(bundle("CON"))).rejects.toThrow("Nome de plugin inválido");
    await Promise.all([registry.approve("skill:one"), registry.approve("skill:two")]);
    expect((await registry.listInstalled()).every((item) => item.reviewStatus === "active")).toBe(
      true
    );
  });
  test("explains exhausted GitHub quota without exposing credentials", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("rate limit", { status: 403, headers: { "x-ratelimit-remaining": "0" } })
    );
    try {
      await expect(new GitHubPluginCatalog().discover("team/catalog")).rejects.toThrow(
        "Limite de consultas"
      );
    } finally {
      spy.mockRestore();
    }
  });
  test("resolves the default branch, pins the commit, reviews and injects the complete skill", async () => {
    const catalog = fixture();
    const source = await catalog.discover("https://github.com/team/catalog");
    expect(source.ref).toBe("master");
    expect(source.commit).toBe(commit);
    expect(source.assets).toEqual([
      { name: "ui", path: ".agents/skills/ui/SKILL.md", category: "skill", files: 2 },
    ]);
    const root = await mkdtemp(join(tmpdir(), "vibe-plugin-bundle-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const registry = new SkillRegistryService(root);
    const bundle = await catalog.bundle(source.repo, source.commit, source.assets[0].path);
    const staged = await registry.stageBundle(bundle);
    expect(staged.reviewStatus).toBe("pending_review");
    expect((await new SkillsLoader(root).load()).skills.some((skill) => skill.name === "ui")).toBe(
      false
    );
    expect(await registry.content(staged.id)).toContain("Read references/layout.md");
    const active = await registry.approve(staged.id);
    expect(await readFile(join(root, "registry/skills/ui/references/layout.md"), "utf8")).toBe(
      "Verified layout reference."
    );
    expect((await new SkillsLoader(root).load()).skills.some((skill) => skill.name === "ui")).toBe(
      true
    );
    const workspace = await mkdtemp(join(tmpdir(), "vibe-plugin-workspace-"));
    cleanups.push(() => rm(workspace, { recursive: true, force: true }));
    const plugin = await installAgentPlugin(
      workspace,
      "opencode",
      ["ui"],
      [{ name: "ui", filePath: active.filePath }]
    );
    expect(plugin.missing).toEqual([]);
    expect(await readFile(join(workspace, ".opencode/skill/ui/references/layout.md"), "utf8")).toBe(
      "Verified layout reference."
    );
    await expect(registry.stageBundle(bundle)).rejects.toThrow("já foi importado");
    await registry.uninstall(active.id);
    expect(await registry.listInstalled()).toEqual([]);
    expect((await new SkillsLoader(root).load()).skills.some((skill) => skill.name === "ui")).toBe(
      false
    );
  });
  test("rejects untrusted paths, off-host URLs and unsafe metadata names", async () => {
    expect(() => githubRepo("https://example.com/team/catalog")).toThrow("owner/repo");
    expect(safeAssetPath("../../outside")).toBe(false);
    expect(safeAssetPath("C:\\outside")).toBe(false);
    const root = await mkdtemp(join(tmpdir(), "vibe-plugin-invalid-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const registry = new SkillRegistryService(root);
    await expect(
      registry.stageBundle({
        repo: "team/catalog",
        commit,
        path: "bad/SKILL.md",
        files: [
          {
            path: "SKILL.md",
            content: new TextEncoder().encode("---\nname: ../../outside\n---\nbody"),
          },
        ],
      })
    ).rejects.toThrow("Nome de plugin inválido");
    expect(await registry.listInstalled()).toEqual([]);
  });
  test("rejects truncated trees and oversized or failed downloads", async () => {
    await expect(fixture({ truncated: true }).discover("team/catalog")).rejects.toThrow("truncado");
  });
  test("rejects oversized bundles before downloading files", async () => {
    await expect(
      fixture({ large: true }).bundle("team/catalog", commit, ".agents/skills/ui/SKILL.md")
    ).rejects.toThrow("limite");
  });
  test("reports GitHub access errors without installing content", async () => {
    await expect(
      fixture({ failure: true }).bundle("team/catalog", commit, ".agents/skills/ui/SKILL.md")
    ).rejects.toThrow("GitHub respondeu 403");
  });
});
