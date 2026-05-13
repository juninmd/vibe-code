import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runAgentCycle } from "./sidecar-agent";
import { initSidecarDb } from "./sidecar-db";

export interface SidecarConfig {
  serverUrl: string;
  intervalMinutes: number;
  provider: "openrouter" | "ollama";
  model?: string;
  ollamaBaseUrl?: string;
  repos: Array<{ url: string; enabled: boolean }>;
}

function readConfig(path?: string): SidecarConfig {
  const configPath = path ?? join(import.meta.dir, "sidecar.config.json");
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as SidecarConfig;
}

async function runCycle(
  config: SidecarConfig,
  db: ReturnType<typeof initSidecarDb>
): Promise<void> {
  const repoUrls = config.repos.filter((r) => r.enabled).map((r) => r.url);
  try {
    await runAgentCycle(config, db, repoUrls);
  } catch (err) {
    console.error("[sidecar] Cycle error:", err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  const db = initSidecarDb(join(homedir(), ".vibe-code", "sidecar.db"));

  console.log(
    `[sidecar] Starting — provider=${config.provider} model=${config.model ?? "default"} interval=${config.intervalMinutes}m`
  );

  await runCycle(config, db);

  const intervalMs = config.intervalMinutes * 60 * 1000;
  setInterval(() => runCycle(config, db), intervalMs);
}

main().catch((err) => {
  console.error("[sidecar] Fatal:", err);
  process.exit(1);
});
