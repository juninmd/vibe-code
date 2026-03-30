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

  async listEngines(): Promise<EngineInfo[]> {
    const results: EngineInfo[] = [];
    for (const engine of this.engines.values()) {
      results.push({
        name: engine.name,
        displayName: engine.displayName,
        available: await engine.isAvailable(),
      });
    }
    return results;
  }

  async listModels(engineName: string): Promise<string[]> {
    const engine = this.engines.get(engineName);
    if (!engine) return [];
    return engine.listModels();
  }
}
