import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

export class AcpxEngine implements AgentEngine {
  name = "acpx";
  displayName = "ACPX";
  binaryName = "acpx";
  private processes = new Map<string, Subprocess>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["acpx", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["acpx", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<string[]> {
    return ["claude", "codex"];
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[acpx] Starting in ${workdir}` };

    const args = ["acpx", "--cwd", workdir];

    const agent = options.env?.ACPX_AGENT || "claude";
    args.push("--agent", agent);

    const permissionMode = options.env?.ACPX_PERMISSION_MODE || "approve-all";
    args.push("--permission-mode", permissionMode);

    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
    }
    if (options.model) {
      args.push("--model", options.model);
    }

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

    const parseAcpxLine = (line: string): AgentEvent[] => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      try {
        const event = JSON.parse(trimmed);
        const type = typeof event.type === "string" ? event.type.trim() : "";

        if (type === "acpx.session") {
          const sessionId =
            typeof event.acpSessionId === "string"
              ? event.acpSessionId.trim()
              : typeof event.sessionId === "string"
                ? event.sessionId.trim()
                : typeof event.runtimeSessionName === "string"
                  ? event.runtimeSessionName.trim()
                  : undefined;
          const events: AgentEvent[] = [];
          if (sessionId) {
            events.push({ type: "session", sessionId });
          }
          return events;
        }
        if (type === "acpx.text_delta") {
          const text = typeof event.text === "string" ? event.text : "";
          if (text) {
            return [{ type: "log", stream: "stdout", content: text }];
          }
        }
        if (type === "acpx.tool_call") {
          const name = typeof event.name === "string" ? event.name : "acp_tool";
          const id =
            typeof event.toolCallId === "string"
              ? event.toolCallId
              : typeof event.toolUseId === "string"
                ? event.toolUseId
                : typeof event.id === "string"
                  ? event.id
                  : "tool-id";
          const parameters =
            event.input && typeof event.input === "object" ? event.input : undefined;
          return [
            {
              type: "tool_use",
              toolUse: {
                toolName: name,
                toolId: id,
                parameters,
              },
            },
          ];
        }
        if (type === "acpx.tool_result") {
          const id =
            typeof event.toolCallId === "string"
              ? event.toolCallId
              : typeof event.toolUseId === "string"
                ? event.toolUseId
                : typeof event.id === "string"
                  ? event.id
                  : "tool-id";
          const content = event.content ?? event.output ?? event.error;
          const contentStr = typeof content === "string" ? content : JSON.stringify(content);
          const isError = event.isError === true || event.error !== undefined;
          return [
            {
              type: "tool_result",
              toolResult: {
                toolId: id,
                output: contentStr,
                status: isError ? "error" : "success",
              },
            },
          ];
        }
        if (type === "acpx.status") {
          const text = typeof event.text === "string" ? event.text : "";
          const tag = typeof event.tag === "string" ? event.tag : "";
          const statusText = text || tag || "status";
          return [{ type: "status", content: statusText }];
        }
        if (type === "acpx.result") {
          const summary =
            typeof event.summary === "string"
              ? event.summary
              : typeof event.stopReason === "string"
                ? event.stopReason
                : typeof event.subtype === "string"
                  ? event.subtype
                  : "complete";
          return [{ type: "status", content: summary }];
        }
        if (type === "acpx.error") {
          const message = typeof event.message === "string" ? event.message : trimmed;
          return [{ type: "error", content: message }];
        }
      } catch {
        return [{ type: "log", stream: "stdout", content: trimmed }];
      }
      return [];
    };

    try {
      yield* withHeartbeat(
        streamProcess(proc, parseAcpxLine, options.signal),
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
