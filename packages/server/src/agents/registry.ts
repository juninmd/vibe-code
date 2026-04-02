import type { EngineInfo } from "@vibe-code/shared";
import type { AgentEngine } from "./engine";
import { AiderEngine } from "./engines/aider";
import { ClaudeCodeEngine } from "./engines/claude-code";
import { GeminiEngine } from "./engines/gemini";
import { OpenCodeEngine } from "./engines/opencode";

export class EngineRegistry {
  private engines: Map<string, AgentEngine> = new Map();

  constructor() {
    this.register(new ClaudeCodeEngine());
    this.register(new AiderEngine());
    this.register(new OpenCodeEngine());
    this.register(new GeminiEngine());
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
        const available = await engine.isAvailable().catch(() => false);
        let version: string | null = null;
        if (available && engine.getVersion) {
          version = await Promise.race<string | null>([
            engine.getVersion().catch(() => null),
            new Promise<null>((res) => setTimeout(() => res(null), 3000)),
          ]);
        }
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
}
