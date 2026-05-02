import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SkillPayload } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { getHeartbeatIntervalMs } from "./heartbeat";

// Maps raw tool names to readable labels and extracts the most useful arg
function humanizeToolCall(tool: string, input: Record<string, unknown>): string {
  const t = tool.toLowerCase();
  const path = str(input.path ?? input.file_path ?? input.file ?? input.filename);
  const cmd = str(input.command ?? input.cmd);
  const query = str(input.query ?? input.pattern ?? input.glob ?? input.search);
  const url = str(input.url);

  if (t.includes("read") || t === "view_file" || t === "cat") return `  Reading ${path || "file"}`;
  if (t.includes("write") || t.includes("create_file") || t === "touch")
    return `  Writing ${path || "file"}`;
  if (t.includes("edit") || t.includes("str_replace") || t.includes("patch"))
    return `  Editing ${path || "file"}`;
  if (t.includes("delete") || t.includes("remove_file")) return `  Deleting ${path || "file"}`;
  if (t.includes("move") || t.includes("rename")) return `  Moving ${path || "file"}`;
  if (t === "bash" || t.includes("run_command") || t.includes("execute") || t.includes("shell"))
    return `  Running: ${cmd || "(command)"}`;
  if (t.includes("list") || t.includes("ls") || t.includes("directory"))
    return `  Listing ${path || "directory"}`;
  if (t.includes("grep") || t.includes("search") || t.includes("find") || t.includes("glob"))
    return `  Searching ${query ? `"${query}"` : ""}${path ? ` in ${path}` : ""}`;
  if (t.includes("web") || t.includes("browser") || t.includes("fetch"))
    return `  Fetching ${url || "URL"}`;
  if (t.includes("git")) return `  Git: ${cmd || t}`;

  const readable = tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const detail = path || cmd || query || url;
  return `  ${readable}${detail ? `: ${detail}` : ""}`;
}

function humanizeToolResult(tool: string, output: unknown): string | null {
  if (output == null) return null;
  const t = tool.toLowerCase();
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const preview = text.slice(0, 120).replace(/\n/g, " ").trim();

  if (t === "bash" || t.includes("run_command") || t.includes("execute")) {
    if (!text.trim()) return "    Done (no output)";
    return `    ${preview}${text.length > 120 ? ` … (${lines} lines)` : ""}`;
  }
  if (t.includes("read") || t === "view_file") {
    return `    ${lines} line${lines !== 1 ? "s" : ""} read`;
  }
  if (t.includes("search") || t.includes("grep") || t.includes("glob")) {
    return `    ${lines} match${lines !== 1 ? "es" : ""}`;
  }
  if (
    t.includes("write") ||
    t.includes("edit") ||
    t.includes("create") ||
    t.includes("str_replace")
  ) {
    return "    Saved";
  }
  if (t.includes("web") || t.includes("fetch")) {
    return `    ${lines} line${lines !== 1 ? "s" : ""} fetched`;
  }
  if (text.length <= 80) return `    ${preview}`;
  return null;
}

function str(v: unknown): string {
  return v != null ? String(v) : "";
}

// Filter/humanize stderr — return null to suppress, or a string to show.
export function humanizeStderr(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // JSON structured logs
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const level = str(obj.level ?? obj.severity ?? "").toLowerCase();
    const msg = str(obj.message ?? obj.msg ?? obj.text ?? "");
    if (level === "debug" || level === "trace" || level === "verbose") return null;
    if (
      msg.includes("session") ||
      msg.includes("provider") ||
      msg.includes("model loaded") ||
      msg.includes("initialized") ||
      msg.includes("cleanup")
    )
      return null;
    if (msg) return msg;
    return null;
  } catch {
    /* not JSON */
  }

  // Common debug prefixes
  if (
    trimmed.startsWith("DEBUG") ||
    trimmed.startsWith("TRACE") ||
    trimmed.match(/^\d{4}-\d{2}-\d{2}T.*\[DEBUG\]/) ||
    trimmed.match(/^\[debug\]/i) ||
    trimmed.match(/^INF /) ||
    trimmed.match(/^DBG /)
  )
    return null;

  // OpenCode structured log: INFO  <ISO-date> +<ms>ms service=<name> ...
  const infoMatch = trimmed.match(/^INFO\s+\S+\s+\+\d+ms\s+service=(\S+)\s+(.*)/);
  if (infoMatch) {
    const service = infoMatch[1];
    const rest = infoMatch[2];
    if (service === "llm") {
      const m = rest.match(/modelID=(\S+)/);
      if (m) return `  Using model: ${m[1]}`;
    }
    if (service === "tools") {
      const m = rest.match(/tool=(\S+)/);
      if (m) return `  Tool: ${m[1]}`;
    }
    return null;
  }

  // WARN/ERROR structured lines
  const warnMatch = trimmed.match(/^(WARN|ERROR)\s+\S+\s+\+\d+ms\s+service=\S+\s+(.*)/);
  if (warnMatch) {
    const msg = warnMatch[2].replace(/\w+=\S+\s*/g, "").trim();
    if (msg) return `[${warnMatch[1]}] ${msg}`;
    return null;
  }

  return trimmed;
}

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
   * Writes opencode.json with permissions pre-configured for non-interactive mode.
   * This runs BEFORE the agent starts so the config is ready.
   */
  async prepareWorkdir(workdir: string, _skills: SkillPayload): Promise<string[]> {
    const configPath = join(workdir, "opencode.json");
    const config: Record<string, unknown> = {
      permission: {
        "*": "allow",
        question: "allow",
        plan_enter: "allow",
        plan_exit: "allow",
      },
      tools: {
        file_write: { "max-size-kb": 2048 },
        bash: { "timeout-sec": 600, "allowed-commands": ["*"] },
        web_fetch: { "timeout-sec": 30 },
      },
      model: {
        fallback: ["anthropic/claude-sonnet-4-5", "opencode/minimax-m2.7"],
        temperature: 0.7,
      },
    };

    const createdFiles: string[] = [];
    try {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
      createdFiles.push(configPath);
    } catch (err) {
      console.warn("[opencode] Failed to write opencode.json:", err);
    }
    return createdFiles;
  }

  /**
   * Returns the CLI command arguments to spawn.
   * Override in tests to inject a fake subprocess.
   * Prompt is sent via stdin to avoid Windows command-line length limits.
   */
  protected buildCommandArgs(model: string, workdir: string, resumeSessionId?: string): string[] {
    const args = ["opencode", "run", "--format", "json"];
    if (model) args.push("--model", model);
    args.push("--dir", workdir);
    if (resumeSessionId) args.push("--session", resumeSessionId);
    return args;
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

    // Build config for opencode.json — written in prepareWorkdir, but we also
    // write it here for immediate use when running without prepareWorkdir.
    const configPath = join(workdir, "opencode.json");
    interface OpenCodeProvider {
      id: string;
      name: string;
      apiKey: string;
      apiUrl?: string;
    }
    interface OpenCodeConfig {
      permission: Record<string, string>;
      tools?: Record<string, unknown>;
      providers?: OpenCodeProvider[];
    }
    const config: OpenCodeConfig = {
      permission: {
        "*": "allow",
        question: "allow",
        plan_enter: "allow",
        plan_exit: "allow",
      },
      tools: {
        file_write: { "max-size-kb": 2048 },
        bash: { "timeout-sec": 600, "allowed-commands": ["*"] },
        web_fetch: { "timeout-sec": 30 },
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

    try {
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    } catch {
      /* best-effort — prepareWorkdir may have already written it */
    }

    const args = this.buildCommandArgs(model, workdir, options.resumeSessionId);
    yield { type: "log", stream: "system", content: `[opencode] running: ${args.join(" ")}` };

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: { ...process.env, ...options.env },
    });

    // Send prompt via stdin, then close it to signal end of input
    if (proc.stdin && typeof proc.stdin !== "number") {
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

    // ─── Shared event queue ────────────────────────────────────────────────
    const queue: AgentEvent[] = [];
    let stdoutDone = false;
    let stderrDone = false;
    const waiting: { resolve: (() => void) | null } = { resolve: null };

    const notify = () => {
      if (waiting.resolve) {
        waiting.resolve();
        waiting.resolve = null;
      }
    };
    const push = (e: AgentEvent) => {
      queue.push(e);
      notify();
    };

    // ─── Task 1: stream stdout ─────────────────────────────────────────────
    // OpenCode writes JSON lines to stdout. We parse each line in real-time.
    let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const stdoutTask = (async () => {
      const reader = proc.stdout.getReader();
      stdoutReader = reader;
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            for (const event of this.parseLine(line)) push(event);
          }
        }
        if (buf.trim()) {
          for (const event of this.parseLine(buf)) push(event);
        }
      } catch {
        // Reader was cancelled (e.g. child process keeping pipe open on Windows)
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
        stdoutDone = true;
        notify();
      }
    })();

    // On Windows, child processes spawned by OpenCode (git, bash tools) inherit the
    // stdout pipe handle. After OpenCode exits its children may still hold the pipe
    // open, so the reader never reaches EOF. Cancel the reader after the process
    // exits + a short grace period so any final bytes are flushed first.
    proc.exited.then(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      if (!stdoutDone && stdoutReader) {
        try {
          await stdoutReader.cancel();
        } catch {
          /* ignore */
        }
      }
    });

    // ─── Task 2: stream stderr ─────────────────────────────────────────────
    let stderrReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const stderrTask = (async () => {
      const reader = proc.stderr.getReader();
      stderrReader = reader;
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const msg = humanizeStderr(line);
            if (msg) push({ type: "log", stream: "stderr", content: msg });
          }
        }
        const msg = humanizeStderr(buf);
        if (msg) push({ type: "log", stream: "stderr", content: msg });
      } catch {
        // Reader was cancelled
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
        stderrDone = true;
        notify();
      }
    })();

    // Same cancellation guard for stderr (child processes may hold it open on Windows).
    proc.exited.then(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      if (!stderrDone && stderrReader) {
        try {
          await stderrReader.cancel();
        } catch {
          /* ignore */
        }
      }
    });

    // ─── Task 3: heartbeat ─────────────────────────────────────────────────
    // Emits a "still running" log every heartbeatIntervalMs.
    // Uses a separate flag so we can cancel it without waiting for the next tick.
    let heartbeatActive = true;
    const allDone = () => stdoutDone && stderrDone;
    const startedAt = Date.now();
    const _heartbeatTask = (async () => {
      while (heartbeatActive && !allDone()) {
        await new Promise((r) => setTimeout(r, this.heartbeatIntervalMs));
        if (!heartbeatActive || allDone()) break;
        const secs = Math.round((Date.now() - startedAt) / 1000);
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        const elapsed = mins > 0 ? `${mins}m ${s}s` : `${s}s`;
        push({ type: "log", stream: "system", content: `  Still running... ${elapsed}` });
      }
    })();

    // ─── Main yield loop ───────────────────────────────────────────────────
    // Runs until BOTH stdout AND stderr reach EOF (which happens on process exit).
    while (true) {
      while (queue.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length checked above
        yield queue.shift()!;
      }
      if (allDone() && queue.length === 0) break;

      await new Promise<void>((r) => {
        waiting.resolve = r;
      });
    }

    // Stop the heartbeat before awaiting — it might be sleeping for up to
    // heartbeatIntervalMs; we don't need to wait for it to wake up.
    heartbeatActive = false;
    await Promise.all([stdoutTask, stderrTask]);
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

  parseLine(line: string): AgentEvent[] {
    const results: AgentEvent[] = [];
    const jsonObjects: string[] = [];

    // Skip empty lines
    const trimmed = line.trim();
    if (!trimmed) return results;

    // Try to extract multiple JSON objects from the line using brace counting
    let braceCount = 0;
    let inString = false;
    let escaped = false;
    let start = -1;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        if (braceCount === 0) start = i;
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0 && start !== -1) {
          jsonObjects.push(line.slice(start, i + 1));
          start = -1;
        }
      }
    }

    // If nothing was found via brace counting, try treating as plain text
    if (jsonObjects.length === 0) {
      if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        // Skip known non-content lines
        if (
          trimmed.startsWith("INFO") ||
          trimmed.startsWith("DEBUG") ||
          trimmed.startsWith("TRACE") ||
          trimmed.startsWith("WARN") ||
          trimmed.startsWith("[") ||
          trimmed.includes("model loaded") ||
          trimmed.includes("initialized")
        ) {
          return results;
        }
        results.push({ type: "log", stream: "stdout", content: trimmed });
      }
      return results;
    }

    for (const jsonStr of jsonObjects) {
      try {
        const raw = JSON.parse(jsonStr) as Record<string, unknown>;

        // Handle JSON-RPC 2.0 style messages
        if (raw.jsonrpc === "2.0" && raw.method) {
          const method = String(raw.method);
          const params = (raw.params ?? {}) as Record<string, unknown>;

          if (method === "session/started" || method === "session/resumed") {
            const sessionId = String(params.sessionId ?? params.id ?? "");
            if (sessionId) {
              results.push({ type: "session", sessionId });
              results.push({
                type: "log",
                stream: "system",
                content: `[opencode] session: ${sessionId}`,
              });
            }
            continue;
          }

          if (method === "tool/use") {
            const toolName = String(params.tool ?? "unknown");
            const callId = String(params.callId ?? params.id ?? "");
            results.push({
              type: "tool_use",
              toolUse: {
                toolId: callId,
                toolName,
                parameters: (params.input ?? {}) as Record<string, unknown>,
              },
            });
            results.push({
              type: "log",
              stream: "stdout",
              content: humanizeToolCall(toolName, (params.input ?? {}) as Record<string, unknown>),
            });
            continue;
          }

          if (method === "tool/result" || method === "tool/completed") {
            const callId = String(params.callId ?? params.id ?? "");
            const output = params.output ?? params.result ?? "";
            const status = params.error ? "error" : "success";
            results.push({
              type: "tool_result",
              toolResult: { toolId: callId, output: String(output), status },
            });
            continue;
          }

          if (method === "cost" || method === "usage") {
            const costStats = params as Record<string, unknown>;
            if (costStats.total_tokens || costStats.input_tokens || costStats.output_tokens) {
              results.push({ type: "cost", costStats: costStats as AgentEvent["costStats"] });
            }
            continue;
          }

          if (method === "error" || method === "tool/error") {
            const msg = String(params.message ?? params.error ?? "Unknown error");
            results.push({ type: "log", stream: "stderr", content: `[opencode] ${msg}` });
            results.push({ type: "error", content: msg });
            continue;
          }

          // Log other methods as system info
          results.push({ type: "log", stream: "system", content: `[opencode] ${method}` });
          continue;
        }

        // Handle direct message format with type field
        const eventType = String(raw.type ?? raw.event ?? "");
        const part = (raw.part ?? raw.data ?? raw.message ?? raw) as Record<string, unknown>;

        // session events
        if (eventType === "session" || part.type === "session" || raw.sessionId) {
          const sessionId = String(raw.sessionId ?? part.sessionId ?? part.id ?? "");
          if (sessionId) {
            results.push({ type: "session", sessionId });
            results.push({
              type: "log",
              stream: "system",
              content: `[opencode] session: ${sessionId}`,
            });
          }
          continue;
        }

        // cost events
        if (eventType === "cost" || part.type === "cost" || raw.total_tokens) {
          const costStats = (raw.costStats ?? raw.usage ?? raw) as Record<string, unknown>;
          if (costStats.total_tokens || costStats.input_tokens || costStats.output_tokens) {
            results.push({ type: "cost", costStats: costStats as AgentEvent["costStats"] });
          }
          continue;
        }

        // text content
        if (
          (eventType === "text" || eventType === "content" || part.type === "text") &&
          (part.text || part.content || part.message)
        ) {
          const text = String(part.text ?? part.content ?? part.message ?? "");
          if (text.trim()) {
            results.push({ type: "log", stream: "stdout", content: text });
          }
          continue;
        }

        // tool_use events
        if (
          eventType === "tool_use" ||
          eventType === "tool" ||
          part.type === "tool_use" ||
          part.type === "tool_call" ||
          part.type === "function_call"
        ) {
          const toolName = String(part.tool ?? part.name ?? part.function ?? "unknown");
          const callId = String(part.callId ?? part.id ?? part.call_id ?? "");
          const state = (part.state ?? part.arguments ?? part.input ?? {}) as Record<
            string,
            unknown
          >;
          const status = String(part.status ?? state.status ?? "calling");
          const input = state.input ?? state.arguments ?? state ?? part;
          const output = state.output ?? part.output ?? part.result;
          const error = state.error ?? part.error;

          if (status === "calling" || status === "pending" || !status || status === "active") {
            results.push({
              type: "tool_use",
              toolUse: { toolId: callId, toolName, parameters: input as Record<string, unknown> },
            });
            const label = humanizeToolCall(toolName, input as Record<string, unknown>);
            results.push({ type: "status", content: label });
            results.push({ type: "log", stream: "stdout", content: label });
          } else if (status === "completed" || status === "success" || status === "done") {
            const metadata = (state.metadata ?? part.metadata ?? {}) as Record<string, unknown>;
            const exitCode = metadata.exitCode ?? metadata.exit ?? metadata.code;
            const label = humanizeToolResult(toolName, output);

            results.push({
              type: "tool_result",
              toolResult: {
                toolId: callId,
                output: typeof output === "string" ? output : JSON.stringify(output ?? ""),
                status: error ? "error" : "success",
              },
            });
            if (label) results.push({ type: "log", stream: "stdout", content: label });

            if (exitCode != null && Number(exitCode) !== 0) {
              results.push({
                type: "log",
                stream: "stderr",
                content: `  Command exited with code ${exitCode}`,
              });
            }
          } else if (status === "failed" || status === "error" || error) {
            const msg = error ? String(error) : String(part.errorMessage ?? "Failed");
            results.push({
              type: "tool_result",
              toolResult: { toolId: callId, output: msg, status: "error" },
            });
            results.push({
              type: "log",
              stream: "stderr",
              content: `  Error in ${toolName}: ${msg}`,
            });
          }
          continue;
        }

        // thinking events
        if (
          (eventType === "thinking" || part.type === "thinking" || part.type === "thought") &&
          (part.text || part.content || part.thought)
        ) {
          results.push({ type: "status", content: "Thinking..." });
          const thought = String(part.text ?? part.content ?? part.thought ?? "");
          if (thought.trim() && thought.length < 500) {
            results.push({ type: "log", stream: "stdout", content: `💭 ${thought}` });
          }
          continue;
        }

        // step events
        if (
          eventType === "step_start" ||
          eventType === "step-start" ||
          part.type === "step_start"
        ) {
          results.push({ type: "status", content: "Working..." });
          continue;
        }
        if (
          eventType === "step_finish" ||
          eventType === "step-finish" ||
          part.type === "step_finish"
        ) {
          const tokens = (part.tokens ?? part.usage ?? raw) as Record<string, number>;
          if (tokens?.total) {
            results.push({
              type: "log",
              stream: "system",
              content: `  tokens: ${tokens.total.toLocaleString()}`,
            });
          }
          continue;
        }

        // error events
        if (eventType === "error" || part.type === "error" || raw.error) {
          const msg = String(part.message ?? part.error ?? raw.error ?? "Unknown error");
          results.push({ type: "log", stream: "stderr", content: msg });
          results.push({ type: "error", content: msg });
          continue;
        }

        // question / confirmation events
        if (
          eventType === "question" ||
          part.type === "question" ||
          eventType === "confirm" ||
          part.type === "confirm" ||
          part.type === "approval"
        ) {
          const msg = String(part.text ?? part.content ?? part.message ?? "Waiting for input...");
          results.push({ type: "status", content: "Awaiting input..." });
          results.push({ type: "log", stream: "stdout", content: `\n[?] ${msg}` });
          continue;
        }

        // progress / status events
        if (
          eventType === "progress" ||
          part.type === "progress" ||
          eventType === "status" ||
          part.type === "status"
        ) {
          const msg = String(part.message ?? part.text ?? part.content ?? "Working...");
          results.push({ type: "status", content: msg });
          results.push({ type: "log", stream: "system", content: `  ${msg}` });
          continue;
        }

        // message / log events
        if (eventType === "message" || eventType === "log" || part.type === "log") {
          const msg = String(part.message ?? part.text ?? part.content ?? JSON.stringify(raw));
          if (msg.trim()) {
            const stream = String(part.level ?? part.severity ?? "").toLowerCase();
            results.push({
              type: "log",
              stream: stream === "error" || stream === "warn" ? "stderr" : "stdout",
              content: msg,
            });
          }
          continue;
        }

        // unknown event — try to extract useful text
        const content = part.content ?? part.text ?? part.message ?? raw.content;
        if (typeof content === "string" && content.trim()) {
          results.push({ type: "log", stream: "stdout", content: content });
        }
      } catch {
        // Not valid JSON or couldn't parse — emit as raw text
        const trimmed = jsonStr.trim();
        if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
          results.push({ type: "log", stream: "stdout", content: trimmed });
        }
      }
    }
    return results;
  }
}
