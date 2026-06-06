import { existsSync, type Stats, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";
import type { SkillPayload } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { type BlockedArgs, filterCustomArgs } from "./blocked-args";
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
    if (!text.trim()) return "    Command completed with no output";
    return `    Command output: ${preview}${text.length > 120 ? ` ... (${lines} lines)` : ""}`;
  }
  if (t.includes("read") || t === "view_file") {
    return `    Read ${lines} non-empty line${lines !== 1 ? "s" : ""}`;
  }
  if (t.includes("search") || t.includes("grep") || t.includes("glob")) {
    return `    Found ${lines} match${lines !== 1 ? "es" : ""}`;
  }
  if (
    t.includes("write") ||
    t.includes("edit") ||
    t.includes("create") ||
    t.includes("str_replace")
  ) {
    return "    File saved";
  }
  if (t.includes("web") || t.includes("fetch")) {
    return `    Fetched ${lines} non-empty line${lines !== 1 ? "s" : ""}`;
  }
  if (text.length <= 80) return `    ${preview}`;
  return null;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Filter/humanize stderr — return null to suppress, or a string to show.
export function humanizeStderr(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // JSON structured logs
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const level = str(obj.level ?? obj.severity ?? "").toLowerCase();
    const msg = str(obj.message ?? obj.msg ?? obj.text ?? obj.error ?? obj);
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
 * GitHub Models works in the local/free deployment with GITHUB_TOKEN.
 */
export const DEFAULT_OPENCODE_MODEL = "cloud/llama-70b";

// Model name opencode uses when routing via LiteLLM's Anthropic-compatible endpoint.
// opencode uses /v1/messages (Anthropic SDK) for anthropic/* models — avoids the
// /responses endpoint incompatibility that affects openai/* models in LiteLLM.
// LiteLLM maps this alias to the actual backend (see litellm configmap entry).
// Must be a model name that opencode's Anthropic provider allowlist recognizes.
export const LITELLM_ANTHROPIC_COMPAT_MODEL = "claude-3-5-haiku-latest";

export const OPENCODE_FALLBACK_MODELS = [DEFAULT_OPENCODE_MODEL, "auto-free"];

const MODEL_LIST_TIMEOUT_MS = 10_000;

async function waitForModelsProcess(proc: Subprocess): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), MODEL_LIST_TIMEOUT_MS);
  });
  const result = await Promise.race([proc.exited.then(() => "done" as const), timedOut]);
  if (timeout) clearTimeout(timeout);
  if (result === "timeout") {
    proc.kill();
    return false;
  }
  return proc.exitCode === 0;
}

// Why: Windows batch `%*` argv forwarding does not preserve newlines, so the
// `opencode.cmd` npm shim truncates multi-line prompts at the first \n before
// dispatching to the JS entrypoint. Spawning the bundled native opencode.exe
// directly skips cmd.exe entirely and lets full argv (incl. newlines) through.
function opencodeWindowsPackageCandidates(arch: NodeJS.Architecture): string[] {
  if (arch === "arm64")
    return ["opencode-windows-arm64", "opencode-windows-x64", "opencode-windows-x64-baseline"];
  return ["opencode-windows-x64", "opencode-windows-x64-baseline", "opencode-windows-arm64"];
}

type StatFn = (p: string) => Stats | null;
const defaultStat: StatFn = (p) => {
  try {
    return statSync(p);
  } catch {
    return null;
  }
};

export function resolveOpencodeNativeFromShim(
  shimPath: string,
  arch: NodeJS.Architecture = process.arch,
  stat: StatFn = defaultStat
): string | null {
  if (extname(shimPath).toLowerCase() !== ".cmd") return null;
  const prefix = dirname(shimPath);
  for (const pkg of opencodeWindowsPackageCandidates(arch)) {
    const candidate = join(
      prefix,
      "node_modules",
      "opencode-ai",
      "node_modules",
      pkg,
      "bin",
      "opencode.exe"
    );
    if (stat(candidate)) return candidate;
  }
  return null;
}

function findOnPath(executable: string): string | null {
  const pathVar = process.env.PATH || process.env.Path || "";
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT || ".CMD;.EXE;.BAT").split(";") : [""];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, executable + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Flags whose presence in user-supplied extra args would break daemon↔opencode
// communication or override required workdir/session pinning.
export const OPENCODE_BLOCKED_ARGS: BlockedArgs = {
  "--format": "with-value",
  "--dir": "with-value",
  "--session": "with-value",
  "--model": "with-value",
};

export function resolveOpencodeBinary(): string {
  if (process.platform !== "win32") return "opencode";
  const shim = findOnPath("opencode");
  if (!shim) return "opencode";
  const native = resolveOpencodeNativeFromShim(shim);
  return native ?? shim;
}

export interface OpenCodeAccumulators {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached: number;
  input_cost: number;
  output_cost: number;
  total_cost: number;
}

export class OpenCodeEngine implements AgentEngine {
  name = "opencode";
  binaryName = "opencode";
  displayName = "OpenCode";
  private processes = new Map<string, Subprocess>();

  /** Heartbeat interval (ms). Overridable in tests via constructor arg or VIBE_CODE_HEARTBEAT_MS. */
  protected heartbeatIntervalMs: number;

  constructor(heartbeatIntervalMs?: number) {
    this.heartbeatIntervalMs = heartbeatIntervalMs ?? getHeartbeatIntervalMs();
  }

  /**
   * Writes opencode.json with permissions pre-configured for non-interactive mode.
   * This is now a no-op as the config is isolated during execute.
   */
  async prepareWorkdir(_workdir: string, _skills: SkillPayload): Promise<string[]> {
    return [];
  }

  /**
   * Returns the CLI command arguments to spawn.
   * Override in tests to inject a fake subprocess.
   * Prompt is sent via stdin to avoid Windows command-line length limits.
   */
  protected buildCommandArgs(model: string, workdir: string, resumeSessionId?: string): string[] {
    const args = [resolveOpencodeBinary(), "run", "--format", "json"];
    if (model) args.push("--model", model);
    args.push("--dir", workdir);
    if (resumeSessionId) args.push("--session", resumeSessionId);
    // Operator escape hatch: extra flags via env, with protocol-critical
    // flags filtered out (ported from multica's filterCustomArgs).
    const extra = (process.env.VIBE_OPENCODE_EXTRA_ARGS || "")
      .split(/\s+/)
      .filter((s) => s.length > 0);
    if (extra.length) {
      const safe = filterCustomArgs(extra, OPENCODE_BLOCKED_ARGS, (flag) =>
        console.warn(
          `[opencode] dropping protocol-critical flag from VIBE_OPENCODE_EXTRA_ARGS: ${flag}`
        )
      );
      args.push(...safe);
    }
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

  async selectFreeModel(): Promise<string> {
    try {
      const binary = resolveOpencodeBinary();
      const proc = Bun.spawn([binary, "models"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode === 0) {
        const text = await new Response(proc.stdout).text();
        const models = text
          .split("\n")
          .map((m) => m.trim())
          .filter(Boolean);
        const free = models.filter((m) => m.endsWith("-free") || m === "opencode/big-pickle");
        if (free.length > 0) {
          const chosen = free[Math.floor(Math.random() * free.length)];
          return chosen;
        }
      }
    } catch (e) {
      console.warn("[opencode] Failed to query local free models, falling back to big-pickle", e);
    }
    return "opencode/big-pickle";
  }

  async listModels(): Promise<string[]> {
    const models = new Set<string>();

    try {
      const litellm = await listLiteLLMModels(getLiteLLMBaseUrl());
      for (const model of litellm) models.add(model);
    } catch (err) {
      console.warn("[opencode] Failed to list LiteLLM models", err);
    }

    try {
      const binary = resolveOpencodeBinary();
      const proc = Bun.spawn([binary, "models"], { stdout: "pipe", stderr: "pipe" });
      if (await waitForModelsProcess(proc)) {
        const text = await new Response(proc.stdout).text();
        for (const model of text
          .split("\n")
          .map((m) => m.trim())
          .filter(Boolean)) {
          models.add(model);
        }
      }
    } catch (err) {
      console.warn("[opencode] Failed to list CLI models", err);
    }

    for (const model of OPENCODE_FALLBACK_MODELS) models.add(model);
    return Array.from(models);
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    let model = options.model ?? DEFAULT_OPENCODE_MODEL;
    if (model === "auto-free") {
      model = await this.selectFreeModel();
    }
    yield {
      type: "log",
      stream: "system",
      content: `[opencode] Starting in ${workdir} (model: ${model})`,
    };

    // Build config for opencode.json
    interface OpenCodeConfig {
      permission: Record<string, string>;
      tools?: Record<string, unknown>;
      mcp?: Record<string, unknown>;
    }
    const config: OpenCodeConfig = {
      permission: {
        "*": "allow",
        question: "allow",
        plan_enter: "allow",
        plan_exit: "allow",
      },
      tools: {
        file_write: true,
        bash: true,
        web_fetch: true,
      },
    };

    if (options.mcpServers) {
      config.mcp = options.mcpServers;
    }

    // opencode 1.15.13 does not support `providers` key in opencode.json.
    // Route LiteLLM via the Anthropic SDK path (ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL)
    // because opencode uses POST /v1/messages for anthropic/* models, which LiteLLM
    // supports correctly — unlike POST /responses used for openai/* models.
    const litellmEnv: Record<string, string> = {};
    if (options.litellmKey) {
      litellmEnv.ANTHROPIC_API_KEY = options.litellmKey;
      // opencode appends /messages to ANTHROPIC_BASE_URL; LiteLLM serves Anthropic
      // proxy at /v1/messages, so we must include /v1 in the base URL.
      litellmEnv.ANTHROPIC_BASE_URL = `${(options.litellmBaseUrl ?? "").replace(/\/$/, "")}/v1`;
      // Remap any model to the Anthropic-compat alias LiteLLM maps to the real backend.
      model = `anthropic/${LITELLM_ANTHROPIC_COMPAT_MODEL}`;
    } else if (
      options.nativeApiKeys?.anthropic ||
      options.nativeApiKeys?.openai ||
      options.nativeApiKeys?.gemini
    ) {
      // Inject native keys as env vars (opencode 1.15.13 reads them directly)
      if (options.nativeApiKeys.anthropic)
        litellmEnv.ANTHROPIC_API_KEY = options.nativeApiKeys.anthropic;
      if (options.nativeApiKeys.openai) litellmEnv.OPENAI_API_KEY = options.nativeApiKeys.openai;
      if (options.nativeApiKeys.gemini) litellmEnv.GEMINI_API_KEY = options.nativeApiKeys.gemini;
    }

    let isolatedDir: string | null = null;
    let proc: Subprocess | null = null;
    let stdoutTask: Promise<void> | null = null;
    let stderrTask: Promise<void> | null = null;
    let heartbeatActive = true;

    try {
      isolatedDir = await mkdtemp(join(tmpdir(), "opencode-config-"));
      const opencodeSubdir = join(isolatedDir, "opencode");
      await mkdir(opencodeSubdir, { recursive: true });
      const configPath = join(opencodeSubdir, "opencode.json");
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

      const args = this.buildCommandArgs(model, workdir, options.resumeSessionId);
      yield { type: "log", stream: "system", content: `[opencode] running: ${args.join(" ")}` };

      proc = Bun.spawn(args, {
        cwd: workdir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        env: {
          ...process.env,
          // Belt-and-suspenders auto-allow (complements opencode.json) — ported
          // from multica's daemon: this works even if opencode.json is missing.
          OPENCODE_PERMISSION: '{"*":"allow"}',
          OPENCODE_DISABLE_PROJECT_CONFIG: "true",
          XDG_CONFIG_HOME: isolatedDir,
          ...litellmEnv,
          ...options.env,
        },
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
          if (proc.stdin && typeof proc.stdin !== "number") {
            (proc.stdin as any).end();
          }
        } catch {
          // stdin may already be closed
        }
        yield {
          type: "log",
          stream: "system",
          content: "[opencode] stdin closed (Windows: non-interactive mode)",
        };
      }

      if (options.runId) {
        // Kill any stale process for this runId before registering the new one
        const stale = this.processes.get(options.runId);
        if (stale) {
          try {
            stale.kill();
          } catch {
            /* best effort */
          }
        }
        this.processes.set(options.runId, proc);
      }
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          proc?.kill();
          if (options.runId) this.processes.delete(options.runId);
        });
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

      // Define accumulators inside the generator scope
      const accumulators: OpenCodeAccumulators = {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cached: 0,
        input_cost: 0,
        output_cost: 0,
        total_cost: 0,
      };

      // ─── Task 1: stream stdout ─────────────────────────────────────────────
      // OpenCode writes JSON lines to stdout. We parse each line in real-time.
      const pStdout = proc.stdout as any;
      stdoutTask = (async () => {
        const reader = pStdout.getReader();
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
              for (const event of this.parseLine(line, accumulators)) push(event);
            }
          }
          if (buf.trim()) {
            for (const event of this.parseLine(buf, accumulators)) push(event);
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
      const pStdoutReader = proc.stdout as any;
      proc.exited.then(async () => {
        await new Promise((r) => setTimeout(r, 1500));
        if (!stdoutDone) {
          try {
            const reader = pStdoutReader.getReader();
            await reader.cancel();
            reader.releaseLock();
          } catch {
            /* ignore */
          }
        }
      });

      // ─── Task 2: stream stderr ─────────────────────────────────────────────
      const pStderr = proc.stderr as any;
      stderrTask = (async () => {
        const reader = pStderr.getReader();
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
      const pStderrReader = proc.stderr as any;
      proc.exited.then(async () => {
        await new Promise((r) => setTimeout(r, 1500));
        if (!stderrDone) {
          try {
            const reader = pStderrReader.getReader();
            await reader.cancel();
            reader.releaseLock();
          } catch {
            /* ignore */
          }
        }
      });

      // ─── Task 3: heartbeat ─────────────────────────────────────────────────
      // Emits a "still running" log every heartbeatIntervalMs.
      // Uses a separate flag so we can cancel it without waiting for the next tick.
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
    } finally {
      // Stop the heartbeat before awaiting — it might be sleeping for up to
      // heartbeatIntervalMs; we don't need to wait for it to wake up.
      heartbeatActive = false;
      if (stdoutTask || stderrTask) {
        await Promise.all([stdoutTask, stderrTask].filter(Boolean));
      }
      let exitCode = 0;
      if (proc) {
        exitCode = (await proc.exited) ?? 0;
      }

      if (options.runId) this.processes.delete(options.runId);

      // Cleanup temp config directory recursively
      if (isolatedDir) {
        try {
          await rm(isolatedDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }

      if (proc && exitCode !== 0) {
        yield { type: "log", stream: "stderr", content: `[process] Exited with code ${exitCode}` };
      }
      yield { type: "complete", exitCode: exitCode ?? 0 };
    }
  }

  abort(runId: string): void {
    const proc = this.processes.get(runId);
    if (proc) {
      import("../../utils/process-tree").then(({ killProcessTree }) => {
        killProcessTree(proc.pid);
      });
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

  parseLine(line: string, accumulators?: OpenCodeAccumulators): AgentEvent[] {
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
              if (accumulators) {
                accumulators.total_tokens = Math.max(
                  accumulators.total_tokens,
                  Number(costStats.total_tokens ?? 0)
                );
                accumulators.input_tokens = Math.max(
                  accumulators.input_tokens,
                  Number(costStats.input_tokens ?? 0)
                );
                accumulators.output_tokens = Math.max(
                  accumulators.output_tokens,
                  Number(costStats.output_tokens ?? 0)
                );
                accumulators.cached = Math.max(accumulators.cached, Number(costStats.cached ?? 0));
                accumulators.input_cost = Math.max(
                  accumulators.input_cost,
                  Number(costStats.input ?? 0)
                );
                accumulators.output_cost = Math.max(
                  accumulators.output_cost,
                  Number(costStats.output ?? 0)
                );
                accumulators.total_cost = Math.max(
                  accumulators.total_cost,
                  Number(costStats.total ?? 0)
                );
                results.push({
                  type: "cost",
                  costStats: {
                    total_tokens: accumulators.total_tokens,
                    input_tokens: accumulators.input_tokens,
                    output_tokens: accumulators.output_tokens,
                    cached: accumulators.cached || undefined,
                    input: accumulators.input_cost,
                    output: accumulators.output_cost,
                    total: accumulators.total_cost,
                  },
                });
              } else {
                results.push({ type: "cost", costStats: costStats as AgentEvent["costStats"] });
              }
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
            if (accumulators) {
              accumulators.total_tokens = Math.max(
                accumulators.total_tokens,
                Number(costStats.total_tokens ?? 0)
              );
              accumulators.input_tokens = Math.max(
                accumulators.input_tokens,
                Number(costStats.input_tokens ?? 0)
              );
              accumulators.output_tokens = Math.max(
                accumulators.output_tokens,
                Number(costStats.output_tokens ?? 0)
              );
              accumulators.cached = Math.max(accumulators.cached, Number(costStats.cached ?? 0));
              accumulators.input_cost = Math.max(
                accumulators.input_cost,
                Number(costStats.input ?? 0)
              );
              accumulators.output_cost = Math.max(
                accumulators.output_cost,
                Number(costStats.output ?? 0)
              );
              accumulators.total_cost = Math.max(
                accumulators.total_cost,
                Number(costStats.total ?? 0)
              );
              results.push({
                type: "cost",
                costStats: {
                  total_tokens: accumulators.total_tokens,
                  input_tokens: accumulators.input_tokens,
                  output_tokens: accumulators.output_tokens,
                  cached: accumulators.cached || undefined,
                  input: accumulators.input_cost,
                  output: accumulators.output_cost,
                  total: accumulators.total_cost,
                },
              });
            } else {
              results.push({ type: "cost", costStats: costStats as AgentEvent["costStats"] });
            }
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
            const callLabel = humanizeToolCall(toolName, input as Record<string, unknown>);
            const label = humanizeToolResult(toolName, output);

            results.push({ type: "log", stream: "stdout", content: callLabel });
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
          const tokens = (part.tokens ?? part.usage ?? raw) as {
            input?: number;
            output?: number;
            total?: number;
            cache?: { read?: number; write?: number };
          };
          const input = Number(tokens?.input ?? 0);
          const output = Number(tokens?.output ?? 0);
          const cacheRead = Number(tokens?.cache?.read ?? 0);
          const cacheWrite = Number(tokens?.cache?.write ?? 0);
          const total = Number(tokens?.total ?? input + output);

          // cost in USD for this step
          const stepCostUsd = Number(part.cost ?? 0);
          const stepCostMicro = Math.round(stepCostUsd * 1_000_000);

          // split cost proportional to input vs output tokens
          const stepTotalTokens = input + output;
          const inputRatio = stepTotalTokens > 0 ? input / stepTotalTokens : 0.5;
          const stepInputCost = Math.round(stepCostMicro * inputRatio);
          const stepOutputCost = stepCostMicro - stepInputCost;

          if (accumulators) {
            accumulators.input_tokens += input;
            accumulators.output_tokens += output;
            accumulators.total_tokens += total;
            accumulators.cached += cacheRead;
            accumulators.input_cost += stepInputCost;
            accumulators.output_cost += stepOutputCost;
            accumulators.total_cost += stepCostMicro;

            results.push({
              type: "cost",
              costStats: {
                total_tokens: accumulators.total_tokens,
                input_tokens: accumulators.input_tokens,
                output_tokens: accumulators.output_tokens,
                cached: accumulators.cached || undefined,
                input: accumulators.input_cost,
                output: accumulators.output_cost,
                total: accumulators.total_cost,
              },
            });
          } else {
            // fallback if no accumulator (e.g. standard tests)
            if (input || output || cacheRead || cacheWrite || total) {
              results.push({
                type: "cost",
                costStats: {
                  total_tokens: total,
                  input_tokens: input,
                  output_tokens: output,
                  cached: cacheRead || undefined,
                  input: stepInputCost || undefined,
                  output: stepOutputCost || undefined,
                  total: stepCostMicro || undefined,
                },
              });
            }
          }

          if (input || output || cacheRead || cacheWrite || total) {
            const cacheNote =
              cacheRead || cacheWrite
                ? `  (cache r:${cacheRead.toLocaleString()} w:${cacheWrite.toLocaleString()})`
                : "";
            results.push({
              type: "log",
              stream: "system",
              content: `  tokens in:${input.toLocaleString()} out:${output.toLocaleString()}${cacheNote}`,
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
