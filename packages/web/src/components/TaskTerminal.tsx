import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { WsClientMessage } from "@vibe-code/shared";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { subscribeTerminal } from "../hooks/terminalBus";

export interface TaskTerminalHandle {
  /** Current terminal size, so a session can start at the exact visible geometry. */
  size: () => { cols: number; rows: number };
  focus: () => void;
}

interface TaskTerminalProps {
  taskId: string;
  /** WebSocket connection state; the terminal re-attaches whenever it becomes true. */
  connected: boolean;
  onWsSend: (message: WsClientMessage) => void;
  /** Called with true once the terminal shows (or has shown) real output. */
  onActivity?: (hasOutput: boolean) => void;
}

/**
 * Full terminal reset (RIS) sent through the write queue. Terminal.reset() is synchronous
 * but write() is queued, so resetting directly could run *before* a previously queued
 * snapshot is parsed and let two snapshots pile up on top of each other.
 */
const RESET = "\x1bc";

// The terminal is always dark, like any developer terminal, regardless of app theme.
const THEME = {
  background: "#0b0b0f",
  foreground: "#e4e4e7",
  cursor: "#a78bfa",
  cursorAccent: "#0b0b0f",
  selectionBackground: "#4c1d9566",
  black: "#18181b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",
  brightBlack: "#52525b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

/** A real terminal (xterm.js) wired to the task's PTY session over the WebSocket. */
export const TaskTerminal = forwardRef<TaskTerminalHandle, TaskTerminalProps>(function TaskTerminal(
  { taskId, connected, onWsSend, onActivity },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const sendRef = useRef(onWsSend);
  sendRef.current = onWsSend;
  const activityRef = useRef(onActivity);
  activityRef.current = onActivity;
  const hasOutputRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      size: () => ({ cols: termRef.current?.cols ?? 120, rows: termRef.current?.rows ?? 32 }),
      focus: () => termRef.current?.focus(),
    }),
    []
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: THEME,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    hasOutputRef.current = false;

    const safeFit = () => {
      try {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
      } catch {
        // Hidden or zero-sized container; the next resize retries.
      }
    };
    safeFit();

    const input = term.onData((data) => {
      sendRef.current({ type: "terminal_input", taskId, input: data });
    });
    const resize = term.onResize(({ cols, rows }) => {
      sendRef.current({ type: "terminal_resize", taskId, cols, rows });
    });

    const unsubscribe = subscribeTerminal(taskId, (event) => {
      if (event.kind === "opened") {
        // A new (or re-attached) session owns the screen from here on.
        term.write(RESET);
      } else if (event.kind === "output") {
        // A replay is a snapshot of the live screen: start from a clean one.
        if (event.replay) term.write(RESET);
        term.write(event.chunk);
        if (!hasOutputRef.current && /\S/.test(event.chunk)) {
          hasOutputRef.current = true;
          activityRef.current?.(true);
        }
      } else if (event.kind === "closed") {
        const label =
          event.reason === "closed"
            ? "session stopped"
            : `session ended (exit ${event.exitCode ?? "?"})`;
        term.write(`\r\n\x1b[2m[${label}]\x1b[0m\r\n`);
      }
    });

    const observer = new ResizeObserver(safeFit);
    observer.observe(host);

    return () => {
      unsubscribe();
      observer.disconnect();
      input.dispose();
      resize.dispose();
      // Detach only; the agent keeps running on the server.
      sendRef.current({ type: "terminal_close", taskId });
      term.dispose();
      termRef.current = null;
    };
  }, [taskId]);

  // (Re)attach to the live session: the server replays the scrollback.
  useEffect(() => {
    const term = termRef.current;
    if (!connected || !term) return;
    sendRef.current({ type: "terminal_open", taskId, cols: term.cols, rows: term.rows });
    sendRef.current({ type: "terminal_resize", taskId, cols: term.cols, rows: term.rows });
  }, [connected, taskId]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-[#0b0b0f] p-2" />;
});
