import { access, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

function str(v: unknown): string {
  return v != null ? String(v) : "";
}

function humanizeToolCall(tool: string, input: Record<string, unknown>): string {
  const t = tool.toLowerCase();
  const path = str(input.path ?? input.file_path ?? input.file ?? input.filename);
  const cmd = str(input.command ?? input.cmd);
  const query = str(input.query ?? input.pattern ?? input.glob ?? input.search);
  const url = str(input.url);

  if (t.includes("read") || t === "view_file" || t === "cat") return `Reading ${path || "file"}`;
  if (t.includes("write") || t.includes("create_file") || t === "touch")
    return `Writing ${path || "file"}`;
  if (t.includes("edit") || t.includes("str_replace") || t.includes("patch"))
    return `Editing ${path || "file"}`;
  if (t.includes("delete") || t.includes("remove_file")) return `Deleting ${path || "file"}`;
  if (t.includes("move") || t.includes("rename")) return `Moving ${path || "file"}`;
  if (t === "bash" || t.includes("run_command") || t.includes("execute") || t.includes("shell"))
    return `Running: ${cmd || "(command)"}`;
  if (t.includes("list") || t.includes("ls") || t.includes("directory"))
    return `Listing ${path || "directory"}`;
  if (t.includes("grep") || t.includes("search") || t.includes("find") || t.includes("glob"))
    return `Searching ${query ? `"${query}"` : ""}${path ? ` in ${path}` : ""}`;
  if (t.includes("web") || t.includes("browser") || t.includes("fetch"))
    return `Fetching ${url || "URL"}`;
  if (t.includes("git")) return `Git: ${cmd || t}`;

  const readable = tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const detail = path || cmd || query || url;
  return `${readable}${detail ? `: ${detail}` : ""}`;
}

function humanizeToolResult(tool: string, output: unknown): string | null {
  if (output == null) return null;
  const t = tool.toLowerCase();
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const preview = text.slice(0, 120).replace(/\n/g, " ").trim();

  if (t === "bash" || t.includes("run_command") || t.includes("execute")) {
    if (!text.trim()) return "Done (no output)";
    return `${preview}${text.length > 120 ? ` … (${lines} lines)` : ""}`;
  }
  if (t.includes("read") || t === "view_file") {
    return `${lines} line${lines !== 1 ? "s" : ""} read`;
  }
  if (t.includes("search") || t.includes("grep") || t.includes("glob")) {
    return `${lines} match${lines !== 1 ? "es" : ""}`;
  }
  if (
    t.includes("write") ||
    t.includes("edit") ||
    t.includes("create") ||
    t.includes("str_replace")
  ) {
    return "Saved";
  }
  if (t.includes("web") || t.includes("fetch")) {
    return `${lines} line${lines !== 1 ? "s" : ""} fetched`;
  }
  if (text.length <= 80) return preview;
  return null;
}

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

    const args = [command, "--yolo", "--output-format", "stream-json"];
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
            const sessionEvent =
              typeof obj.session_id === "string"
                ? [{ type: "session" as const, sessionId: obj.session_id }]
                : [];

            // Final result: { session_id, result }
            if (obj.session_id && obj.result) {
              const result = obj.result as Record<string, unknown>;
              const text = typeof result.text === "string" ? result.text : null;
              if (text) return [...sessionEvent, { type: "log", stream: "stdout", content: text }];
              return sessionEvent;
            }

            // Error: { session_id, error }
            if (obj.session_id && obj.error) {
              const err = obj.error as Record<string, unknown>;
              const msg = typeof err.message === "string" ? err.message : JSON.stringify(err);
              const events: AgentEvent[] = [
                ...sessionEvent,
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
                ...sessionEvent,
                {
                  type: "tool_use",
                  toolUse: { toolId, toolName, parameters },
                },
                {
                  type: "log",
                  stream: "stdout",
                  content: humanizeToolCall(toolName, parameters ?? {}),
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
              const toolName =
                typeof obj.tool_name === "string"
                  ? obj.tool_name
                  : typeof obj.name === "string"
                    ? obj.name
                    : "tool";
              const output =
                typeof obj.output === "string"
                  ? obj.output
                  : typeof obj.result === "string"
                    ? obj.result
                    : JSON.stringify(obj.output ?? obj.result ?? "");
              const status = obj.status === "error" ? "error" : "success";
              const label = humanizeToolResult(toolName, output);
              const baseEvents: AgentEvent[] = [
                ...sessionEvent,
                {
                  type: "tool_result",
                  toolResult: { toolId, output, status },
                },
              ];
              if (label) {
                baseEvents.push({ type: "log", stream: "stdout", content: label });
              }
              return baseEvents;
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
                  if (models) {
                    models[key] = {
                      total_tokens: typeof val.total_tokens === "number" ? val.total_tokens : 0,
                      input_tokens: typeof val.input_tokens === "number" ? val.input_tokens : 0,
                      output_tokens: typeof val.output_tokens === "number" ? val.output_tokens : 0,
                      cached: typeof val.cached === "number" ? val.cached : undefined,
                      input: typeof val.input === "number" ? val.input : undefined,
                    };
                  }
                }
              }
              return [
                ...sessionEvent,
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
            return [...sessionEvent, { type: "log", stream: "system", content: line }];
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
