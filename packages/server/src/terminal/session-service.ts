import type { TerminalSignal } from "@vibe-code/shared";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as ScreenModel } from "@xterm/headless";
import { killProcessTree } from "../utils/process-tree";

interface TerminalSession {
  taskId: string;
  runId: string | null;
  proc: Bun.Subprocess;
  /** True when the process runs on a real PTY (POSIX); false = plain pipes (Windows). */
  pty: boolean;
  command: string[];
  cols: number;
  rows: number;
  /**
   * Headless model of the screen. Replaying raw output to a late client garbles TUIs
   * (they repaint with relative cursor moves), so reattaching clients get a snapshot
   * of the rendered screen + scrollback instead.
   */
  screen: ScreenModel;
  serializer: SerializeAddon;
  stdinBytesInWindow: number;
  windowStartedAt: number;
  /** Set when the session is being closed on purpose (vs. the process exiting by itself). */
  closing: boolean;
}

export interface OpenSessionOptions {
  taskId: string;
  runId: string | null;
  cwd?: string;
  cols?: number;
  rows?: number;
  /** Command to run. Defaults to the user's shell. */
  command?: string[];
  env?: Record<string, string>;
}

export interface TerminalSessionCallbacks {
  onOpened: (taskId: string, runId: string | null, cols: number, rows: number) => void;
  onOutput: (
    taskId: string,
    runId: string | null,
    stream: "stdout" | "stderr",
    chunk: string
  ) => void;
  onClosed: (
    taskId: string,
    runId: string | null,
    exitCode: number | null,
    reason: "exit" | "closed"
  ) => void;
  onError: (taskId: string, runId: string | null, message: string) => void;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const SCREEN_SCROLLBACK_LINES = 2_000;
// A real terminal receives pasted prompts, so the limits are generous. They only
// guard against runaway clients, not against normal typing.
const MAX_INPUT_BYTES_PER_MESSAGE = 64 * 1024;
const MAX_INPUT_BYTES_PER_SECOND = 1024 * 1024;

export function resolveShellCommand(): string[] {
  if (process.platform === "win32") {
    return ["powershell.exe", "-NoLogo"];
  }

  const shell = process.env.SHELL?.trim();
  if (shell) return [shell];
  return ["/bin/bash"];
}

/** Bun only supports PTYs on POSIX platforms. */
export function supportsPty(): boolean {
  return process.platform !== "win32" && typeof Bun.Terminal === "function";
}

export class TerminalSessionService {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly callbacks: TerminalSessionCallbacks) {}

  isOpen(taskId: string): boolean {
    return this.sessions.has(taskId);
  }

  /**
   * Hand `deliver` the escape sequences that rebuild the current screen and scrollback
   * in a fresh terminal of the same size. It runs synchronously at the exact point of
   * the output stream where the snapshot was taken, so no live chunk can slip in between
   * the snapshot and the chunks that follow it (see emit()). Returns false when there
   * is no live session.
   */
  snapshotTo(taskId: string, deliver: (snapshot: string) => void): boolean {
    const session = this.sessions.get(taskId);
    if (!session) return false;
    session.screen.write("", () =>
      deliver(session.serializer.serialize({ scrollback: SCREEN_SCROLLBACK_LINES }))
    );
    return true;
  }

  async snapshot(taskId: string): Promise<string> {
    return new Promise((resolve) => {
      if (!this.snapshotTo(taskId, resolve)) resolve("");
    });
  }

  getInfo(
    taskId: string
  ): { runId: string | null; cols: number; rows: number; command: string[] } | null {
    const session = this.sessions.get(taskId);
    if (!session) return null;
    return {
      runId: session.runId,
      cols: session.cols,
      rows: session.rows,
      command: session.command,
    };
  }

  openSession(options: OpenSessionOptions): boolean {
    const existing = this.sessions.get(options.taskId);
    if (existing) {
      this.callbacks.onOpened(existing.taskId, existing.runId, existing.cols, existing.rows);
      return true;
    }

    try {
      const command = options.command?.length ? options.command : resolveShellCommand();
      const cols = Math.max(20, options.cols ?? DEFAULT_COLS);
      const rows = Math.max(5, options.rows ?? DEFAULT_ROWS);
      const env = {
        ...process.env,
        ...options.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>;

      const session = {
        taskId: options.taskId,
        runId: options.runId,
        pty: supportsPty(),
        command,
        cols,
        rows,
        screen: new ScreenModel({
          cols,
          rows,
          scrollback: SCREEN_SCROLLBACK_LINES,
          allowProposedApi: true,
        }),
        serializer: new SerializeAddon(),
        stdinBytesInWindow: 0,
        windowStartedAt: Date.now(),
        closing: false,
      } as TerminalSession;

      session.screen.loadAddon(session.serializer);

      if (session.pty) {
        // Streaming decoder: a multi-byte character split across two PTY reads
        // must not turn into replacement characters.
        const decoder = new TextDecoder();
        session.proc = Bun.spawn(command, {
          cwd: options.cwd,
          env,
          terminal: {
            cols,
            rows,
            data: (_terminal, data) => {
              const chunk = decoder.decode(data, { stream: true });
              if (chunk) this.emit(session, "stdout", chunk);
            },
          },
        });
      } else {
        session.proc = Bun.spawn(command, {
          cwd: options.cwd,
          env,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
        this.readStream(session, "stdout");
        this.readStream(session, "stderr");
      }

      this.sessions.set(options.taskId, session);
      this.watchExit(session);

      this.callbacks.onOpened(session.taskId, session.runId, session.cols, session.rows);
      console.info("[terminal] INFO: terminal session opened", {
        taskId: session.taskId,
        runId: session.runId,
        command: command[0],
        pty: session.pty,
        cols,
        rows,
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

    session.closing = true;
    this.sessions.delete(taskId);
    try {
      session.proc.kill();
    } catch {
      // no-op
    }
    // Agent CLIs spawn their own children (tools, language servers).
    if (typeof session.proc.pid === "number") {
      void killProcessTree(session.proc.pid).catch(() => {});
    }
    this.closePty(session);
    this.disposeScreen(session);
    this.callbacks.onClosed(taskId, session.runId, null, "closed");
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
      session.stdinBytesInWindow += bytes;
      if (session.pty) {
        const terminal = session.proc.terminal;
        if (!terminal || terminal.closed) return { ok: false, reason: "stdin_unavailable" };
        terminal.write(input);
        return { ok: true };
      }
      if (!session.proc.stdin || typeof session.proc.stdin === "number") {
        return { ok: false, reason: "stdin_unavailable" };
      }
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
    session.cols = Math.max(20, Math.floor(cols));
    session.rows = Math.max(5, Math.floor(rows));
    session.screen.resize(session.cols, session.rows);
    try {
      if (session.pty && session.proc.terminal && !session.proc.terminal.closed) {
        session.proc.terminal.resize(session.cols, session.rows);
      }
    } catch {
      // The PTY may have just closed; the exit watcher cleans up.
    }
    return true;
  }

  signal(taskId: string, signal: TerminalSignal): boolean {
    const session = this.sessions.get(taskId);
    if (!session) return false;

    try {
      if (signal === "sigint") {
        if (session.pty && session.proc.terminal && !session.proc.terminal.closed) {
          // Ctrl+C through the line discipline reaches the whole foreground
          // process group, exactly like a real terminal.
          session.proc.terminal.write("\x03");
        } else {
          session.proc.kill("SIGINT");
        }
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

  /** Close every live session (server shutdown). */
  closeAll(): void {
    for (const taskId of [...this.sessions.keys()]) this.closeSession(taskId);
  }

  private emit(session: TerminalSession, stream: "stdout" | "stderr", chunk: string): void {
    // Broadcast only once the screen model has applied the chunk. Writes and their
    // callbacks are FIFO, so every chunk is announced before any later snapshot is sent
    // and every chunk after a snapshot is announced after it: reattaching clients never
    // lose or double-apply output.
    session.screen.write(chunk, () =>
      this.callbacks.onOutput(session.taskId, session.runId, stream, chunk)
    );
  }

  private disposeScreen(session: TerminalSession): void {
    try {
      session.screen.dispose();
    } catch {
      // already disposed
    }
  }

  private closePty(session: TerminalSession): void {
    try {
      const terminal = session.proc.terminal;
      if (terminal && !terminal.closed) terminal.close();
    } catch {
      // already closed
    }
  }

  private async readStream(session: TerminalSession, stream: "stdout" | "stderr"): Promise<void> {
    const source = stream === "stdout" ? session.proc.stdout : session.proc.stderr;
    if (!source || typeof source === "number") return;
    const reader = (source as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        this.emit(session, stream, chunk);
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
    this.closePty(session);
    // closeSession() already removed the entry and reported the close.
    if (session.closing) return;
    // Let the last output reach clients before the screen model goes away.
    await new Promise<void>((resolve) => session.screen.write("", () => resolve()));
    this.disposeScreen(session);
    if (this.sessions.get(session.taskId) === session) this.sessions.delete(session.taskId);
    this.callbacks.onClosed(
      session.taskId,
      session.runId,
      Number.isNaN(exitCode) ? null : exitCode,
      "exit"
    );
  }
}
