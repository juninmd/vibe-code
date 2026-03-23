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
      ["opencode", "run", "--format", "json", "--print-logs", prompt],
      { cwd: workdir, stdout: "pipe", stderr: "pipe", stdin: "pipe" }
    );

    if (options?.runId) this.processes.set(options.runId, proc);

    yield* streamProcess(proc, (line) => {
      try {
        const event = JSON.parse(line) as { type: string; part?: Record<string, unknown> };
        const part = event.part ?? {};
        const partType = String(part.type ?? event.type);

        // Text output from the model
        if (event.type === "text" && part.text) {
          return [{ type: "log", stream: "stdout", content: String(part.text) }];
        }

        // Tool usage — opencode uses part.name (not part.tool)
        if (event.type === "tool_use") {
          const toolName = String(part.name ?? part.tool ?? "unknown");
          const input = part.input ? ` ${JSON.stringify(part.input).slice(0, 200)}` : "";
          return [{ type: "log", stream: "stdout", content: `[tool] ${toolName}${input}` }];
        }

        // Tool result
        if (event.type === "tool_result") {
          const content = part.content ?? part.output ?? part.text;
          if (content) {
            const text = typeof content === "string" ? content : JSON.stringify(content);
            return [{ type: "log", stream: "stdout", content: `[tool result] ${text.slice(0, 500)}` }];
          }
          return [{ type: "log", stream: "stdout", content: "[tool result] (done)" }];
        }

        // Thinking / reasoning
        if (event.type === "thinking" && part.text) {
          return [{ type: "log", stream: "stdout", content: `[thinking] ${String(part.text).slice(0, 300)}` }];
        }

        // Step boundaries
        if (event.type === "step_start") {
          return [{ type: "log", stream: "system", content: "[opencode] Step started" }];
        }
        if (event.type === "step_finish") {
          const reason = part.reason ? ` (${String(part.reason)})` : "";
          const tokens = part.tokens as Record<string, number> | undefined;
          const tokenInfo = tokens?.total ? ` — ${tokens.total} tokens` : "";
          return [{ type: "log", stream: "system", content: `[opencode] Step finished${reason}${tokenInfo}` }];
        }

        // Errors
        if (event.type === "error") {
          const msg = String((part as Record<string, unknown>).message ?? line);
          return [{ type: "log", stream: "stderr", content: msg }];
        }

        // Fallback: don't silently drop unknown events
        return [{ type: "log", stream: "stdout", content: `[${partType}] ${JSON.stringify(part).slice(0, 300)}` }];
      } catch {
        // Not JSON — show as raw output
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
