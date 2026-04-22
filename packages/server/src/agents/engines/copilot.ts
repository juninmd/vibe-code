import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillPayload } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

// Known Copilot-compatible models (static list — no CLI command to list them)
const COPILOT_MODELS = [
  "gpt-4.1",
  "gpt-4o",
  "o3",
  "o4-mini",
  "o3-mini",
  "claude-3.5-sonnet",
  "claude-3.7-sonnet",
  "gemini-2.0-flash",
];

export class CopilotEngine implements AgentEngine {
  name = "copilot";
  displayName = "GitHub Copilot";
  private processes = new Map<string, Subprocess>();
  private _binPath: string | null = null;

  /**
   * Locate the Copilot CLI binary.
   * Order: COPILOT_CLI_PATH env → npm global root → PATH fallback.
   */
  private getCopilotBinPath(): string {
    if (this._binPath !== null) return this._binPath;
    if (process.env.COPILOT_CLI_PATH) {
      this._binPath = process.env.COPILOT_CLI_PATH;
      return this._binPath;
    }
    try {
      const npmRoot = execSync("npm root -g", { encoding: "utf-8", timeout: 5000 }).trim();
      this._binPath = join(npmRoot, "@github", "copilot-sdk", "node_modules", ".bin", "copilot");
    } catch {
      this._binPath = "copilot";
    }
    return this._binPath;
  }

  private buildChildEnv(nativeOpenAiKey?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    // Prefer the DB-stored OpenAI key; GitHub token flows through COPILOT_GITHUB_TOKEN
    if (nativeOpenAiKey) {
      env.OPENAI_API_KEY = nativeOpenAiKey;
    }
    return env;
  }

  private parseLine(line: string): AgentEvent[] {
    // Try to parse stream-json / JSONL output
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not JSON — emit as raw log
      return [{ type: "log", stream: "stdout", content: line }];
    }

    if (!parsed || typeof parsed !== "object") {
      return [{ type: "log", stream: "stdout", content: line }];
    }

    const obj = parsed as Record<string, unknown>;

    // Error event
    if (obj.error || obj.type === "error") {
      const errMsg =
        typeof obj.error === "string"
          ? obj.error
          : typeof obj.message === "string"
            ? obj.message
            : JSON.stringify(obj.error ?? obj);
      return [
        { type: "log", stream: "stderr", content: `[copilot] ${errMsg}` },
        { type: "error", content: errMsg },
      ];
    }

    // Tool use
    if (obj.type === "tool_use" || obj.type === "tool_call") {
      const name =
        typeof obj.name === "string"
          ? obj.name
          : typeof obj.function === "object" && obj.function !== null
            ? (obj.function as Record<string, unknown>).name
            : "tool";
      return [{ type: "log", stream: "system", content: `[tool] ${name}` }];
    }

    // Text / message content
    const text =
      typeof obj.text === "string"
        ? obj.text
        : typeof obj.content === "string"
          ? obj.content
          : Array.isArray(obj.content)
            ? obj.content
                .filter((b: unknown) => typeof (b as Record<string, unknown>)?.text === "string")
                .map((b: unknown) => (b as Record<string, string>).text)
                .join("")
            : typeof obj.message === "string"
              ? obj.message
              : null;

    if (text) {
      return [{ type: "log", stream: "stdout", content: text }];
    }

    // Generic debug log for unrecognised events
    return [{ type: "log", stream: "system", content: line }];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const bin = this.getCopilotBinPath();
      const proc = Bun.spawn([bin, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const bin = this.getCopilotBinPath();
      const proc = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async getSetupIssue(): Promise<string | null> {
    if (!(await this.isAvailable())) {
      return "Copilot CLI não instalado — instale @github/copilot-sdk globalmente (npm install -g @github/copilot-sdk)";
    }
    const hasToken =
      process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!hasToken) {
      return "COPILOT_GITHUB_TOKEN não configurado — adicione ao .env ou use BYOK (COPILOT_CLI_PATH)";
    }
    return null;
  }

  async listModels(): Promise<string[]> {
    return COPILOT_MODELS;
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    const bin = this.getCopilotBinPath();
    yield { type: "log", stream: "system", content: `[copilot] Starting in ${workdir}` };
    yield {
      type: "log",
      stream: "system",
      content: `[copilot] bin=${bin} model=${options.model ?? "default"}`,
    };

    const args = [
      bin,
      "--allow-all",
      "--output-format",
      "json",
      "--add-dir",
      workdir,
      "-p",
      prompt,
    ];
    if (options.model) args.push("--model", options.model);

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: this.buildChildEnv(options.nativeApiKeys?.openai),
    });

    if (options.runId) this.processes.set(options.runId, proc);

    yield* withHeartbeat(
      streamProcess(proc, (line) => this.parseLine(line), options.signal),
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
