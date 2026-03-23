import type { AgentEngine } from "./engine";
import type { EngineInfo } from "@vibe-code/shared";
import { ClaudeCodeEngine } from "./engines/claude-code";
import { AiderEngine } from "./engines/aider";
import { OpenCodeEngine } from "./engines/opencode";
import { GeminiEngine } from "./engines/gemini";

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
}
