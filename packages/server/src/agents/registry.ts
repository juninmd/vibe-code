import type { EngineInfo } from "@vibe-code/shared";
import type { AgentEngine } from "./engine";
import { AiderEngine } from "./engines/aider";
import { AmpCodeEngine } from "./engines/ampcode";
import { ClaudeCodeEngine } from "./engines/claude-code";
import { CodexEngine } from "./engines/codex";
import { CopilotEngine } from "./engines/copilot";
import { CursorAgentEngine } from "./engines/cursor-agent";
import { GeminiEngine } from "./engines/gemini";
import { HermesEngine } from "./engines/hermes";
import { KimiEngine } from "./engines/kimi";
import { KiroCliEngine } from "./engines/kiro-cli";
import { OpenClawEngine } from "./engines/openclaw";
import { OpenCodeEngine } from "./engines/opencode";
import { PiEngine } from "./engines/pi";

export class EngineRegistry {
  private engines: Map<string, AgentEngine> = new Map();
  private versionCache: Map<string, string | null> = new Map();
  private versionFetchInFlight: Map<string, Promise<string | null>> = new Map();

  constructor() {
    this.register(new ClaudeCodeEngine());
    this.register(new AiderEngine());
    this.register(new OpenCodeEngine());
    this.register(new GeminiEngine());
    this.register(new CopilotEngine());
    this.register(new CodexEngine());
    this.register(new PiEngine());
    this.register(new CursorAgentEngine());
    this.register(new OpenClawEngine());
    this.register(new HermesEngine());
    this.register(new AmpCodeEngine());
    this.register(new KimiEngine());
    this.register(new KiroCliEngine());
  }

  register(engine: AgentEngine): void {
    this.engines.set(engine.name, engine);
  }

  get(name: string): AgentEngine | undefined {
    return this.engines.get(name);
  }

  async getFirstAvailable(): Promise<AgentEngine | undefined> {
    for (const engine of this.engines.values()) {
      if (await engine.isAvailable()) return engine;
    }
    return undefined;
  }

  async listEngines(activeRuns?: Map<string, string>): Promise<EngineInfo[]> {
    const results = await Promise.all(
      Array.from(this.engines.values()).map(async (engine) => {
        const withTimeout = <T>(p: Promise<T>, fallback: T, ms = 15000): Promise<T> =>
          Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
        // Use Bun.which() for fast binary check — avoids process spawns that
        // exhaust CPU in resource-constrained containers (50m limit).
        const availabilityCheck: Promise<boolean> = engine.binaryName
          ? Promise.resolve(Bun.which(engine.binaryName) !== null)
          : withTimeout(
              engine.isAvailable().catch(() => false),
              false
            );
        // Version: return cached value instantly; fetch in background on first call.
        const versionCheck: Promise<string | null> = (() => {
          if (!engine.getVersion) return Promise.resolve(null);
          if (this.versionCache.has(engine.name)) {
            return Promise.resolve(this.versionCache.get(engine.name) ?? null);
          }
          if (!this.versionFetchInFlight.has(engine.name)) {
            const fetch = withTimeout(
              engine.getVersion().catch(() => null),
              null
            ).then((v) => {
              this.versionCache.set(engine.name, v);
              this.versionFetchInFlight.delete(engine.name);
              return v;
            });
            this.versionFetchInFlight.set(engine.name, fetch);
          }
          // Return null immediately; version appears on next poll after fetch completes.
          return Promise.resolve(null);
        })();
        const [available, setupIssue, version] = await Promise.all([
          availabilityCheck,
          engine.getSetupIssue
            ? withTimeout(
                engine.getSetupIssue().catch(() => null),
                null
              )
            : Promise.resolve(null),
          versionCheck,
        ]);
        let runCount = 0;
        if (activeRuns) {
          for (const eng of activeRuns.values()) {
            if (eng === engine.name) runCount++;
          }
        }
        return {
          name: engine.name,
          displayName: engine.displayName,
          available,
          version,
          activeRuns: runCount,
          setupIssue,
        } satisfies EngineInfo;
      })
    );
    return results;
  }

  async listModels(engineName: string): Promise<string[]> {
    const engine = this.engines.get(engineName);
    if (!engine) return [];
    return engine.listModels();
  }

  /** Returns the first free model available for an engine (models ending in "-free" or containing "free"). */
  async getDefaultFreeModel(engineName: string): Promise<string | null> {
    const engine = this.engines.get(engineName);
    if (!engine) return null;
    try {
      const models = await engine.listModels();
      return models.find((m) => m.toLowerCase().includes("free")) ?? null;
    } catch {
      return null;
    }
  }
}
