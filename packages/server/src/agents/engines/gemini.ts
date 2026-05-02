import { access, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { SkillPayload } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import { parseAcpMessage } from "../acp-parser";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

export class GeminiEngine implements AgentEngine {
  name = "gemini";
  displayName = "Gemini CLI";
  private processes = new Map<string, Subprocess>();
  private geminiCommand: string | null | undefined;
  private cachedModels: string[] | null = null;
  private lastFetch = 0;

  private buildGeminiChildEnv(
    litellmKey?: string,
    litellmBaseUrl?: string,
    nativeGeminiKey?: string,
    geminiBinDir?: string,
    extraEnv?: Record<string, string>
  ): NodeJS.ProcessEnv {
    const env = { ...process.env, ...extraEnv };
    if (geminiBinDir) {
      env.PATH = env.PATH ? `${geminiBinDir}${delimiter}${env.PATH}` : geminiBinDir;
    }
    // Avoid Gemini IDE client binding when running in detached task worktrees.
    const keysToDelete = [
      "GEMINI_CLI_IDE_SERVER_PORT",
      "GEMINI_CLI_IDE_WORKSPACE_PATH",
      "GEMINI_CLI_IDE_AUTH_TOKEN",
      "TERM_PROGRAM",
      "VSCODE_INJECTION",
      "VSCODE_GIT_ASKPASS_NODE",
      "VSCODE_GIT_ASKPASS_EXTRA_ARGS",
      "VSCODE_GIT_ASKPASS_MAIN",
      "VSCODE_GIT_IPC_HANDLE",
    ];
    keysToDelete.forEach((key) => {
      delete env[key];
    });
    // When LiteLLM is enabled, route through the proxy.
    // Otherwise, prefer the DB-stored native key, then fall back to process.env.
    if (litellmKey) {
      env.GOOGLE_GEMINI_BASE_URL = litellmBaseUrl;
      env.GEMINI_API_KEY = litellmKey;
    } else if (nativeGeminiKey) {
      env.GEMINI_API_KEY = nativeGeminiKey;
    }
    return env;
  }

  private async resolveGeminiCommand(): Promise<string | null> {
    if (this.geminiCommand !== undefined) return this.geminiCommand;

    if (process.platform !== "win32") {
      this.geminiCommand = "gemini";
      return this.geminiCommand;
    }

    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    const npmGlobalBin = join(appData, "npm");
    const candidates = [
      join(npmGlobalBin, "gemini.cmd"),
      join(npmGlobalBin, "gemini.exe"),
      join(npmGlobalBin, "gemini"),
      "gemini.cmd",
      "gemini.exe",
      "gemini",
    ];

    for (const candidate of candidates) {
      try {
        if (candidate.includes("\\") || candidate.includes("/")) {
          await access(candidate);
        }
        this.geminiCommand = candidate;
        return candidate;
      } catch {
        // Try next candidate.
      }
    }

    this.geminiCommand = null;
    return null;
  }

  private async hasCli(): Promise<boolean> {
    try {
      const command = await this.resolveGeminiCommand();
      if (!command) return false;
      const proc = Bun.spawn([command, "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return true;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.hasCli();
  }

  async getVersion(): Promise<string | null> {
    try {
      const command = await this.resolveGeminiCommand();
      if (!command) return null;
      const proc = Bun.spawn([command, "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<string[]> {
    if (this.cachedModels && Date.now() - this.lastFetch < 3600000) {
      return this.cachedModels;
    }

    const command = await this.resolveGeminiCommand();
    let models: string[] = [];

    if (command) {
      try {
        // As requested by user: gemini displays models with /models command.
        // We use a prompt that triggers this output in the CLI.
        const proc = Bun.spawn([command, "-p", "/models", "--raw-output"], {
          stdout: "pipe",
          stderr: "pipe",
          env: this.buildGeminiChildEnv(),
        });
        await proc.exited;
        if (proc.exitCode === 0) {
          const text = await new Response(proc.stdout).text();
          // Extract model names (usually in backticks or starting with gemini-)
          const matches = text.match(/`gemini-[^`]+`|gemini-[a-zA-Z0-9.-]+/g);
          if (matches) {
            models = matches.map((m) => m.replace(/`/g, ""));
          }
          // Also add common aliases
          if (text.includes("auto")) models.push("auto");
          if (text.includes("pro")) models.push("pro");
          if (text.includes("flash")) models.push("flash");
          if (text.includes("flash-lite")) models.push("flash-lite");
        }
      } catch (err) {
        console.error("[gemini] Failed to list models from CLI:", err);
      }
    }

    // Always include models available in LiteLLM (auto-routed via GEMINI_API_KEY).
    try {
      const all = await listLiteLLMModels(getLiteLLMBaseUrl());
      const litellm = all.filter((m) => m.startsWith("gemini/") || m.startsWith("gemini-"));
      models = Array.from(new Set([...models, ...litellm]));
    } catch {
      // ignore LiteLLM errors
    }

    // Fallback if empty
    if (models.length === 0) {
      models = ["auto", "pro", "flash", "flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"];
    }

    this.cachedModels = models.sort();
    this.lastFetch = Date.now();
    return this.cachedModels;
  }

  async getSetupIssue(): Promise<string | null> {
    if (!(await this.hasCli())) return "Gemini CLI não instalado";
    return null;
  }

  /**
   * Writes Gemini-specific context files for non-interactive execution.
   */
  async prepareWorkdir(workdir: string, _skills: SkillPayload): Promise<string[]> {
    const createdFiles: string[] = [];

    // Write .gemini/config.json for session persistence
    const configDir = join(workdir, ".gemini");
    const configPath = join(configDir, "config.json");
    try {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(configDir, { recursive: true });
      const config = {
        session: {
          persist: true,
          resume: true,
        },
        model: {
          default: "gemini-2.5-pro",
          temperature: 0.7,
        },
      };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
      createdFiles.push(configPath);
    } catch (err) {
      console.warn("[gemini] Failed to write .gemini/config.json:", err);
    }

    return createdFiles;
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    const command = await this.resolveGeminiCommand();
    if (!command || !(await this.hasCli())) {
      throw new Error(
        "Gemini CLI not installed or not on PATH. Install it with `npm install -g @google/gemini-cli` and restart the server."
      );
    }

    const promptFile = `/tmp/vibe-gemini-prompt-${options.runId ?? Date.now()}.txt`;
    await Bun.write(promptFile, prompt);

    const args = [command, "acp"];
    if (options.model) args.push("-m", options.model);
    if (options.resumeSessionId) args.push("-r", options.resumeSessionId);
    args.push("-p", `@${promptFile}`);

    let proc: Subprocess;
    try {
      proc = Bun.spawn(args, {
        cwd: workdir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        env: this.buildGeminiChildEnv(
          options.litellmKey,
          options.litellmBaseUrl,
          options.nativeApiKeys?.gemini,
          command.includes("\\") || command.includes("/") ? dirname(command) : undefined,
          options.env
        ),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        msg.includes("uv_spawn") || msg.includes("ENOENT")
          ? "Gemini CLI not installed or not on PATH. Install it with `npm install -g @google/gemini-cli` and restart the server."
          : msg
      );
    }

    yield { type: "log", stream: "system", content: `[gemini] Starting in ${workdir}` };
    yield {
      type: "log",
      stream: "system",
      content: `[gemini] Run context: model=${options.model ?? "default"}, runId=${options.runId ?? "n/a"}`,
    };

    yield {
      type: "log",
      stream: "system",
      content: options.litellmKey
        ? "[gemini] Process started with LiteLLM proxy (GOOGLE_GEMINI_BASE_URL + GEMINI_API_KEY injected)"
        : options.nativeApiKeys?.gemini
          ? "[gemini] Process started with Gemini API key from settings"
          : "[gemini] Process started with native credentials (GEMINI_API_KEY must be set in server env)",
    };

    if (options.runId) this.processes.set(options.runId, proc);

    yield* withHeartbeat(
      streamProcess(proc, (line) => parseAcpMessage(line), options.signal),
      getHeartbeatIntervalMs(),
      options.signal
    );

    if (options.runId) this.processes.delete(options.runId);

    try {
      await unlink(promptFile);
    } catch {
      // ignore cleanup errors
    }
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
