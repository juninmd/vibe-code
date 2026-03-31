import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

  // Generic fallback — show tool name in readable form
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
    return `    Saved`;
  }
  if (t.includes("web") || t.includes("fetch")) {
    return `    ${lines} line${lines !== 1 ? "s" : ""} fetched`;
  }
  // For others, show a brief preview only if it's short
  if (text.length <= 80) return `    ${preview}`;
  return null; // suppress long noisy outputs
}

function str(v: unknown): string {
  return v != null ? String(v) : "";
}

// Filter/humanize stderr — OpenCode emits internal debug logs and JSON to stderr.
// Return null to suppress, or a human-readable string to show.
function humanizeStderr(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Try to parse as JSON — internal structured logs from the CLI
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const level = str(obj.level ?? obj.severity ?? "").toLowerCase();
    const msg = str(obj.message ?? obj.msg ?? obj.text ?? "");

    // Suppress debug/trace level noise
    if (level === "debug" || level === "trace" || level === "verbose") return null;

    // Suppress internal OpenCode lifecycle messages
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
    // Plain text stderr
  }

  // Suppress common debug patterns
  if (
    trimmed.startsWith("DEBUG") ||
    trimmed.startsWith("TRACE") ||
    trimmed.match(/^\d{4}-\d{2}-\d{2}T.*\[DEBUG\]/) ||
    trimmed.match(/^\[debug\]/i) ||
    trimmed.match(/^INF /) ||
    trimmed.match(/^DBG /)
  )
    return null;

  // Handle OpenCode structured log format: INFO  <ISO-date> +<ms>ms service=<name> [key=value...] <message>
  // e.g. "INFO  2026-03-30T21:06:05 +283ms service=default version=1.2.26 opencode"
  const opencodeLogMatch = trimmed.match(/^INFO\s+\S+\s+\+\d+ms\s+service=(\S+)\s+(.*)/);
  if (opencodeLogMatch) {
    const service = opencodeLogMatch[1];
    const rest = opencodeLogMatch[2];
    // Only surface meaningful user-visible events
    if (service === "llm") {
      const modelMatch = rest.match(/modelID=(\S+)/);
      if (modelMatch) return `  Using model: ${modelMatch[1]}`;
    }
    if (service === "tools") {
      const toolMatch = rest.match(/tool=(\S+)/);
      if (toolMatch) return `  Tool: ${toolMatch[1]}`;
    }
    // Suppress all other internal service noise
    return null;
  }

  // Handle WARN/ERROR lines from OpenCode structured logs
  const opencodeWarnMatch = trimmed.match(/^(WARN|ERROR)\s+\S+\s+\+\d+ms\s+service=\S+\s+(.*)/);
  if (opencodeWarnMatch) {
    const level = opencodeWarnMatch[1];
    const msg = opencodeWarnMatch[2].replace(/\w+=\S+\s*/g, "").trim();
    if (msg) return `[${level}] ${msg}`;
    return null;
  }

  return trimmed;
}

export class OpenCodeEngine implements AgentEngine {
  name = "opencode";
  displayName = "OpenCode";
  private processes = new Map<string, Subprocess>();

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

    // Write opencode.json with all permissions pre-approved so OpenCode doesn't
    // prompt for tool approval in non-interactive mode (which would cause a hang).
    const configPath = join(workdir, "opencode.json");
    await writeFile(
      configPath,
      JSON.stringify({ permission: { "*": "allow" } }, null, 2),
      "utf8"
    );

    // Write stdout to a temp file to avoid Windows pipe block-buffering.
    // On Windows, subprocess stdout piped via Bun.spawn is block-buffered (64KB),
    // meaning no data flows until the buffer fills or the process exits.
    // Writing to a file bypasses this issue entirely.
    const tmpFile = join(
      tmpdir(),
      `opencode-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
    );

    const proc = Bun.spawn(
      ["opencode", "run", "--format", "json", "--model", model, prompt],
      { cwd: workdir, stdout: Bun.file(tmpFile), stderr: "pipe", stdin: "pipe" }
    );

    // Close stdin immediately so opencode enters non-interactive mode and
    // auto-approves file write permissions without waiting for user input.
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

    const queue: AgentEvent[] = [];
    let processDone = false;
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

    // Task 1 — stream stderr live (stderr is not block-buffered)
    const stderrTask = (async () => {
      const reader = proc.stderr.getReader();
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
      } finally {
        reader.releaseLock();
      }
    })();

    // Task 2 — poll stdout file every 1.5 s for partial JSON events.
    // OpenCode writes JSON lines to the file; even with OS buffering we get
    // periodic flushes so the user sees tool calls as they happen.
    let stdoutLinesProcessed = 0;
    const stdoutPollTask = (async () => {
      while (!processDone) {
        await new Promise((r) => setTimeout(r, 1500));
        if (processDone) break;
        try {
          const content = await Bun.file(tmpFile).text();
          const lines = content.split("\n");
          for (let i = stdoutLinesProcessed; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            for (const event of this.parseLine(line)) push(event);
            stdoutLinesProcessed++;
          }
        } catch {
          // File not flushed yet or doesn't exist
        }
      }
    })();

    // Task 3 — heartbeat every 30 s so the user knows the agent is alive
    const startedAt = Date.now();
    const heartbeatTask = (async () => {
      while (!processDone) {
        await new Promise((r) => setTimeout(r, 30_000));
        if (processDone) break;
        const secs = Math.round((Date.now() - startedAt) / 1000);
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        const elapsed = mins > 0 ? `${mins}m ${s}s` : `${s}s`;
        push({ type: "log", stream: "system", content: `  Still running... ${elapsed}` });
      }
    })();

    // Yield all events as they arrive, until the process exits
    const exitCode = await proc.exited;
    processDone = true;
    notify();

    await Promise.all([stderrTask, stdoutPollTask, heartbeatTask]);

    // Final pass — read any remaining stdout lines not yet picked up by the poll
    try {
      const content = await Bun.file(tmpFile).text();
      const lines = content.split("\n");
      for (let i = stdoutLinesProcessed; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        for (const event of this.parseLine(line)) push(event);
      }
    } catch {
      // stdout file might not exist if process failed immediately before writing
    } finally {
      try { await rm(tmpFile); } catch {}
      // Remove the config file we injected — don't include it in git commits
      try { await rm(configPath); } catch {}
    }

    // Drain remaining queue
    while (queue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      yield queue.shift()!;
    }

    if (options?.runId) this.processes.delete(options.runId);

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

  private parseLine(line: string): AgentEvent[] {
    const results: AgentEvent[] = [];
    const jsonObjects = line.split(/(?<=\})\s*(?=\{)/);

    for (const jsonStr of jsonObjects) {
      try {
        const event = JSON.parse(jsonStr) as {
          type: string;
          part?: Record<string, unknown>;
          timestamp?: number;
        };
        const part = event.part ?? {};
        const partType = String(part.type ?? event.type);

        // Text output from the model — show as-is
        if (event.type === "text" && (part.text || part.content)) {
          results.push({
            type: "log",
            stream: "stdout",
            content: String(part.text ?? part.content),
          });
          continue;
        }

        // Tool usage / Tool result
        if (event.type === "tool_use" || event.type === "tool" || partType === "tool") {
          const toolName = String(part.tool ?? part.name ?? "unknown");
          const state = (part.state ?? {}) as Record<string, unknown>;
          const status = state.status ?? "calling";
          const input = (state.input ?? part.input ?? {}) as Record<string, unknown>;
          const output = state.output ?? part.output ?? part.content;

          if (status === "calling" || !status) {
            const label = humanizeToolCall(toolName, input);
            results.push({ type: "status", content: label });
            results.push({ type: "log", stream: "stdout", content: label });
          } else if (status === "completed") {
            const label = humanizeToolResult(toolName, output);
            if (label) results.push({ type: "log", stream: "stdout", content: label });
          }
          continue;
        }

        // Thinking / reasoning — show a brief indicator, not the full blob
        if ((event.type === "thinking" || partType === "thinking") && part.text) {
          results.push({ type: "status", content: "Thinking..." });
          continue;
        }

        // Step boundaries
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

        // Errors
        if (event.type === "error" || partType === "error") {
          results.push({
            type: "log",
            stream: "stderr",
            content: String(part.message ?? part.error ?? "Unknown error"),
          });
          continue;
        }

        // Progress updates
        if (event.type === "progress" || partType === "progress") {
          const msg = String(part.message ?? "Working...");
          results.push({ type: "status", content: msg });
          results.push({ type: "log", stream: "system", content: `  ${msg}` });
        }

        // Silently drop heartbeats and other noise
      } catch {
        // Not JSON — show as raw output only if it looks meaningful
        const trimmed = jsonStr.trim();
        if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
          results.push({ type: "log", stream: "stdout", content: trimmed });
        }
      }
    }
    return results;
  }
}
