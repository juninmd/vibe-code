import type { RegistryAssetRecord, RemotePluginCatalog } from "@vibe-code/shared";
import { describe, expect, it, vi } from "vitest";
import { importRemoteSkills, type SkillImportProgress, uniqueRemoteSkills } from "./importSkills";

const asset = (
  name: string,
  path = `.agents/skills/${name}/SKILL.md`
): RemotePluginCatalog["assets"][number] => ({ name, path, category: "skill", files: 2 });
const record = (
  name: string,
  reviewStatus: RegistryAssetRecord["reviewStatus"] = "pending_review"
): RegistryAssetRecord => ({
  id: `skill:${name}`,
  name,
  category: "skill",
  reviewStatus,
  sourceRepo: "team/skills",
  sourceRef: "a".repeat(40),
  sourceUrl: `https://raw.githubusercontent.com/team/skills/main/${name}/SKILL.md`,
  filePath: `/registry/${name}/SKILL.md`,
  checksum: "fixture",
  installedAt: "2026-10-20T00:00:00Z",
  reviewedAt: null,
});
const catalog = (assets: RemotePluginCatalog["assets"]): RemotePluginCatalog => ({
  repo: "team/skills",
  ref: "master",
  commit: "a".repeat(40),
  assets,
});

describe("bulk remote skill import", () => {
  it("imports each skill once and prefers its canonical source over contextual copies", () => {
    const canonical = asset("ui");
    expect(
      uniqueRemoteSkills([
        asset("ui", "plugins/web/skills/ui/SKILL.md"),
        { ...asset("review"), category: "agent" },
        canonical,
        asset("tests"),
      ])
    ).toEqual([canonical, asset("tests")]);
  });

  it("preserves existing imports, retries rejected skills and continues after an individual failure", async () => {
    const importSkill = vi.fn(async (_repo: string, _commit: string, path: string) => {
      const parts = path.split("/");
      const name = parts[parts.length - 2] ?? "";
      if (name === "broken") throw new Error("GitHub respondeu 403.");
      return record(name);
    });
    const progress: SkillImportProgress[] = [];
    const result = await importRemoteSkills({
      catalog: catalog([asset("existing"), asset("rejected"), asset("broken"), asset("next")]),
      installed: [record("existing", "active"), record("rejected", "rejected")],
      importSkill,
      shouldStop: () => false,
      onProgress: (value) => progress.push(value),
    });
    expect(importSkill.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      Array.from({ length: 3 }, () => ["team/skills", "a".repeat(40)])
    );
    expect(result.results.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: "existing", status: "skipped" },
      { name: "rejected", status: "imported" },
      { name: "broken", status: "failed" },
      { name: "next", status: "imported" },
    ]);
    expect(result.results[2].message).toBe("GitHub respondeu 403.");
    expect(result.stopped).toBe(false);
    expect(progress[progress.length - 1]).toEqual(result);
  });

  it("stops between imports while retaining completed work", async () => {
    let stop = false;
    const importSkill = vi.fn(async () => {
      stop = true;
      return record("first");
    });
    const result = await importRemoteSkills({
      catalog: catalog([asset("first"), asset("second")]),
      installed: [],
      importSkill,
      shouldStop: () => stop,
      onProgress: () => {},
    });
    expect(importSkill).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      total: 2,
      stopped: true,
      current: null,
      results: [{ name: "first", status: "imported" }],
    });
  });

  it("does not replace active or pending skills when the bulk action is repeated", async () => {
    const importSkill = vi.fn();
    const result = await importRemoteSkills({
      catalog: catalog([asset("active"), asset("pending")]),
      installed: [record("active", "active"), record("pending")],
      importSkill,
      shouldStop: () => false,
      onProgress: () => {},
    });
    expect(importSkill).not.toHaveBeenCalled();
    expect(result.results.every((item) => item.status === "skipped")).toBe(true);
  });
});
