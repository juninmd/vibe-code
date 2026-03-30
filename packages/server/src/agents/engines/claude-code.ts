import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { streamProcess } from "../stream-process";

export class ClaudeCodeEngine implements AgentEngine {
  name = "claude-code";
  displayName = "Claude Code";
  private processes = new Map<string, Subprocess>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    // Claude CLI does not provide a model listing command
    return [];
  }

  async *execute(
    prompt: string,
    workdir: string,
    options?: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[claude-code] Starting in ${workdir}` };

    const args = ["claude", "--print", "--verbose", "--output-format", "stream-json"];
    if (options?.model) args.push("--model", options.model);
    args.push("-p", prompt);

    const proc = Bun.spawn(args, { cwd: workdir, stdout: "pipe", stderr: "pipe", stdin: "pipe" });

    if (options?.runId) this.processes.set(options.runId, proc);

    yield* streamProcess(
      proc,
      (line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "assistant" && parsed.content) {
            const events: AgentEvent[] = [];
            for (const block of parsed.content) {
              if (block.type === "text") {
                events.push({ type: "log", stream: "stdout", content: block.text });
              } else if (block.type === "tool_use") {
                events.push({
                  type: "log",
                  stream: "system",
                  content: `[tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`,
                });
              }
            }
            return events;
          }
          return [];
        } catch {
          return [{ type: "log", stream: "stdout", content: line }];
        }
      },
      options?.signal
    );

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
      sink.write(`${input}\n`);
      sink.flush();
      return true;
    } catch {
      return false;
    }
  }
}
