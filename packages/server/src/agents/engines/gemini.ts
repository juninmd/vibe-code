import { access, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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

  private buildGeminiChildEnv(
    litellmKey?: string,
    litellmBaseUrl?: string,
    nativeGeminiKey?: string,
    geminiBinDir?: string
  ): NodeJS.ProcessEnv {
    const env = { ...process.env };
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
    // Return Google/Gemini models available in LiteLLM (auto-routed via GEMINI_API_KEY).
    const all = await listLiteLLMModels(getLiteLLMBaseUrl());
    return all.filter((m) => m.startsWith("gemini/") || m.startsWith("gemini-"));
  }

  async getSetupIssue(): Promise<string | null> {
    if (!(await this.hasCli())) return "Gemini CLI não instalado";
    return null;
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
          command.includes("\\") || command.includes("/") ? dirname(command) : undefined
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
