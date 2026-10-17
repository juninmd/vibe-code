import {
  type EngineInfo,
  HARNESS_ENGINES,
  type HarnessEngine,
  type Task,
  type TaskWithRun,
  type TerminalState,
  type WsClientMessage,
} from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { subscribeTerminal } from "../../hooks/terminalBus";
import { TaskTerminal, type TaskTerminalHandle } from "../TaskTerminal";
import { Button } from "../ui/button";
import { getEngineMeta } from "../ui/engine-icons";

type Choice = HarnessEngine | "shell";
type NotifyKind = "success" | "error" | "info";

const CHOICE_LABEL: Record<Choice, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  shell: "Shell",
};

const STATUS_LABEL: Record<string, string> = {
  backlog: "Todo",
  scheduled: "Scheduled",
  in_progress: "Stopped",
  review: "Review",
  done: "Done",
  failed: "Failed",
  blocked: "Blocked",
};

export interface TerminalDockProps {
  task: TaskWithRun;
  engines: EngineInfo[];
  connected: boolean;
  onWsSend: (message: WsClientMessage) => void;
  onClose: () => void;
  onFinished: (task: Task) => void;
  onOpenDetails: () => void;
  onNotify: (message: string, kind: NotifyKind) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The terminal pane of the Terminals view: attaches to a task's worktree, starts or
 * resumes the agent (or a plain shell) and commits the work. It is a compact sibling
 * of the board's TaskPanel, kept here so the operator never leaves the central view.
 */
export function TerminalDock({
  task,
  engines,
  connected,
  onWsSend,
  onClose,
  onFinished,
  onOpenDetails,
  onNotify,
}: TerminalDockProps) {
  const terminalRef = useRef<TaskTerminalHandle>(null);
  const [state, setState] = useState<TerminalState | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | "finish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasOutput, setHasOutput] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);

  const live = state?.live ?? false;
  const available = useMemo(
    () => new Set(engines.filter((engine) => engine.available).map((engine) => engine.name)),
    [engines]
  );

  const refreshState = useCallback(() => {
    api.terminal
      .state(task.id)
      .then(setState)
      .catch(() => {});
  }, [task.id]);

  useEffect(() => {
    setState(null);
    setHasOutput(false);
    setError(null);
    refreshState();
  }, [refreshState]);

  // The server moves the task/run when the terminal ends; mirror that here.
  useEffect(
    () =>
      subscribeTerminal(task.id, (event) => {
        if (event.kind === "opened" || event.kind === "closed") refreshState();
      }),
    [task.id, refreshState]
  );

  useEffect(() => {
    if (choice) return;
    const preferred = HARNESS_ENGINES.find((name) => name === task.engine && available.has(name));
    const fallback = HARNESS_ENGINES.find((name) => available.has(name));
    setChoice(preferred ?? fallback ?? "shell");
  }, [choice, task.engine, available]);

  const guard = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      onNotify(message, "error");
    } finally {
      setBusy(null);
    }
  };

  const start = () =>
    guard("start", async () => {
      if (!choice) return;
      const size = terminalRef.current?.size();
      const next = await api.terminal.start(task.id, { engine: choice, ...size });
      setState(next);
      terminalRef.current?.focus();
    });

  const stop = () =>
    guard("stop", async () => {
      await api.terminal.stop(task.id);
      refreshState();
    });

  const finish = () =>
    guard("finish", async () => {
      const updated = await api.terminal.finish(task.id);
      onFinished(updated);
      onNotify("Changes committed. Ready for a pull request.", "success");
      refreshState();
    });

  const status = live
    ? { label: "Running", className: "text-success" }
    : { label: STATUS_LABEL[task.status] ?? "Todo", className: "text-text-dimmed" };
  const hasWorkspace = !!state?.cwd;
  const startLabel = hasWorkspace ? "Resume" : "Start";
  const showIdle = !live && !hasOutput;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-app">
      <header className="flex items-center gap-2 border-b border-white/10 px-2 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
          className="rounded-md p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-text-primary">{task.title}</h2>
          <p className="flex items-center gap-2 truncate text-[11px] text-text-dimmed">
            <span className={`inline-flex items-center gap-1.5 font-medium ${status.className}`}>
              {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}
              {status.label}
            </span>
            {task.repo && <span className="truncate">· {task.repo.name}</span>}
            {task.branchName && <span className="truncate font-mono">· {task.branchName}</span>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {live ? (
            <>
              <Button variant="ghost" size="sm" onClick={stop} disabled={busy !== null}>
                Stop
              </Button>
              <Button variant="primary" size="sm" onClick={finish} disabled={busy !== null}>
                {busy === "finish" ? "Committing…" : "Finish"}
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={start} disabled={busy !== null || !choice}>
              {busy === "start" ? "Starting…" : startLabel}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenDetails}
            className="hidden sm:inline-flex"
          >
            Details
          </Button>
        </div>
      </header>

      {error && (
        <p className="border-b border-danger/20 bg-danger/10 px-4 py-1.5 text-xs text-danger">
          {error}
        </p>
      )}

      <main className="relative min-h-0 flex-1">
        <TaskTerminal
          ref={terminalRef}
          taskId={task.id}
          connected={connected}
          onWsSend={onWsSend}
          onActivity={setHasOutput}
        />

        {showIdle && (
          <div className="absolute inset-0 grid place-items-center bg-[#0b0b0f]/85 px-4">
            <div className="flex w-full max-w-xs flex-col items-center gap-3 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-accent">
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 17l6-6-6-6M12 19h8" />
                </svg>
              </div>
              <p className="text-xs leading-relaxed text-text-dimmed">
                No terminal is running for this worktree. Start an agent or a plain shell.
              </p>
              <div className="flex w-full items-center gap-2">
                <select
                  aria-label="Engine"
                  value={choice ?? ""}
                  onChange={(e) => setChoice(e.target.value as Choice)}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-surface px-2.5 py-2 text-xs text-text-secondary outline-none focus:border-accent/40"
                >
                  {[...HARNESS_ENGINES, "shell" as const].map((name) => (
                    <option
                      key={name}
                      value={name}
                      disabled={name !== "shell" && !available.has(name)}
                    >
                      {CHOICE_LABEL[name]}
                      {name !== "shell" && !available.has(name) ? " (not installed)" : ""}
                    </option>
                  ))}
                </select>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={start}
                  disabled={busy !== null || !choice}
                >
                  {busy === "start" ? "Starting…" : startLabel}
                </Button>
              </div>
              {choice && choice !== "shell" && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
                  {(() => {
                    const meta = getEngineMeta(choice);
                    const Icon = meta.icon;
                    return <Icon size={12} className={meta.color} />;
                  })()}
                  {state?.cwd
                    ? "Resumes the previous conversation in this worktree."
                    : "Runs in a fresh worktree."}
                </span>
              )}
            </div>
          </div>
        )}

        {!live && hasOutput && !showIdle && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-white/10 bg-[#0b0b0f]/95 px-4 py-2">
            <span className="text-xs text-text-dimmed">Session ended.</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={stop}>
                Clear
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={start}
                disabled={busy !== null || !choice}
              >
                {startLabel}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
