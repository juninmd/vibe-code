import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { parseAcpMessage } from "../acp-parser";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

/**
 * Default model for OpenCode when no model is specified.
 * Uses the LiteLLM auto-routing format: provider/model-name.
 */
export const DEFAULT_OPENCODE_MODEL = "anthropic/claude-sonnet-4-5";

export class OpenCodeEngine implements AgentEngine {
  name = "opencode";
  displayName = "OpenCode";
  private processes = new Map<string, Subprocess>();

  /** Heartbeat interval (ms). Overridable in tests via constructor arg or VIBE_CODE_HEARTBEAT_MS. */
  protected heartbeatIntervalMs: number;

  constructor(heartbeatIntervalMs?: number) {
    this.heartbeatIntervalMs = heartbeatIntervalMs ?? getHeartbeatIntervalMs();
  }

  /**
   * Returns the CLI command to spawn.
   * Override in tests to inject a fake subprocess.
   * Prompt is sent via stdin to avoid Windows command-line length limits.
   */
  protected buildCommand(model: string, workdir: string, resumeSessionId?: string): string[] {
    const args = ["opencode", "acp", "--model", model, "--dir", workdir];
    if (resumeSessionId) args.push("--session", resumeSessionId);
    return args;
  }

  protected getStdinMode(): "pipe" | "ignore" {
    return "pipe";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["opencode", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["opencode", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<string[]> {
    return listLiteLLMModels(getLiteLLMBaseUrl());
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    const model = options.model ?? DEFAULT_OPENCODE_MODEL;
    yield {
      type: "log",
      stream: "system",
      content: `[opencode] Starting in ${workdir} (model: ${model})`,
    };

    // Write opencode.json with permissions pre-configured for non-interactive mode.
    const configPath = join(workdir, "opencode.json");
    const config: Record<string, any> = {
      permission: {
        "*": "allow",
        question: "allow",
        plan_enter: "allow",
        plan_exit: "allow",
      },
    };

    if (options.litellmKey) {
      config.providers = [
        {
          id: "anthropic",
          name: "Anthropic (via LiteLLM)",
          apiUrl: options.litellmBaseUrl,
          apiKey: options.litellmKey,
        },
        {
          id: "openai",
          name: "OpenAI (via LiteLLM)",
          apiUrl: `${options.litellmBaseUrl}/v1`,
          apiKey: options.litellmKey,
        },
        {
          id: "google",
          name: "Google (via LiteLLM)",
          apiUrl: options.litellmBaseUrl,
          apiKey: options.litellmKey,
        },
      ];
    } else if (
      options.nativeApiKeys?.anthropic ||
      options.nativeApiKeys?.openai ||
      options.nativeApiKeys?.gemini
    ) {
      config.providers = [];
      if (options.nativeApiKeys.anthropic)
        config.providers.push({
          id: "anthropic",
          name: "Anthropic",
          apiKey: options.nativeApiKeys.anthropic,
        });
      if (options.nativeApiKeys.openai)
        config.providers.push({
          id: "openai",
          name: "OpenAI",
          apiKey: options.nativeApiKeys.openai,
        });
      if (options.nativeApiKeys.gemini)
        config.providers.push({
          id: "google",
          name: "Google",
          apiKey: options.nativeApiKeys.gemini,
        });
    }

    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

    const proc = Bun.spawn(this.buildCommand(model, workdir, options.resumeSessionId), {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: this.getStdinMode(),
    });

    if (this.getStdinMode() === "pipe" && proc.stdin) {
      try {
        const sink = proc.stdin as import("bun").FileSink;
        sink.write(prompt);
        sink.flush();
        sink.end();
      } catch {
        // stdin may already be closed
      }
    }

    if (process.platform === "win32") {
      // Close stdin immediately on Windows to send EOF — prevents deadlocks
      // while letting OpenCode know there's no more user input.
      try {
        proc.stdin?.end();
      } catch {
        // stdin may already be closed
      }
      yield {
        type: "log",
        stream: "system",
        content: "[opencode] stdin closed (Windows: non-interactive mode)",
      };
    }

    if (options.runId) this.processes.set(options.runId, proc);
    if (options.signal) {
      options.signal.addEventListener("abort", () => proc.kill());
    }

    yield* withHeartbeat(
      streamProcess(proc, (line) => parseAcpMessage(line), options.signal),
      getHeartbeatIntervalMs(),
      options.signal
    );

    const exitCode = await proc.exited;

    if (options.runId) this.processes.delete(options.runId);

    // Cleanup temp files — don't include in git commits
    try {
      await rm(configPath);
    } catch {
      /* best effort */
    }

    if (exitCode !== 0) {
      yield { type: "log", stream: "stderr", content: `[process] Exited with code ${exitCode}` };
    }
    yield { type: "complete", exitCode: exitCode ?? 0 };
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
