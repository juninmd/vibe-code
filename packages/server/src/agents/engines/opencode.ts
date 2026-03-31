import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";

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

export class OpenCodeEngine implements AgentEngine {
  name = "opencode";
  displayName = "OpenCode";
  private processes = new Map<string, Subprocess>();

  /** Heartbeat interval (ms). Overridable in tests. */
  protected heartbeatIntervalMs: number;

  constructor(heartbeatIntervalMs = 30_000) {
    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  /**
   * Returns the CLI command to spawn.
   * Override in tests to inject a fake subprocess.
   */
  protected buildCommand(model: string, prompt: string): string[] {
    return ["opencode", "run", "--format", "json", "--model", model, prompt];
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

  async listModels(): Promise<string[]> {
    try {
      const proc = Bun.spawn(["opencode", "models"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return [];
      const text = await new Response(proc.stdout).text();
      return text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async *execute(
    prompt: string,
    workdir: string,
    options?: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    const model = options?.model ?? "opencode/minimax-m2.5-free";
    yield {
      type: "log",
      stream: "system",
      content: `[opencode] Starting in ${workdir} (model: ${model})`,
    };

    // Write opencode.json with permissions pre-configured for non-interactive mode.
    // Allow all tool use but deny question/plan prompts that would wait for user input.
    const configPath = join(workdir, "opencode.json");
    await writeFile(
      configPath,
      JSON.stringify({
        permission: {
          "*": "allow",
          question: "allow",
          plan_enter: "deny",
          plan_exit: "deny",
        },
      }, null, 2),
      "utf8"
    );

    // Use stdout: "pipe" so proc.exited resolves correctly and events stream in
    // real-time. (Using Bun.file() as stdout breaks proc.exited on Windows.)
    const proc = Bun.spawn(this.buildCommand(model, prompt), {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });

    // Close stdin immediately — non-interactive mode.
    try {
      const sink = proc.stdin as import("bun").FileSink;
      await sink.end();
    } catch {
      /* ignore */
    }

    if (options?.runId) this.processes.set(options.runId, proc);
    if (options?.signal) {
      options.signal.addEventListener("abort", () => proc.kill());
    }

    // ─── Shared event queue ────────────────────────────────────────────────
    const queue: AgentEvent[] = [];
    let stdoutDone = false;
    let stderrDone = false;
    let wakeup: (() => void) | null = null;

    const notify = () => {
      if (wakeup) {
        const fn = wakeup;
        wakeup = null;
        fn();
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
        try { reader.releaseLock(); } catch { /* ignore */ }
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
        try { await stdoutReader.cancel(); } catch { /* ignore */ }
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
        try { reader.releaseLock(); } catch { /* ignore */ }
        stderrDone = true;
        notify();
      }
    })();

    // Same cancellation guard for stderr (child processes may hold it open on Windows).
    proc.exited.then(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      if (!stderrDone && stderrReader) {
        try { await stderrReader.cancel(); } catch { /* ignore */ }
      }
    });

    // ─── Task 3: heartbeat ─────────────────────────────────────────────────
    // Emits a "still running" log every heartbeatIntervalMs.
    // Uses a separate flag so we can cancel it without waiting for the next tick.
    let heartbeatActive = true;
    const allDone = () => stdoutDone && stderrDone;
    const startedAt = Date.now();
    const heartbeatTask = (async () => {
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
    while (!allDone() || queue.length > 0) {
      while (queue.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length checked above
        yield queue.shift()!;
      }
      if (!allDone()) {
        await new Promise<void>((r) => {
          wakeup = r;
        });
      }
    }

    // Stop the heartbeat before awaiting — it might be sleeping for up to
    // heartbeatIntervalMs; we don't need to wait for it to wake up.
    heartbeatActive = false;
    await Promise.all([stdoutTask, stderrTask]);
    const exitCode = await proc.exited;

    if (options?.runId) this.processes.delete(options.runId);

    // Cleanup config file — don't include it in git commits
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

    // Robust JSON object extraction: count braces and track quotes
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let start = -1;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === "\\") {
          escape = true;
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
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        results.push({ type: "log", stream: "stdout", content: trimmed });
      }
    }

    for (const jsonStr of jsonObjects) {
      try {
        const event = JSON.parse(jsonStr) as {
          type: string;
          part?: Record<string, unknown>;
          timestamp?: number;
        };
        const part = event.part ?? {};
        const partType = String(part.type ?? event.type);

        if (event.type === "text" && (part.text || part.content)) {
          results.push({
            type: "log",
            stream: "stdout",
            content: String(part.text ?? part.content),
          });
          continue;
        }

        if (event.type === "tool_use" || event.type === "tool" || partType === "tool") {
          const toolName = String(part.tool ?? part.name ?? "unknown");
          const state = (part.state ?? {}) as Record<string, unknown>;
          const status = state.status ?? "calling";
          const input = (state.input ?? part.input ?? {}) as Record<string, unknown>;
          const output = state.output ?? part.output ?? part.content;
          const error = state.error ?? part.error;

          if (status === "calling" || !status) {
            const label = humanizeToolCall(toolName, input);
            results.push({ type: "status", content: label });
            results.push({ type: "log", stream: "stdout", content: label });
          } else if (status === "completed") {
            const metadata = (state.metadata ?? part.metadata ?? {}) as Record<string, unknown>;
            const exitCode = metadata.exitCode ?? metadata.exit;
            const label = humanizeToolResult(toolName, output);
            
            if (label) results.push({ type: "log", stream: "stdout", content: label });
            
            // If it completed but with a non-zero exit code, it's effectively an error
            if (exitCode != null && Number(exitCode) !== 0) {
              results.push({
                type: "log",
                stream: "stderr",
                content: `  Command exited with code ${exitCode}`,
              });
            }
          } else if (status === "failed" || error) {
            const msg = error ? String(error) : "Failed";
            results.push({
              type: "log",
              stream: "stderr",
              content: `  Error in ${toolName}: ${msg}`,
            });
          }
          continue;
        }

        if ((event.type === "thinking" || partType === "thinking") && part.text) {
          results.push({ type: "status", content: "Thinking..." });
          continue;
        }

        if (event.type === "step_start" || partType === "step-start") {
          results.push({ type: "status", content: "Working..." });
          continue;
        }
        if (event.type === "step_finish" || partType === "step-finish") {
          const tokens = part.tokens as Record<string, number> | undefined;
          if (tokens?.total) {
            results.push({
              type: "log",
              stream: "system",
              content: `  tokens used: ${tokens.total.toLocaleString()}`,
            });
          }
          continue;
        }

        if (event.type === "error" || partType === "error") {
          results.push({
            type: "log",
            stream: "stderr",
            content: String(part.message ?? part.error ?? "Unknown error"),
          });
          continue;
        }

        if (event.type === "question" || partType === "question") {
          const msg = String(part.text ?? part.content ?? "Waiting for input...");
          results.push({ type: "status", content: "Awaiting input..." });
          results.push({ type: "log", stream: "stdout", content: `\n[Question] ${msg}` });
          continue;
        }

        if (event.type === "progress" || partType === "progress") {
          const msg = String(part.message ?? "Working...");
          results.push({ type: "status", content: msg });
          results.push({ type: "log", stream: "system", content: `  ${msg}` });
        }
      } catch {
        const trimmed = jsonStr.trim();
        if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
          results.push({ type: "log", stream: "stdout", content: trimmed });
        }
      }
    }
    return results;
  }
}
