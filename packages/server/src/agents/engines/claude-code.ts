import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillPayload } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";

export class ClaudeCodeEngine implements AgentEngine {
  name = "claude-code";
  displayName = "Claude Code";
  private processes = new Map<string, Subprocess>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<string[]> {
    // Return Anthropic models available in LiteLLM (auto-routed via ANTHROPIC_API_KEY).
    const all = await listLiteLLMModels(getLiteLLMBaseUrl());
    // Filter to models that go to Anthropic: prefixed with anthropic/ or named claude-*
    return all.filter((m) => m.startsWith("anthropic/") || m.startsWith("claude-"));
  }

  async prepareWorkdir(workdir: string, skills: SkillPayload): Promise<string[]> {
    const sections: string[] = [];

    if (skills.projectInstructions) {
      sections.push(`## Project Instructions\n\n${skills.projectInstructions}`);
    }

    if (skills.rules.length > 0) {
      sections.push("## Coding Standards\n");
      for (const rule of skills.rules) {
        sections.push(`### ${rule.name}\n${rule.content || rule.description}`);
      }
    }

    if (skills.skills.length > 0) {
      sections.push("## Skills\n");
      for (const skill of skills.skills) {
        sections.push(`### ${skill.name}\n${skill.content || skill.description}`);
      }
    }

    if (skills.agents.length > 0) {
      sections.push("## Agent Personas\n");
      for (const agent of skills.agents) {
        sections.push(`### ${agent.name}\n${agent.content || agent.description}`);
      }
    }

    if (sections.length === 0) return [];

    const claudeDir = join(workdir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    const instructionsFile = join(claudeDir, "instructions.md");
    await writeFile(instructionsFile, sections.join("\n\n"), "utf8");
    return [instructionsFile];
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[claude-code] Starting in ${workdir}` };

    const args = ["claude", "--print", "--verbose", "--output-format", "stream-json"];
    if (options.model) args.push("--model", options.model);
    args.push("-p", prompt);

    // When LiteLLM is enabled, route through the proxy using a virtual key.
    // Otherwise, prefer the DB-stored native key, then fall back to process.env.
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.litellmKey) {
      env.ANTHROPIC_BASE_URL = options.litellmBaseUrl;
      env.ANTHROPIC_API_KEY = options.litellmKey;
    } else if (options.nativeApiKeys?.anthropic) {
      env.ANTHROPIC_API_KEY = options.nativeApiKeys.anthropic;
    }

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env,
    });

    if (options.runId) this.processes.set(options.runId, proc);

    yield* streamProcess(
      proc,
      (line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "assistant" && parsed.content) {
            const events: AgentEvent[] = [];
            for (const block of parsed.content) {
              if (block.type === "text") {
                events.push({ type: "log", stream: "stdout", content: block.text });
              } else if (block.type === "tool_use") {
                events.push({
                  type: "log",
                  stream: "system",
                  content: `[tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`,
                });
              }
            }
            return events;
          }
          return [];
        } catch {
          return [{ type: "log", stream: "stdout", content: line }];
        }
      },
      options.signal
    );

    if (options.runId) this.processes.delete(options.runId);
  }

  abort(runId: string): void {
    const proc = this.processes.get(runId);
    if (proc) {
      proc.kill();
      this.processes.delete(runId);
    }
  }

  sendInput(runId: string, input: string): boolean {
    const proc = this.processes.get(runId);
    if (!proc?.stdin || typeof proc.stdin === "number") return false;
    try {
      const sink = proc.stdin as import("bun").FileSink;
      sink.write(`${input}\n`);
      sink.flush();
      return true;
    } catch {
      return false;
    }
  }
}
