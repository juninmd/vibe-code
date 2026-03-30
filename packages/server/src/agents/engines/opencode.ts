import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import type { Subprocess } from "bun";
import { join } from "path";
import { tmpdir } from "os";
import { rm } from "fs/promises";

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
      return text.split("\n").map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  async *execute(prompt: string, workdir: string, options?: EngineOptions): AsyncGenerator<AgentEvent> {
    const model = options?.model ?? "opencode/minimax-m2.5-free";
    yield { type: "log", stream: "system", content: `[opencode] Starting in ${workdir} (model: ${model})` };

    // Write stdout to a temp file to avoid Windows pipe block-buffering.
    // On Windows, subprocess stdout piped via Bun.spawn is block-buffered (64KB),
    // meaning no data flows until the buffer fills or the process exits.
    // Writing to a file bypasses this issue entirely.
    const tmpFile = join(tmpdir(), `opencode-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

    const proc = Bun.spawn(
      ["opencode", "run", "--format", "json", "--print-logs", "--model", model, prompt],
      { cwd: workdir, stdout: Bun.file(tmpFile), stderr: "pipe", stdin: "pipe" }
    );

    // Close stdin immediately so opencode enters non-interactive mode and
    // auto-approves file write permissions without waiting for user input.
    try {
      const sink = proc.stdin as import("bun").FileSink;
      await sink.end();
    } catch { /* ignore */ }

    if (options?.runId) this.processes.set(options.runId, proc);

    if (options?.signal) {
      options.signal.addEventListener("abort", () => proc.kill());
    }

    // Stream stderr live while the process runs (stderr is not affected by block-buffering)
    const queue: AgentEvent[] = [];
    let stderrDone = false;
    let wakeup: (() => void) | null = null;
    const notify = () => { if (wakeup) { const fn = wakeup; wakeup = null; fn(); } };
    const push = (e: AgentEvent) => { queue.push(e); notify(); };

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
          for (const line of lines) if (line.trim()) push({ type: "log", stream: "stderr", content: line });
        }
        if (buf.trim()) push({ type: "log", stream: "stderr", content: buf });
      } finally {
        reader.releaseLock();
        stderrDone = true;
        notify();
      }
    })();

    // Yield stderr events as they arrive, until process exits and stderr is fully drained
    while (!stderrDone || queue.length > 0) {
      while (queue.length > 0) yield queue.shift()!;
      if (!stderrDone) await new Promise<void>(r => { wakeup = r; });
    }

    const exitCode = await proc.exited;
    await stderrTask;

    // After process exits, read stdout file and parse all JSON events
    try {
      const content = await Bun.file(tmpFile).text();
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        for (const event of this.parseLine(line)) yield event;
      }
    } catch {
      // stdout file might not exist if process failed immediately before writing
    } finally {
      try { await rm(tmpFile); } catch {}
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
      sink.write(input + "\n");
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
        const event = JSON.parse(jsonStr) as { type: string; part?: Record<string, any>; timestamp?: number };
        const part = event.part ?? {};
        const partType = String(part.type ?? event.type);

        // Text output from the model
        if (event.type === "text" && (part.text || part.content)) {
          results.push({ type: "log", stream: "stdout", content: String(part.text ?? part.content) });
          continue;
        }

        // Tool usage / Tool result
        if (event.type === "tool_use" || event.type === "tool" || partType === "tool") {
          const toolName = String(part.tool ?? part.name ?? "unknown");
          const state = part.state ?? {};
          const status = state.status ?? "calling";
          const input = state.input ?? part.input;
          const output = state.output ?? part.output ?? part.content;

          if (status === "calling" || !status) {
            const inputStr = input ? ` ${JSON.stringify(input).slice(0, 200)}` : "";
            results.push({ type: "status", content: `Tool: ${toolName}` });
            results.push({ type: "log", stream: "stdout", content: `[tool] ${toolName}${inputStr}` });
          } else if (status === "completed") {
            const outputStr = output ? `: ${typeof output === "string" ? output : JSON.stringify(output)}` : " (done)";
            results.push({ type: "log", stream: "stdout", content: `[tool result] ${toolName}${outputStr.slice(0, 500)}` });
          }
          continue;
        }

        // Thinking / reasoning
        if ((event.type === "thinking" || partType === "thinking") && part.text) {
          results.push({ type: "status", content: "Thinking..." });
          results.push({ type: "log", stream: "system", content: `[thinking] ${String(part.text).trim()}` });
          continue;
        }

        // Step boundaries
        if (event.type === "step_start" || partType === "step-start") {
          results.push({ type: "status", content: "Agent is thinking..." });
          results.push({ type: "log", stream: "system", content: "[opencode] Step started" });
          continue;
        }
        if (event.type === "step_finish" || partType === "step-finish") {
          const reason = part.reason ? ` (${String(part.reason)})` : "";
          const tokens = part.tokens as Record<string, number> | undefined;
          const tokenInfo = tokens?.total ? ` — ${tokens.total} tokens` : "";
          results.push({ type: "log", stream: "system", content: `[opencode] Step finished${reason}${tokenInfo}` });
          continue;
        }

        // Errors
        if (event.type === "error" || partType === "error") {
          results.push({ type: "log", stream: "stderr", content: String(part.message ?? part.error ?? jsonStr) });
          continue;
        }

        // Progress updates
        if (event.type === "progress" || partType === "progress") {
          const msg = String(part.message ?? "Working...");
          results.push({ type: "status", content: msg });
          results.push({ type: "log", stream: "system", content: `[progress] ${msg}` });
          continue;
        }

        // Fallback: don't silently drop unknown events
        if (event.type !== "heartbeat") {
          results.push({ type: "log", stream: "system", content: `[${partType}] ${JSON.stringify(part).slice(0, 200)}` });
        }
      } catch {
        // Not JSON — show as raw output
        results.push({ type: "log", stream: "stdout", content: jsonStr });
      }
    }
    return results;
  }
}
