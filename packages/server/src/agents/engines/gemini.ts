import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { streamProcess } from "../stream-process";

export class GeminiEngine implements AgentEngine {
  name = "gemini";
  displayName = "Gemini CLI";
  private processes = new Map<string, Subprocess>();

  private getApiKey(): string | null {
    const raw = process.env.GEMINI_API_KEY;
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Accept values pasted as "GEMINI_API_KEY=..." in settings.
    if (trimmed.startsWith("GEMINI_API_KEY=")) {
      const fromEnvLike = trimmed.slice("GEMINI_API_KEY=".length).trim();
      return fromEnvLike || null;
    }
    return trimmed;
  }

  private buildGeminiChildEnv(apiKey: string): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // Avoid Gemini IDE client binding when running in detached task worktrees.
    delete env.GEMINI_CLI_IDE_SERVER_PORT;
    delete env.GEMINI_CLI_IDE_WORKSPACE_PATH;
    delete env.GEMINI_CLI_IDE_AUTH_TOKEN;
    delete env.TERM_PROGRAM;
    delete env.VSCODE_INJECTION;
    delete env.VSCODE_GIT_ASKPASS_NODE;
    delete env.VSCODE_GIT_ASKPASS_EXTRA_ARGS;
    delete env.VSCODE_GIT_ASKPASS_MAIN;
    delete env.VSCODE_GIT_IPC_HANDLE;
    env.GEMINI_API_KEY = apiKey;
    return env;
  }

  private async hasCli(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["gemini", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.hasCli();
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["gemini", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<string[]> {
    // Gemini CLI does not provide a model listing command
    return [];
  }

  async getSetupIssue(): Promise<string | null> {
    if (!(await this.hasCli())) return "Gemini CLI não instalado";
    if (!this.getApiKey()) return "GEMINI_API_KEY não configurada";
    return null;
  }

  async *execute(
    prompt: string,
    workdir: string,
    options?: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[gemini] Starting in ${workdir}` };
    yield {
      type: "log",
      stream: "system",
      content: `[gemini] Run context: model=${options?.model ?? "default"}, runId=${options?.runId ?? "n/a"}`,
    };

    const apiKey = this.getApiKey();
    if (!apiKey) {
      yield {
        type: "log",
        stream: "system",
        content: "[gemini] Debug: GEMINI_API_KEY ausente no processo do servidor",
      };
      throw new Error("GEMINI_API_KEY não configurada no servidor");
    }

    yield {
      type: "log",
      stream: "system",
      content: `[gemini] Debug: GEMINI_API_KEY detectada (len=${apiKey.length}, prefix=${apiKey.slice(0, 3)}...)`,
    };

    const args = ["gemini", "--yolo"];
    if (options?.model) args.push("-m", options.model);
    args.push("-p", prompt);

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: this.buildGeminiChildEnv(apiKey),
    });

    yield {
      type: "log",
      stream: "system",
      content:
        "[gemini] Process started with GEMINI_API_KEY injected and IDE-related env removed from child env",
    };

    if (options?.runId) this.processes.set(options.runId, proc);

    yield* streamProcess(
      proc,
      (line) => {
        const events: AgentEvent[] = [{ type: "log", stream: "stdout", content: line }];
        if (line.includes("you must specify the GEMINI_API_KEY environment variable")) {
          events.push({
            type: "log",
            stream: "system",
            content:
              "[gemini] Debug: Gemini CLI reportou chave ausente no child process mesmo após injeção. Verifique se a chave salva é válida e sem espaços/quebras extras.",
          });
        }
        return events;
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
