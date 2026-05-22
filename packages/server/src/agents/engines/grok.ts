import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

export class GrokEngine implements AgentEngine {
  name = "grok";
  displayName = "Grok";
  binaryName = "grok";
  private processes = new Map<string, Subprocess>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["grok", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["grok", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<string[]> {
    return ["grok-build"];
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[grok] Starting in ${workdir}` };

    const args = ["grok", "--cwd", workdir, "--output-format", "streaming-json"];

    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
    }
    if (options.model && options.model !== "grok-build") {
      args.push("--model", options.model);
    }

    args.push("--permission-mode", "dontAsk");
    args.push("--always-approve");
    args.push("--disable-web-search");
    args.push("--single", prompt);

    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env,
    });

    if (options.runId) {
      const stale = this.processes.get(options.runId);
      if (stale) {
        try {
          stale.kill();
        } catch {
          /* best effort */
        }
      }
      this.processes.set(options.runId, proc);
    }

    const parseGrokLine = (line: string): AgentEvent[] => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      try {
        const event = JSON.parse(trimmed);
        const type = typeof event.type === "string" ? event.type.trim() : "";
        if (type === "thought") {
          const data = typeof event.data === "string" ? event.data : "";
          if (data) {
            return [{ type: "log", stream: "stdout", content: data }];
          }
        } else if (type === "text") {
          const data = typeof event.data === "string" ? event.data : "";
          if (data) {
            return [{ type: "log", stream: "stdout", content: data }];
          }
        } else if (type === "end") {
          const sessionId =
            typeof event.sessionId === "string" ? event.sessionId.trim() : undefined;
          const events: AgentEvent[] = [];
          if (sessionId) {
            events.push({ type: "session", sessionId });
          }
          return events;
        } else if (type === "error") {
          const errorVal = event.error ?? event.message ?? event.detail ?? event.data;
          const errText = typeof errorVal === "string" ? errorVal : JSON.stringify(errorVal);
          if (errText) {
            return [{ type: "error", content: errText }];
          }
        }
      } catch {
        return [{ type: "log", stream: "stdout", content: trimmed }];
      }
      return [];
    };

    try {
      yield* withHeartbeat(
        streamProcess(proc, parseGrokLine, options.signal),
        getHeartbeatIntervalMs(),
        options.signal
      );
    } finally {
      if (options.runId) this.processes.delete(options.runId);
    }
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
