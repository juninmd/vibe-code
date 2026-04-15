import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillPayload } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

export class AiderEngine implements AgentEngine {
  name = "aider";
  displayName = "Aider";
  private processes = new Map<string, Subprocess>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["aider", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["aider", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<string[]> {
    // Aider supports any OpenAI-compatible model. Return everything LiteLLM knows.
    return listLiteLLMModels(getLiteLLMBaseUrl());
  }

  async prepareWorkdir(workdir: string, skills: SkillPayload): Promise<string[]> {
    const created: string[] = [];
    const contextDir = join(workdir, ".vibe-code", ".context");
    await mkdir(contextDir, { recursive: true });

    // Write each skill/rule as a separate file for --read
    const readFiles: string[] = [];

    if (skills.projectInstructions) {
      const f = join(contextDir, "project-instructions.md");
      await writeFile(f, skills.projectInstructions, "utf8");
      created.push(f);
      readFiles.push(f);
    }

    for (const rule of skills.rules) {
      if (!rule.content) continue;
      const f = join(contextDir, `rule-${rule.name}.md`);
      await writeFile(f, `# ${rule.name}\n\n${rule.content}`, "utf8");
      created.push(f);
      readFiles.push(f);
    }

    for (const skill of skills.skills) {
      if (!skill.content) continue;
      const f = join(contextDir, `skill-${skill.name}.md`);
      await writeFile(f, `# ${skill.name}\n\n${skill.content}`, "utf8");
      created.push(f);
      readFiles.push(f);
    }

    if (readFiles.length === 0) return [];

    // Write .aider.conf.yml with read references
    const yamlLines = readFiles.map((f) => `  - ${f}`);
    const confContent = `read:\n${yamlLines.join("\n")}\n`;
    const confFile = join(workdir, ".aider.conf.yml");
    await writeFile(confFile, confContent, "utf8");
    created.push(confFile);

    return created;
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[aider] Starting in ${workdir}` };

    const args = ["aider", "--yes-always", "--no-auto-commits"];
    if (options.model) args.push("--model", options.model);
    args.push("--message", prompt);

    // When LiteLLM is enabled, route through the proxy and strip native keys.
    // Otherwise, prefer DB-stored native keys; fall back to host env vars.
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.litellmKey) {
      delete env.ANTHROPIC_API_KEY;
      delete env.GEMINI_API_KEY;
      env.OPENAI_API_KEY = options.litellmKey;
      env.OPENAI_API_BASE = `${options.litellmBaseUrl}/v1`;
    } else {
      if (options.nativeApiKeys?.openai) env.OPENAI_API_KEY = options.nativeApiKeys.openai;
      if (options.nativeApiKeys?.anthropic) env.ANTHROPIC_API_KEY = options.nativeApiKeys.anthropic;
      if (options.nativeApiKeys?.gemini) env.GEMINI_API_KEY = options.nativeApiKeys.gemini;
    }

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env,
    });

    if (options.runId) this.processes.set(options.runId, proc);

    yield* withHeartbeat(
      streamProcess(
        proc,
        (line) => {
          return [{ type: "log", stream: "stdout", content: line }];
        },
        options.signal
      ),
      getHeartbeatIntervalMs(),
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
