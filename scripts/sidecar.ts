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
  const base = JSON.parse(raw) as SidecarConfig;

  // Env vars override file config — allows cluster/Docker deployment without rebuilding image
  if (process.env.VIBE_SERVER_URL) base.serverUrl = process.env.VIBE_SERVER_URL;
  if (process.env.SIDECAR_INTERVAL_MINUTES) base.intervalMinutes = Number(process.env.SIDECAR_INTERVAL_MINUTES);
  if (process.env.SIDECAR_PROVIDER) base.provider = process.env.SIDECAR_PROVIDER as SidecarConfig["provider"];
  if (process.env.SIDECAR_MODEL) base.model = process.env.SIDECAR_MODEL;
  if (process.env.OLLAMA_BASE_URL) base.ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
  // SIDECAR_REPOS: comma-separated URLs to override repo list
  if (process.env.SIDECAR_REPOS) {
    base.repos = process.env.SIDECAR_REPOS.split(",").map((u) => ({ url: u.trim(), enabled: true }));
  }

  return base;
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
