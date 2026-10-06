import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskPriority, TaskWithRun } from "@vibe-code/shared";
import { memo, useEffect, useState } from "react";
import { useElapsedTime } from "../hooks/useElapsedTime";
import type { RetryState } from "../hooks/useRetryQueue";
import { getEngineMeta } from "./ui/engine-icons";

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** Priority is a thin colour edge, not a badge. "none" draws nothing. */
const PRIORITY_EDGE: Record<TaskPriority, string> = {
  none: "bg-transparent",
  low: "bg-emerald-400/70",
  medium: "bg-amber-400/80",
  high: "bg-orange-400",
  urgent: "bg-red-500",
};

interface TaskCardProps {
  task: TaskWithRun;
  onClick: (task: TaskWithRun) => void;
  onRetryPR: (taskId: string) => void;
  onUnblock?: (taskId: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectionChange?: (taskId: string, selected: boolean) => void;
  retryEntry?: RetryState;
}

function RetryCountdown({ dueAt, attempt }: { dueAt: number; attempt: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((dueAt - Date.now()) / 1000))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const secs = Math.max(0, Math.ceil((dueAt - Date.now()) / 1000));
      setRemaining(secs);
      if (secs === 0) clearInterval(timer);
    }, 1_000);
    return () => clearInterval(timer);
  }, [dueAt]);

  return (
    <span className="text-[10px] text-warning tabular-nums">
      retry #{attempt} in {remaining}s
    </span>
  );
}

function TaskCardComponent({
  task,
  onClick,
  onRetryPR,
  onUnblock,
  selectionMode = false,
  selected = false,
  onSelectionChange,
  retryEntry,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });

  const [retrying, setRetrying] = useState(false);
  const isRunning = task.latestRun?.status === "running";
  const elapsed = useElapsedTime(task.latestRun?.startedAt, isRunning);

  const isFailed = task.status === "failed";
  const isReview = task.status === "review";
  const isBlocked = task.status === "blocked";
  const isDone = task.status === "done";
  const isConflict = task.tags?.includes("conflict-resolution") ?? false;
  const hasPR = !!task.prUrl;

  const engine = task.engine ? getEngineMeta(task.engine) : null;
  const EngineIcon = engine?.icon;

  const handleRetryPR = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetryPR(task.id);
    } catch {
      // The detail view surfaces the error; the card stays quiet.
    } finally {
      setRetrying(false);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag and drop wrapper
    // biome-ignore lint/a11y/useKeyWithClickEvents: drag and drop wrapper
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
      onClick={() => onClick(task)}
      className={`group relative cursor-grab overflow-hidden rounded-lg border bg-surface/60 py-2.5 pl-4 pr-3 transition-colors active:cursor-grabbing hover:bg-surface-hover ${
        isRunning
          ? "border-accent/50"
          : isFailed
            ? "border-danger/30"
            : isConflict
              ? "border-rose-500/40"
              : "border-white/[0.06]"
      } ${selected ? "ring-2 ring-danger/50" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${PRIORITY_EDGE[task.priority] ?? PRIORITY_EDGE.none}`}
      />

      <div className="flex items-start gap-2">
        {selectionMode && (
          <input
            type="checkbox"
            aria-label={`Selecionar ${task.title}`}
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onSelectionChange?.(task.id, e.currentTarget.checked);
            }}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-red-500"
          />
        )}
        <h3 className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-text-primary line-clamp-2">
          {task.title}
        </h3>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
        {EngineIcon && engine && (
          <span title={task.engine ?? undefined} className="inline-flex shrink-0">
            <EngineIcon size={12} className={engine.color} />
          </span>
        )}
        {task.repo && <span className="min-w-0 truncate">{task.repo.name}</span>}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 tabular-nums text-accent-text">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {elapsed ?? "live"}
            </span>
          ) : isFailed ? (
            <span className="text-danger">Failed</span>
          ) : isBlocked ? (
            <span className="text-warning">Blocked</span>
          ) : isDone && task.latestRun?.finishedAt ? (
            <span title={new Date(task.latestRun.finishedAt).toLocaleString()}>
              {formatRelativeTime(task.latestRun.finishedAt)}
            </span>
          ) : null}
          {hasPR && (
            <a
              href={task.prUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-medium text-success hover:underline"
            >
              PR
            </a>
          )}
        </span>
      </div>

      {(isFailed && retryEntry) || isBlocked || (isReview && !hasPR) || isConflict ? (
        <div className="mt-2 flex items-center gap-2">
          {isConflict && <span className="text-[10px] text-rose-300">Merge conflict</span>}
          {isFailed && retryEntry && (
            <RetryCountdown dueAt={retryEntry.dueAt} attempt={retryEntry.attempt} />
          )}
          {isBlocked && onUnblock && (
            <button
              type="button"
              className="ml-auto rounded px-2 py-0.5 text-[10px] text-text-secondary hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation();
                onUnblock(task.id);
              }}
            >
              Resume
            </button>
          )}
          {isReview && !hasPR && (
            <button
              type="button"
              className="ml-auto rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              onClick={handleRetryPR}
              disabled={retrying}
            >
              {retrying ? "..." : "Create PR"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export const TaskCard = memo(TaskCardComponent, (prev, next) => {
  return (
    prev.task === next.task &&
    prev.onClick === next.onClick &&
    prev.onRetryPR === next.onRetryPR &&
    prev.onUnblock === next.onUnblock &&
    prev.selectionMode === next.selectionMode &&
    prev.selected === next.selected &&
    prev.onSelectionChange === next.onSelectionChange &&
    prev.retryEntry === next.retryEntry
  );
});
