import type { AgentLog } from "@vibe-code/shared";
import { useEffect, useRef, useState } from "react";
import { formatElapsedSecs } from "../utils/elapsed";
import { pickTaskStage } from "../utils/task-stage";

interface TaskStatusPillProps {
  /** Orchestrator-reported status (queued | dispatched | in_progress | ...). */
  taskStatus: string | undefined;
  /** Log tail used to derive the semantic stage label. */
  logs: AgentLog[];
  /** ISO timestamp the task started; anchors the elapsed counter. */
  startedAt?: string | null;
  /** When true, render even if status is terminal — pass false to hide for done/failed. */
  alwaysVisible?: boolean;
}

/**
 * Compact "what is the agent doing right now" pill. Ported from multica's
 * TaskStatusPill — derives a semantic stage from the latest log entry
 * (Thinking / Reading files / Running command / etc.) instead of showing
 * a generic spinner. Elapsed time is anchored on first render and never
 * reassigned so it can never appear to jump backward.
 */
export function TaskStatusPill({
  taskStatus,
  logs,
  startedAt,
  alwaysVisible = false,
}: TaskStatusPillProps) {
  // Anchor: locked on first render. See multica's comment — we prefer
  // monotonic elapsed over strict accuracy because a clock-rebase from
  // optimistic `Date.now()` to a server timestamp 200ms in the past would
  // make the timer visibly snap backward.
  const anchorRef = useRef<number | null>(null);
  if (anchorRef.current === null) {
    if (startedAt) {
      const t = Date.parse(startedAt);
      anchorRef.current = Number.isFinite(t) ? t : Date.now();
    } else {
      anchorRef.current = Date.now();
    }
  }
  const anchor = anchorRef.current;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isTerminal = taskStatus === "done" || taskStatus === "failed" || taskStatus === "cancelled";
  if (!alwaysVisible && isTerminal) return null;

  const stage = pickTaskStage(taskStatus, logs);
  const elapsed = formatElapsedSecs(Math.max(0, Math.floor((now - anchor) / 1000)));

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-info/10 text-[11px] font-mono text-info"
      aria-live="polite"
      title={`status=${taskStatus ?? "unknown"} · stage=${stage.key}`}
    >
      {!stage.static && (
        <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse shrink-0" />
      )}
      <span className="truncate">{stage.label}</span>
      <span className="opacity-70 tabular-nums">· {elapsed}</span>
    </span>
  );
}
