import { unlink } from "node:fs/promises";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

export class GeminiEngine implements AgentEngine {
  name = "gemini";
  displayName = "Gemini CLI";
  private processes = new Map<string, Subprocess>();

  private buildGeminiChildEnv(
    litellmKey?: string,
    litellmBaseUrl?: string,
    nativeGeminiKey?: string
  ): NodeJS.ProcessEnv {
    const env = { ...process.env };
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

  private async hasCli(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["gemini", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.hasCli();
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["gemini", "--version"], { stdout: "pipe", stderr: "pipe" });
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
    yield { type: "log", stream: "system", content: `[gemini] Starting in ${workdir}` };
    yield {
      type: "log",
      stream: "system",
      content: `[gemini] Run context: model=${options.model ?? "default"}, runId=${options.runId ?? "n/a"}`,
    };

    const promptFile = `/tmp/vibe-gemini-prompt-${options.runId ?? Date.now()}.txt`;
    await Bun.write(promptFile, prompt);

    const args = ["gemini", "--yolo", "--output-format", "stream-json"];
    if (options.model) args.push("-m", options.model);
    if (options.resumeSessionId) args.push("-r", options.resumeSessionId);
    args.push("-p", `@${promptFile}`);

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: this.buildGeminiChildEnv(
        options.litellmKey,
        options.litellmBaseUrl,
        options.nativeApiKeys?.gemini
      ),
    });

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
      streamProcess(
        proc,
        (line) => {
          // Try to parse as JSON (stream-json format emits JSONL)
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            parsed = null;
          }

          if (parsed && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>;

            // Final result: { session_id, result }
            if (obj.session_id && obj.result) {
              const result = obj.result as Record<string, unknown>;
              const text = typeof result.text === "string" ? result.text : null;
              if (text) return [{ type: "log", stream: "stdout", content: text }];
              return [];
            }

            // Error: { session_id, error }
            if (obj.session_id && obj.error) {
              const err = obj.error as Record<string, unknown>;
              const msg = typeof err.message === "string" ? err.message : JSON.stringify(err);
              const events: AgentEvent[] = [
                { type: "log", stream: "stderr", content: `[gemini] ${msg}` },
              ];
              if (msg.includes("GEMINI_API_KEY")) {
                events.push({
                  type: "log",
                  stream: "system",
                  content: options.litellmKey
                    ? "[gemini] LiteLLM proxy key rejected. Check LITELLM_BASE_URL and the virtual key."
                    : "[gemini] GEMINI_API_KEY not found. Add it in Settings → API Keys.",
                });
              }
              return events;
            }

            // Text content events
            const text =
              typeof obj.text === "string"
                ? obj.text
                : typeof obj.content === "string"
                  ? obj.content
                  : null;
            if (text) {
              return [{ type: "log", stream: "stdout", content: text }];
            }

            // Tool call notification — emit structured tool_use event
            if (obj.type === "tool_use" || obj.type === "tool_call") {
              const toolId =
                typeof obj.tool_id === "string"
                  ? obj.tool_id
                  : typeof obj.id === "string"
                    ? obj.id
                    : "";
              const toolName =
                typeof obj.name === "string"
                  ? obj.name
                  : typeof obj.tool_name === "string"
                    ? obj.tool_name
                    : "tool";
              let parameters: Record<string, unknown> | undefined;
              if (obj.parameters && typeof obj.parameters === "object") {
                parameters = obj.parameters as Record<string, unknown>;
              } else if (obj.args && typeof obj.args === "object") {
                parameters = obj.args as Record<string, unknown>;
              }
              return [
                {
                  type: "tool_use",
                  toolUse: { toolId, toolName, parameters },
                },
                {
                  type: "log",
                  stream: "system",
                  content: `[tool] ${toolName}${toolId ? ` (${toolId})` : ""}`,
                },
              ];
            }

            // Tool result from a previous tool_use
            if (obj.type === "tool_result" || obj.type === "tool_result_legacy") {
              const toolId =
                typeof obj.tool_id === "string"
                  ? obj.tool_id
                  : typeof obj.call_id === "string"
                    ? obj.call_id
                    : "";
              const output =
                typeof obj.output === "string"
                  ? obj.output
                  : typeof obj.result === "string"
                    ? obj.result
                    : JSON.stringify(obj.output ?? obj.result ?? "");
              const status = obj.status === "error" ? "error" : "success";
              return [
                {
                  type: "tool_result",
                  toolResult: { toolId, output, status },
                },
                {
                  type: "log",
                  stream: "system",
                  content: `[tool result] ${status}${toolId ? ` (${toolId})` : ""}`,
                },
              ];
            }

            // Cost/usage stats event from provider
            if (obj.type === "result" && obj.status === "success" && obj.stats) {
              const stats = obj.stats as Record<string, unknown>;
              const rawModels = stats.models as Record<string, Record<string, unknown>> | undefined;
              const models:
                | Record<
                    string,
                    {
                      total_tokens: number;
                      input_tokens: number;
                      output_tokens: number;
                      cached?: number;
                      input?: number;
                    }
                  >
                | undefined = rawModels ? {} : undefined;
              if (rawModels) {
                for (const [key, val] of Object.entries(rawModels)) {
                  models![key] = {
                    total_tokens: typeof val.total_tokens === "number" ? val.total_tokens : 0,
                    input_tokens: typeof val.input_tokens === "number" ? val.input_tokens : 0,
                    output_tokens: typeof val.output_tokens === "number" ? val.output_tokens : 0,
                    cached: typeof val.cached === "number" ? val.cached : undefined,
                    input: typeof val.input === "number" ? val.input : undefined,
                  };
                }
              }
              return [
                {
                  type: "cost",
                  costStats: {
                    total_tokens: typeof stats.total_tokens === "number" ? stats.total_tokens : 0,
                    input_tokens: typeof stats.input_tokens === "number" ? stats.input_tokens : 0,
                    output_tokens:
                      typeof stats.output_tokens === "number" ? stats.output_tokens : 0,
                    cached: typeof stats.cached === "number" ? stats.cached : undefined,
                    input: typeof stats.input === "number" ? stats.input : undefined,
                    duration_ms:
                      typeof stats.duration_ms === "number" ? stats.duration_ms : undefined,
                    tool_calls: typeof stats.tool_calls === "number" ? stats.tool_calls : undefined,
                    models,
                  },
                },
              ];
            }

            // Unknown JSON event — emit as system log
            return [{ type: "log", stream: "system", content: line }];
          }

          const events: AgentEvent[] = [{ type: "log", stream: "stdout", content: line }];

          if (line.includes("you must specify the GEMINI_API_KEY environment variable")) {
            events.push({
              type: "log",
              stream: "system",
              content: options.litellmKey
                ? "[gemini] LiteLLM proxy key rejected. Check LITELLM_BASE_URL and the virtual key."
                : "[gemini] GEMINI_API_KEY not found. Add it in Settings → API Keys.",
            });
          }
          return events;
        },
        options.signal
      ),
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
