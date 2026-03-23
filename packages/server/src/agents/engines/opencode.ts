import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import type { Subprocess } from "bun";
import { streamProcess } from "../stream-process";

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

    yield* streamProcess(proc, (line) => {
      try {
        const event = JSON.parse(line) as { type: string; part?: Record<string, unknown> };
        const part = event.part ?? {};
        if (event.type === "text" && part.text) {
          return [{ type: "log", stream: "stdout", content: String(part.text) }];
        } else if (event.type === "tool_use" && part.tool) {
          return [{ type: "log", stream: "stdout", content: `[tool] ${String(part.tool)}` }];
        } else if (event.type === "tool_result" && part.content) {
          return [{ type: "log", stream: "stdout", content: `[tool result] ${String(part.content)}` }];
        } else if (event.type === "error") {
          const msg = String((part as Record<string, unknown>).message ?? line);
          return [{ type: "log", stream: "stderr", content: msg }];
        }
        return [];
      } catch {
        return [{ type: "log", stream: "stdout", content: line }];
      }
    }, options?.signal);

    if (options?.runId) this.processes.delete(options.runId);
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
