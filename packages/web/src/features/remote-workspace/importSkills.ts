import type { RegistryAssetRecord, RemotePluginCatalog } from "@vibe-code/shared";

type Asset = RemotePluginCatalog["assets"][number];
export interface SkillImportResult {
  name: string;
  path: string;
  status: "imported" | "skipped" | "failed";
  message: string;
}
export interface SkillImportProgress {
  total: number;
  results: SkillImportResult[];
  current: string | null;
  stopped: boolean;
}

/** Contextual plugin bundles may repeat the same skill. Prefer the canonical directory. */
export function uniqueRemoteSkills(assets: Asset[]): Asset[] {
  const skills = new Map<string, Asset>();
  for (const asset of assets) {
    if (asset.category !== "skill") continue;
    const previous = skills.get(asset.name);
    if (
      !previous ||
      (asset.path.startsWith(".agents/skills/") && !previous.path.startsWith(".agents/skills/"))
    )
      skills.set(asset.name, asset);
  }
  return [...skills.values()];
}

export async function importRemoteSkills({
  catalog,
  installed,
  importSkill,
  shouldStop,
  onProgress,
}: {
  catalog: RemotePluginCatalog;
  installed: RegistryAssetRecord[];
  importSkill: (repo: string, commit: string, path: string) => Promise<RegistryAssetRecord>;
  shouldStop: () => boolean;
  onProgress: (progress: SkillImportProgress) => void;
}): Promise<SkillImportProgress> {
  const skills = uniqueRemoteSkills(catalog.assets);
  const known = new Set(
    installed
      .filter((record) => record.category === "skill" && record.reviewStatus !== "rejected")
      .map((record) => record.name)
  );
  const results: SkillImportResult[] = [];
  for (const skill of skills) {
    if (shouldStop()) break;
    onProgress({
      total: skills.length,
      results: [...results],
      current: skill.name,
      stopped: false,
    });
    if (known.has(skill.name)) {
      results.push({
        name: skill.name,
        path: skill.path,
        status: "skipped",
        message: "Já importada no ambiente.",
      });
    } else {
      try {
        // Sequential writes preserve the registry manifest and keep GitHub concurrency bounded.
        const record = await importSkill(catalog.repo, catalog.commit, skill.path);
        known.add(record.name);
        results.push({
          name: skill.name,
          path: skill.path,
          status: "imported",
          message: "Importada para revisão.",
        });
      } catch (error) {
        results.push({
          name: skill.name,
          path: skill.path,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const progress = {
    total: skills.length,
    results,
    current: null,
    stopped: results.length < skills.length,
  };
  onProgress(progress);
  return progress;
}
