import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import type { Subprocess } from "bun";
import { streamProcess } from "../stream-process";

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

  async listModels(): Promise<string[]> {
    try {
      const proc = Bun.spawn(["aider", "--list-models", ""], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      const text = await new Response(proc.stdout).text();
      return text
        .split("\n")
        .map((l) => l.replace(/^-\s*/, "").trim())
        .filter((l) => l && !l.startsWith("Aider") && !l.startsWith("Model"));
    } catch {
      return [];
    }
  }

  async *execute(prompt: string, workdir: string, options?: EngineOptions): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[aider] Starting in ${workdir}` };

    const args = ["aider", "--yes-always", "--no-auto-commits"];
    if (options?.model) args.push("--model", options.model);
    args.push("--message", prompt);

    const proc = Bun.spawn(
      args,
      { cwd: workdir, stdout: "pipe", stderr: "pipe", stdin: "pipe" }
    );

    if (options?.runId) this.processes.set(options.runId, proc);

    yield* streamProcess(proc, (line) => {
      return [{ type: "log", stream: "stdout", content: line }];
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
