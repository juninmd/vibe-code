import type { TerminalSignal } from "@vibe-code/shared";

interface TerminalSession {
  taskId: string;
  runId: string | null;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  cols: number;
  rows: number;
  stdinBytesInWindow: number;
  windowStartedAt: number;
}

interface OpenSessionOptions {
  taskId: string;
  runId: string | null;
  cwd?: string;
  cols?: number;
  rows?: number;
}

interface TerminalSessionCallbacks {
  onOpened: (taskId: string, runId: string | null, cols: number, rows: number) => void;
  onOutput: (
    taskId: string,
    runId: string | null,
    stream: "stdout" | "stderr",
    chunk: string
  ) => void;
  onClosed: (taskId: string, runId: string | null, exitCode: number | null) => void;
  onError: (taskId: string, runId: string | null, message: string) => void;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MAX_INPUT_BYTES_PER_MESSAGE = 4_096;
const MAX_INPUT_BYTES_PER_SECOND = 16_384;

function resolveShellCommand(): string[] {
  if (process.platform === "win32") {
    return ["powershell.exe", "-NoLogo"];
  }

  const shell = process.env.SHELL?.trim();
  if (shell) return [shell];
  return ["/bin/bash"];
}

export class TerminalSessionService {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly callbacks: TerminalSessionCallbacks) {}

  isOpen(taskId: string): boolean {
    return this.sessions.has(taskId);
  }

  openSession(options: OpenSessionOptions): boolean {
    if (this.sessions.has(options.taskId)) {
      const existing = this.sessions.get(options.taskId);
      if (existing) {
        this.callbacks.onOpened(existing.taskId, existing.runId, existing.cols, existing.rows);
      }
      return true;
    }

    try {
      const command = resolveShellCommand();
      const proc = Bun.spawn(command, {
        cwd: options.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      const session: TerminalSession = {
        taskId: options.taskId,
        runId: options.runId,
        proc,
        cols: options.cols ?? DEFAULT_COLS,
        rows: options.rows ?? DEFAULT_ROWS,
        stdinBytesInWindow: 0,
        windowStartedAt: Date.now(),
      };
      this.sessions.set(options.taskId, session);

      this.readStream(session, "stdout");
      this.readStream(session, "stderr");
      this.watchExit(session);

      this.callbacks.onOpened(session.taskId, session.runId, session.cols, session.rows);
      console.info("[terminal] INFO: terminal session opened", {
        taskId: session.taskId,
        runId: session.runId,
        cols: session.cols,
        rows: session.rows,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(options.taskId, options.runId, message);
      console.error("[terminal] ERROR: terminal session open failed", {
        taskId: options.taskId,
        runId: options.runId,
        error: message,
      });
      return false;
    }
  }

  closeSession(taskId: string): boolean {
    const session = this.sessions.get(taskId);
    if (!session) return false;

    try {
      session.proc.kill();
    } catch {
      // no-op
    }
    this.sessions.delete(taskId);
    this.callbacks.onClosed(taskId, session.runId, null);
    return true;
  }

  sendInput(taskId: string, input: string): { ok: boolean; reason?: string } {
    const session = this.sessions.get(taskId);
    if (!session) return { ok: false, reason: "session_not_open" };

    const bytes = Buffer.byteLength(input, "utf8");
    if (bytes > MAX_INPUT_BYTES_PER_MESSAGE) {
      console.warn("[terminal] WARN: terminal input rejected by rate limit", {
        taskId,
        runId: session.runId,
        inputBytes: bytes,
        reason: "payload_too_large",
      });
      return { ok: false, reason: "payload_too_large" };
    }

    const now = Date.now();
    if (now - session.windowStartedAt >= 1_000) {
      session.windowStartedAt = now;
      session.stdinBytesInWindow = 0;
    }

    if (session.stdinBytesInWindow + bytes > MAX_INPUT_BYTES_PER_SECOND) {
      console.warn("[terminal] WARN: terminal input rejected by rate limit", {
        taskId,
        runId: session.runId,
        inputBytes: bytes,
        reason: "rate_limited",
      });
      return { ok: false, reason: "rate_limited" };
    }

    try {
      if (!session.proc.stdin || typeof session.proc.stdin === "number") {
        return { ok: false, reason: "stdin_unavailable" };
      }
      session.stdinBytesInWindow += bytes;
      const sink = session.proc.stdin as Bun.FileSink;
      sink.write(input);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(taskId, session.runId, message);
      return { ok: false, reason: "write_failed" };
    }
  }

  resize(taskId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(taskId);
    if (!session) return false;
    // Bun does not expose PTY resize hooks for plain spawn pipes.
    session.cols = Math.max(20, cols);
    session.rows = Math.max(5, rows);
    return true;
  }

  signal(taskId: string, signal: TerminalSignal): boolean {
    const session = this.sessions.get(taskId);
    if (!session) return false;

    try {
      if (signal === "sigint") {
        session.proc.kill("SIGINT");
      } else if (signal === "sigterm") {
        session.proc.kill("SIGTERM");
      } else {
        session.proc.kill("SIGHUP");
      }
      return true;
    } catch {
      return false;
    }
  }

  private async readStream(session: TerminalSession, stream: "stdout" | "stderr"): Promise<void> {
    const source = stream === "stdout" ? session.proc.stdout : session.proc.stderr;
    if (!source || typeof source === "number") return;

    const reader = source.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        this.callbacks.onOutput(session.taskId, session.runId, stream, chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(session.taskId, session.runId, message);
    } finally {
      reader.releaseLock();
    }
  }

  private async watchExit(session: TerminalSession): Promise<void> {
    const exitCode = await session.proc.exited;
    this.sessions.delete(session.taskId);
    this.callbacks.onClosed(
      session.taskId,
      session.runId,
      Number.isNaN(exitCode) ? null : exitCode
    );
  }
}
