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

    // Use --print-logs to see internal agent steps in stderr
    // Use --format json for structured output in stdout
    const proc = Bun.spawn(
      ["opencode", "run", "--format", "json", "--print-logs", prompt],
      { cwd: workdir, stdout: "pipe", stderr: "pipe", stdin: "pipe" }
    );

    if (options?.runId) this.processes.set(options.runId, proc);

    yield* streamProcess(proc, (line) => {
      // Sometimes multiple JSON objects are on the same line if they arrive quickly
      const results: AgentEvent[] = [];
      const jsonObjects = line.split(/(?<=\})\s*(?=\{)/);

      for (const jsonStr of jsonObjects) {
        try {
          const event = JSON.parse(jsonStr) as { type: string; part?: Record<string, any>; timestamp?: number };
          const part = event.part ?? {};
          const partType = String(part.type ?? event.type);

          // Text output from the model
          if (event.type === "text" && (part.text || part.content)) {
            const text = part.text ?? part.content;
            results.push({ type: "log", stream: "stdout", content: String(text) });
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
            const msg = String(part.message ?? part.error ?? jsonStr);
            results.push({ type: "log", stream: "stderr", content: msg });
            continue;
          }

          // Progress updates
          if (event.type === "progress" || partType === "progress") {
            const msg = String(part.message ?? "Working...");
            results.push({ type: "status", content: msg });
            results.push({ type: "log", stream: "system", content: `[progress] ${msg}` });
            continue;
          }

          // Fallback: don't silently drop unknown events but keep it clean
          if (event.type !== "heartbeat") {
            results.push({ type: "log", stream: "system", content: `[${partType}] ${JSON.stringify(part).slice(0, 200)}` });
          }
        } catch {
          // Not JSON — show as raw output
          results.push({ type: "log", stream: "stdout", content: jsonStr });
        }
      }
      return results;
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
