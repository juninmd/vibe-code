import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import type { Subprocess } from "bun";

export class AiderEngine implements AgentEngine {
  name = "aider";
  displayName = "Aider";
  private processes = new Map<string, Subprocess>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["aider", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async *execute(prompt: string, workdir: string, options?: EngineOptions): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[aider] Starting in ${workdir}` };

    const proc = Bun.spawn(
      ["aider", "--yes-always", "--no-auto-commits", "--message", prompt],
      { cwd: workdir, stdout: "pipe", stderr: "pipe", stdin: "pipe" }
    );

    if (options?.runId) this.processes.set(options.runId, proc);

    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        proc.kill();
      });
    }

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
          if (line.trim()) {
            yield { type: "log", stream: "stdout", content: line };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const stderr = await new Response(proc.stderr).text();
    if (stderr.trim()) {
      yield { type: "log", stream: "stderr", content: stderr };
    }

    const exitCode = await proc.exited;
    if (options?.runId) this.processes.delete(options.runId);

    if (exitCode !== 0) {
      yield { type: "error", content: `Aider exited with code ${exitCode}` };
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
