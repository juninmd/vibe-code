import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import type { Subprocess } from "bun";

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

  async *execute(prompt: string, workdir: string, options?: EngineOptions): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[claude-code] Starting in ${workdir}` };

    const proc = Bun.spawn(
      ["claude", "--print", "--output-format", "stream-json", "-p", prompt],
      { cwd: workdir, stdout: "pipe", stderr: "pipe" }
    );

    if (options?.runId) this.processes.set(options.runId, proc);

    // Handle abort signal
    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        proc.kill();
      });
    }

    // Stream stdout
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
            const parsed = JSON.parse(line);
            if (parsed.type === "assistant" && parsed.content) {
              for (const block of parsed.content) {
                if (block.type === "text") {
                  yield { type: "log", stream: "stdout", content: block.text };
                } else if (block.type === "tool_use") {
                  yield { type: "log", stream: "system", content: `[tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}` };
                }
              }
            }
          } catch {
            yield { type: "log", stream: "stdout", content: line };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Stream any remaining stderr
    const stderr = await new Response(proc.stderr).text();
    if (stderr.trim()) {
      yield { type: "log", stream: "stderr", content: stderr };
    }

    const exitCode = await proc.exited;
    if (options?.runId) this.processes.delete(options.runId);

    if (exitCode !== 0) {
      yield { type: "error", content: `Claude Code exited with code ${exitCode}` };
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
}
