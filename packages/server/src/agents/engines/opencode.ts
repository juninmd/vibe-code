import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import type { Subprocess } from "bun";

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

  async *execute(prompt: string, workdir: string, options?: EngineOptions): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[opencode] Starting in ${workdir}` };

    const proc = Bun.spawn(
      ["opencode", "run", "--format", "json", prompt],
      { cwd: workdir, stdout: "pipe", stderr: "pipe", stdin: "pipe" }
    );

    if (options?.runId) this.processes.set(options.runId, proc);

    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        proc.kill();
      });
    }

    // Collect events from both stdout and stderr into a shared queue
    const eventQueue: AgentEvent[] = [];
    const waiting: { resolve: (() => void) | null } = { resolve: null };
    let stdoutDone = false;
    let stderrDone = false;

    const push = (event: AgentEvent) => {
      eventQueue.push(event);
      if (waiting.resolve) {
        waiting.resolve();
        waiting.resolve = null;
      }
    };

    // Stream stderr in parallel
    const stderrTask = (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              push({ type: "log", stream: "stderr", content: line });
            }
          }
        }
        if (buffer.trim()) {
          push({ type: "log", stream: "stderr", content: buffer });
        }
      } finally {
        reader.releaseLock();
        stderrDone = true;
        if (waiting.resolve) { waiting.resolve(); waiting.resolve = null; }
      }
    })();

    // Stream stdout in parallel
    const stdoutTask = (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as { type: string; part?: Record<string, unknown> };
              const part = event.part ?? {};
              if (event.type === "text" && part.text) {
                push({ type: "log", stream: "stdout", content: String(part.text) });
              } else if (event.type === "tool_use" && part.tool) {
                push({ type: "log", stream: "stdout", content: `[tool] ${String(part.tool)}` });
              } else if (event.type === "tool_result" && part.content) {
                push({ type: "log", stream: "stdout", content: `[tool result] ${String(part.content)}` });
              } else if (event.type === "error") {
                const msg = String((part as Record<string, unknown>).message ?? line);
                push({ type: "log", stream: "stderr", content: msg });
              }
            } catch {
              push({ type: "log", stream: "stdout", content: line });
            }
          }
        }
        if (buffer.trim()) {
          push({ type: "log", stream: "stdout", content: buffer });
        }
      } finally {
        reader.releaseLock();
        stdoutDone = true;
        if (waiting.resolve) { waiting.resolve(); waiting.resolve = null; }
      }
    })();

    // Yield events as they arrive from either stream
    while (true) {
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }
      if (stdoutDone && stderrDone && eventQueue.length === 0) break;
      await new Promise<void>((r) => { waiting.resolve = r; });
    }

    // Wait for both tasks and process exit
    await Promise.all([stdoutTask, stderrTask]);
    const exitCode = await proc.exited;
    if (options?.runId) this.processes.delete(options.runId);

    if (exitCode !== 0) {
      yield { type: "error", content: `OpenCode exited with code ${exitCode}` };
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
}
